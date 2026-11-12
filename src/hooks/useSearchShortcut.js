import { useEffect } from 'react'

/**
 * ⌘K is printed in the search field, so it has to work.
 *
 * The field lives in the top bar, which is mounted on every signed-in screen, so
 * the shortcut is wired here rather than threaded through props: find the search
 * input, focus it, select what is there. Esc gives it back to the page.
 *
 * Gated on the same conditions the browser uses for its own shortcuts: no
 * modifier soup, and not while the user is typing in another field.
 */
export default function useSearchShortcut() {
  useEffect(() => {
    const findSearch = () => document.querySelector('input[type="search"]')

    const onKey = (event) => {
      const key = event.key.toLowerCase()
      const mod = event.metaKey || event.ctrlKey

      if (mod && key === 'k') {
        const field = findSearch()
        if (!field) return
        event.preventDefault()
        field.focus()
        field.select()
        return
      }

      // "/" jumps to search when focus is not already in a text field.
      if (!mod && key === '/') {
        const active = document.activeElement
        const typing = active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)
        if (typing || active?.isContentEditable) return
        const field = findSearch()
        if (!field) return
        event.preventDefault()
        field.focus()
        field.select()
        return
      }

      if (key === 'escape' && document.activeElement === findSearch()) {
        document.activeElement.blur()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
