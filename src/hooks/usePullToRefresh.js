import { useEffect, useRef, useState } from 'react'

// How far the finger travels for each pixel the list moves, and how far the list must move
// before letting go refreshes. Past the mark the indicator says so; short of it nothing happens.
const RESISTANCE = 0.45
const TRIGGER_PX = 64
const MAX_PX = 96

/**
 * Pull the list down from its top to refresh, the way every phone mail app does.
 *
 * Touch events, not pointer events: when the browser takes a gesture for scrolling it cancels
 * the pointer stream, and this gesture starts exactly where scrolling would. The listeners are
 * passive, so scrolling never waits on them; the pull only begins when the list is already at
 * its top and the finger moves down.
 *
 * Returns the distance to draw the indicator at, and whether a refresh is running.
 */
export function usePullToRefresh(scrollRef, onRefresh) {
  const [pull, setPull] = useState(0)
  const [busy, setBusy] = useState(false)
  const start = useRef(null)
  const pullRef = useRef(0)
  const busyRef = useRef(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !onRefresh) return undefined

    const set = (value) => {
      pullRef.current = value
      setPull(value)
    }
    const onStart = (event) => {
      if (busyRef.current || el.scrollTop > 0 || event.touches.length !== 1) {
        start.current = null
        return
      }
      start.current = { y: event.touches[0].clientY, x: event.touches[0].clientX }
    }
    const onMove = (event) => {
      if (!start.current) return
      const dy = event.touches[0].clientY - start.current.y
      const dx = event.touches[0].clientX - start.current.x
      // Sideways is a row being swiped; upwards, or a list that has scrolled, is not a pull.
      if (dy <= 0 || Math.abs(dx) > dy || el.scrollTop > 0) {
        if (pullRef.current) set(0)
        if (dy < 0 || Math.abs(dx) > dy) start.current = null
        return
      }
      set(Math.min(MAX_PX, dy * RESISTANCE))
    }
    const onEnd = async () => {
      if (!start.current) return
      start.current = null
      if (pullRef.current < TRIGGER_PX) {
        set(0)
        return
      }
      busyRef.current = true
      setBusy(true)
      set(TRIGGER_PX * 0.75)
      try {
        await onRefresh()
      } finally {
        busyRef.current = false
        setBusy(false)
        set(0)
      }
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: true })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [scrollRef, onRefresh])

  return { pull, busy, ready: pull >= TRIGGER_PX }
}

export const PULL_TRIGGER_PX = TRIGGER_PX
