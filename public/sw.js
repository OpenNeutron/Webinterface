/*
 * Offline shell for the installed app.
 *
 * Only the app shell is cached, and only with network-first navigation: bundle
 * filenames are content-hashed, so a stale cache can never serve an old build to
 * a page that is already online. Anything that is not a GET for our own origin is
 * left alone — mail is fetched from the API and must never be cached on disk.
 */
// Bump on every deploy: a shell cached under an old name is how a phone keeps
// running last week's reader while the server serves this week's.
const CACHE = 'sloth-mail-shell-v77'
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/favicon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  // Never store mail or account responses.
  if (url.pathname.startsWith('/api/')) return

  // Navigations: always try the network so a new build is picked up immediately,
  // and fall back to the cached shell only when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((cache) => cache.put('/', copy)).catch(() => {})
          return res
        })
        .catch(() => caches.match('/').then((hit) => hit || Response.error())),
    )
    return
  }

  // Static assets: cache-first is safe because their names change with content.
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit
      return fetch(req).then((res) => {
        if (res.ok && (res.type === 'basic' || res.type === 'default')) {
          const copy = res.clone()
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {})
        }
        return res
      })
    }),
  )
})

/*
 * New mail.
 *
 * The push payload is sealed by the server to this browser's key, so what arrives
 * here is already plain JSON — and it deliberately holds a sender and a count,
 * never a subject or a body. A notification is drawn on a lock screen.
 */
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }
  const title = data.title || 'New mail'
  const body = data.body || 'You have a new message.'
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: data.tag || 'new-mail',
      renotify: true,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          client.focus()
          if ('navigate' in client) return client.navigate(target)
          return undefined
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})
