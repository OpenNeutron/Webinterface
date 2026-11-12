import { pushKey, pushSubscribe, pushTest, pushUnsubscribe } from '@/api'

/**
 * New-mail notifications.
 *
 * The browser hands back an endpoint and two keys; the server seals a payload to
 * those keys, so only this browser can read the notification it draws. Nothing
 * here is a secret we hold — the browser can revoke it at any time.
 */

function urlBase64ToBytes(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out
}

export function pushSupported() {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/**
 * iOS only delivers web push to an app added to the home screen. Saying so beats
 * a toggle that silently does nothing.
 */
export function needsHomeScreen() {
  if (typeof navigator === 'undefined') return false
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent)
  const installed = window.matchMedia?.('(display-mode: standalone)').matches
  return ios && !installed
}

export async function currentSubscription() {
  if (!pushSupported()) return null
  const registration = await navigator.serviceWorker.getRegistration()
  if (!registration) return null
  return registration.pushManager.getSubscription()
}

/**
 * A browser can hold a live subscription the server no longer knows about — a
 * re-created account, a restored backup, a record lost to a crash. Registering it
 * again is cheaper than asking the user to toggle a switch that already looks on.
 */
export async function registerExistingSubscription() {
  const subscription = await currentSubscription()
  if (!subscription) return false
  const raw = subscription.toJSON()
  try {
    await pushSubscribe({
      endpoint: subscription.endpoint,
      key: raw.keys.p256dh,
      auth: raw.keys.auth,
      ua: navigator.userAgent.slice(0, 120),
    })
    return true
  } catch {
    return false
  }
}

export async function enableNotifications() {
  if (!pushSupported()) throw new Error('This browser cannot show notifications.')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Notifications are blocked for this site. Allow them in the browser settings, then try again.'
        : 'You did not allow notifications.',
    )
  }

  const { key } = await pushKey()
  const registration = await navigator.serviceWorker.ready
  const existing = await registration.pushManager.getSubscription()
  const subscription =
    existing ||
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToBytes(key),
    }))

  const raw = subscription.toJSON()
  await pushSubscribe({
    endpoint: subscription.endpoint,
    key: raw.keys.p256dh,
    auth: raw.keys.auth,
    ua: navigator.userAgent.slice(0, 120),
  })
  return subscription
}

export async function disableNotifications() {
  const subscription = await currentSubscription()
  if (!subscription) return
  // Tell the server first: if it forgets to, mail would keep pushing into a
  // subscription the browser has already dropped.
  try {
    await pushUnsubscribe(subscription.endpoint)
  } finally {
    await subscription.unsubscribe()
  }
}

export async function sendTestNotification() {
  const data = await pushTest()
  return data?.delivered ?? 0
}
