/**
 * Two preferences, applied to the document instead of being threaded through
 * every component: every colour in the app is a token, so a theme is one
 * attribute on <html>.
 */
const THEME_KEY = 'sloth-theme'   // 'dark' | 'light' | 'system'
const DENSITY_KEY = 'sloth-density' // 'comfortable' | 'compact'

const media = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-color-scheme: light)')
  : null

export function readTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'dark' } catch { return 'dark' }
}
export function readDensity() {
  try { return localStorage.getItem(DENSITY_KEY) || 'comfortable' } catch { return 'comfortable' }
}

export function resolvedTheme(pref = readTheme()) {
  if (pref === 'system') return media?.matches ? 'light' : 'dark'
  return pref === 'light' ? 'light' : 'dark'
}

function apply() {
  const root = document.documentElement
  root.dataset.theme = resolvedTheme()
  root.dataset.density = readDensity()
  // Keep the browser chrome (address bar, status area) in step with the app.
  const light = root.dataset.theme === 'light'
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
    m.setAttribute('content', light ? '#f6f6f0' : '#10150f')
  }
}

export function setTheme(pref) {
  try { localStorage.setItem(THEME_KEY, pref) } catch { /* private mode: the session still looks right */ }
  apply()
  window.dispatchEvent(new CustomEvent('sloth:appearance'))
}

export function setDensity(value) {
  try { localStorage.setItem(DENSITY_KEY, value) } catch { /* same */ }
  apply()
  window.dispatchEvent(new CustomEvent('sloth:appearance'))
}

/** Call once, before the first paint, so nothing flashes the wrong ground. */
export function initAppearance() {
  apply()
  if (media) {
    const onChange = () => { if (readTheme() === 'system') apply() }
    media.addEventListener?.('change', onChange)
  }
}
