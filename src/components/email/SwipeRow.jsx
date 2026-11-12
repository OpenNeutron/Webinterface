import { useEffect, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'

// How far a row must travel before letting go deletes it, and how long a still finger takes to
// become a long press. A swipe that falls short springs back, so a half-hearted flick costs nothing.
const COMMIT_RATIO = 0.35
const COMMIT_MAX_PX = 140
const LONG_PRESS_MS = 450
const SLOP_PX = 10

/**
 * A mail row that answers a finger: swipe left to delete, hold to select.
 *
 * On a phone there is no hover, so the row's hover actions never appear; before this the only
 * way to delete was to open each message first. Mouse and pen are left alone: they have the hover
 * actions, and dragging text with a mouse must not delete mail.
 *
 * `touch-action: pan-y` hands vertical movement to the browser (the list still scrolls) and
 * keeps horizontal movement for the row. The click that follows a swipe or a long press is
 * swallowed, so neither opens the message as well.
 */
export function SwipeRow({ children, onSwipe, onLongPress, label = 'Delete', className = '' }) {
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const box = useRef(null)
  const gesture = useRef(null)
  const swallowClick = useRef(false)
  const timer = useRef(null)
  const alive = useRef(true)

  useEffect(() => () => {
    alive.current = false
    clearTimeout(timer.current)
  }, [])

  const width = () => box.current?.offsetWidth || 360
  const threshold = () => Math.min(COMMIT_MAX_PX, width() * COMMIT_RATIO)

  const reset = () => {
    clearTimeout(timer.current)
    gesture.current = null
    setDragging(false)
  }

  const onPointerDown = (event) => {
    if (event.pointerType !== 'touch' || leaving) return
    swallowClick.current = false
    gesture.current = { x: event.clientX, y: event.clientY, axis: null }
    if (onLongPress) {
      timer.current = setTimeout(() => {
        if (!gesture.current || gesture.current.axis) return
        swallowClick.current = true
        gesture.current = null
        navigator.vibrate?.(12)
        onLongPress()
      }, LONG_PRESS_MS)
    }
  }

  const onPointerMove = (event) => {
    const g = gesture.current
    if (!g) return
    const dx = event.clientX - g.x
    const dy = event.clientY - g.y
    if (!g.axis) {
      if (Math.abs(dx) < SLOP_PX && Math.abs(dy) < SLOP_PX) return
      clearTimeout(timer.current)
      // Mostly sideways is a swipe; anything else is the list scrolling, and the row lets go.
      g.axis = Math.abs(dx) > Math.abs(dy) * 1.2 && onSwipe ? 'x' : 'y'
      if (g.axis === 'y') {
        gesture.current = null
        return
      }
      setDragging(true)
    }
    // Left only: a right swipe has no meaning here yet, so it does not move the row.
    setOffset(Math.max(-width(), Math.min(0, dx)))
  }

  const onPointerUp = () => {
    const g = gesture.current
    clearTimeout(timer.current)
    if (!g || g.axis !== 'x') {
      reset()
      return
    }
    swallowClick.current = true
    const committed = -offset >= threshold()
    reset()
    if (!committed) {
      setOffset(0)
      return
    }
    setLeaving(true)
    setOffset(-width())
    // The row slides out, then the delete runs. If the server refuses, the row comes back:
    // the screen only ever shows what the server did.
    setTimeout(async () => {
      try {
        await onSwipe()
      } finally {
        if (alive.current) {
          setLeaving(false)
          setOffset(0)
        }
      }
    }, 160)
  }

  const progress = Math.min(1, -offset / threshold())

  return (
    <div ref={box} className={`relative overflow-hidden ${className}`}>
      {onSwipe && offset < 0 && (
        <div
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-end gap-2 bg-destructive pr-5 text-[13px] font-medium text-white"
          style={{ opacity: 0.55 + 0.45 * progress }}
        >
          <Trash2 className="size-4" style={{ transform: `scale(${0.85 + 0.25 * progress})` }} />
          {progress >= 1 ? `Release to ${label.toLowerCase()}` : label}
        </div>
      )}
      <div
        data-testid="swipe-surface"
        className="relative bg-background"
        style={{
          transform: offset ? `translateX(${offset}px)` : undefined,
          transition: dragging ? 'none' : 'transform 160ms ease-out',
          touchAction: 'pan-y',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          reset()
          setOffset(0)
        }}
        onClickCapture={(event) => {
          if (!swallowClick.current) return
          swallowClick.current = false
          event.preventDefault()
          event.stopPropagation()
        }}
        onContextMenu={(event) => {
          // A long press on a phone also opens the browser's own menu; the row's own meaning wins.
          if (onLongPress && event.nativeEvent?.pointerType !== 'mouse') event.preventDefault()
        }}
      >
        {children}
      </div>
    </div>
  )
}
