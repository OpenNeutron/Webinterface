import { useEffect, useState } from 'react'

/**
 * The part of the screen the keyboard is not covering.
 *
 * `100dvh` does not shrink for an on-screen keyboard on iOS (and not on Android when the page
 * asks for the overlay behaviour), so a full-screen sheet sized with it put Send underneath the
 * keyboard. The visual viewport is what is actually visible: size the sheet to it and the
 * footer rides on top of the keyboard. Null where the API does not exist; the caller falls back.
 */
export function useVisualViewport(enabled = true) {
  const read = () => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    return vv ? { height: vv.height, top: vv.offsetTop } : null
  }
  const [box, setBox] = useState(() => (enabled ? read() : null))

  useEffect(() => {
    const vv = window.visualViewport
    if (!enabled || !vv) return undefined
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const next = read()
        setBox((prev) => (prev && next && prev.height === next.height && prev.top === next.top ? prev : next))
      })
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      cancelAnimationFrame(frame)
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [enabled])

  return enabled ? box : null
}
