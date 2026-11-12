import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { initAppearance } from './lib/appearance'

initAppearance()

// Screens load in pieces now. A tab left open across a deploy asks for a piece the server no
// longer has (every deploy replaces the files); reload once to pick up the new build instead
// of showing a blank screen. The flag stops a reload loop if the piece is missing for real.
window.addEventListener('vite:preloadError', (event) => {
  if (sessionStorage.getItem('sloth.chunk-reload') === '1') return
  sessionStorage.setItem('sloth.chunk-reload', '1')
  event.preventDefault()
  window.location.reload()
})
window.addEventListener('load', () => {
  setTimeout(() => sessionStorage.removeItem('sloth.chunk-reload'), 10000)
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)

// Installable app shell. Registered after render so a slow or failing service
// worker can never delay first paint.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
