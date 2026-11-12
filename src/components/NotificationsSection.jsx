import { useEffect, useState } from 'react'
import { pushStatus } from '@/api'
import {
  disableNotifications,
  enableNotifications,
  needsHomeScreen,
  pushSupported,
  registerExistingSubscription,
  sendTestNotification,
} from '@/lib/push'

// New mail, without having to sit and look at the inbox.
export default function NotificationsSection() {
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const supported = pushSupported()
  const homeScreen = needsHomeScreen()

  // The server is the truth here, not the browser: a subscription the server has
  // forgotten produces no notifications, so calling it "on" would be a lie.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await pushStatus()
        let count = data?.count ?? 0
        if (count === 0 && (await registerExistingSubscription())) count = 1
        if (!cancelled) setOn(count > 0)
      } catch {
        // Leave it off; the button will say what went wrong when it is pressed.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function toggle() {
    setBusy(true)
    setStatus('')
    try {
      if (on) {
        await disableNotifications()
        setOn(false)
        setStatus('Notifications are off. You can turn them back on any time.')
      } else {
        await enableNotifications()
        setOn(true)
        setStatus('A browser is registered. Send a test to be sure.')
      }
    } catch (err) {
      setStatus(err?.message || 'That did not work')
    }
    setBusy(false)
  }

  async function test() {
    setBusy(true)
    setStatus('')
    try {
      const delivered = await sendTestNotification()
      setStatus(
        delivered > 0
          ? 'Sent. It should appear within a few seconds.'
          : 'Nothing was delivered — the registered browser may have gone away.',
      )
    } catch (err) {
      setStatus(err?.response?.data?.error || err?.message || 'That did not work')
    }
    setBusy(false)
  }

  return (
    // Settings gives this section its card and title; no second card or heading inside.
    <section>
      <p className="mb-3 text-xs text-ink-3">
        Tells this browser when a message arrives, even when the app is closed. The
        notification says who it is from — never the subject or the message, because
        that text would be drawn on a lock screen.
      </p>

      {!supported && (
        <p className="text-xs text-ink-2">
          This browser cannot show notifications. Chrome, Edge and Firefox on a
          computer, and Android, all can.
        </p>
      )}

      {supported && homeScreen && (
        <p className="mb-3 text-xs text-amber-400/90">
          On an iPhone, notifications only work once this app is added to the home
          screen: Share, then Add to Home Screen, then open it from there.
        </p>
      )}

      {supported && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={toggle}
            disabled={busy}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
              on
                ? 'border border-line/70 text-ink-1 hover:border-line'
                : 'bg-primary text-primary-foreground hover:opacity-90'
            }`}
          >
            {busy ? 'Working…' : on ? 'Turn off' : 'Turn on'}
          </button>
          {on && (
            <button
              onClick={test}
              disabled={busy}
              className="rounded-lg border border-line/70 px-3 py-1.5 text-sm text-ink-2 hover:border-line disabled:opacity-50"
            >
              Send a test
            </button>
          )}
          <span className="text-xs text-ink-3">{on ? 'On for this browser' : 'Off'}</span>
        </div>
      )}

      {status ? <p className="mt-2 text-xs text-ink-2">{status}</p> : null}
    </section>
  )
}
