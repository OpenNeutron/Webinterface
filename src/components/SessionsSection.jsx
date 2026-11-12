import { useEffect, useState } from 'react'
import { Monitor, LogOut } from 'lucide-react'
import { userSessions, userRevokeSession, userRevokeAllSessions } from '@/api'
import { storage } from '@/storage'
import { keySession } from '@/keySession'

/** Turn a user-agent string into something a person recognises. */
export function describeAgent(ua = '') {
  const s = ua.toLowerCase()
  if (!s) return 'Unknown device'
  const browser =
    s.includes('edg/') ? 'Edge'
    : s.includes('opr/') || s.includes('opera') ? 'Opera'
    : s.includes('firefox') ? 'Firefox'
    : s.includes('chrome') || s.includes('crios') ? 'Chrome'
    : s.includes('safari') ? 'Safari'
    : 'Browser'
  const os =
    s.includes('android') ? 'Android'
    : s.includes('iphone') || s.includes('ipad') || s.includes('ios') ? 'iOS'
    : s.includes('windows') ? 'Windows'
    : s.includes('mac os') || s.includes('macintosh') ? 'macOS'
    : s.includes('linux') ? 'Linux'
    : ''
  return os ? `${browser} on ${os}` : browser
}

// A country code is only useful if it can be read and seen. The flag is drawn from the
// code itself, so no dataset is needed; the name comes from the browser's own locale
// data, so it is in the reader's language rather than ours.
const regionNames = (() => {
  try {
    return new Intl.DisplayNames(undefined, { type: 'region' })
  } catch {
    return null
  }
})()

export function describeCountry(code) {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return null
  const upper = code.toUpperCase()
  const flag = String.fromCodePoint(
    ...[...upper].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65),
  )
  const name = regionNames?.of(upper) || upper
  return { flag, name }
}

export function describeWhen(seconds, now = Date.now()) {
  if (!seconds) return 'unknown'
  const diff = Math.max(0, Math.floor(now / 1000) - seconds)
  if (diff < 90) return 'just now'
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`
  return `${Math.round(diff / 86400)} d ago`
}

/**
 * Devices signed in to this account.
 *
 * Revoking a session makes the server refuse that token immediately — the
 * listing is not cosmetic.
 */
export default function SessionsSection() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [confirmAll, setConfirmAll] = useState(false)

  const load = () =>
    userSessions()
      .then((data) => setRows(data.sessions || []))
      .catch((e) => setError(e?.response?.data?.error || 'Could not load sessions'))

  useEffect(() => { load() }, [])

  const revoke = async (id) => {
    setBusy(id); setError('')
    try {
      const data = await userRevokeSession(id)
      if (data?.current) {
        // Signed out the device in this tab: the session is already dead server
        // side, so drop local state and send the user back to sign in.
        keySession.clear()
        storage.clear()
        window.location.href = '/login'
        return
      }
      await load()
    } catch (e) {
      setError(e?.response?.data?.error || 'Could not sign that device out')
    } finally { setBusy('') }
  }

  const revokeAll = async () => {
    setBusy('all'); setError('')
    try {
      await userRevokeAllSessions()
      keySession.clear()
      storage.clear()
      window.location.href = '/login'
    } catch (e) {
      setError(e?.response?.data?.error || 'Could not sign out everywhere')
      setBusy('')
    }
  }

  if (!rows && !error) return null

  return (
    <div data-testid="sessions-section" className="rounded-lg bg-secondary/60 p-3">
      <div className="flex items-center gap-2">
        <Monitor className="w-4 h-4 text-ink-2" />
        <h4 className="text-sm font-medium flex-1">Signed-in devices</h4>
        <span className="text-[11px] text-ink-3">{rows?.length ?? 0}</span>
      </div>
      <p className="mt-1 text-[11px] text-ink-2">
        Signing a device out ends its session immediately. Useful if you left yourself signed in somewhere.
      </p>

      <ul className="mt-2 space-y-1">
        {(rows || []).map((row) => (
          <li key={row.id} data-testid="session-row" className="flex items-center gap-2 rounded bg-foreground/5 px-2 py-1.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px]">
                {describeAgent(row.user_agent)}
                {row.current && <span className="ml-1.5 rounded bg-primary/20 px-1 text-[10px] text-primary">this device</span>}
              </p>
              <p className="truncate text-[10px] text-ink-3">
                {(() => {
                  const where = describeCountry(row.country)
                  if (!where) return <span>Location unknown</span>
                  return (
                    <span title={row.country}>
                      <span aria-hidden="true" className="mr-1">{where.flag}</span>
                      {where.name}
                    </span>
                  )
                })()}
                {' · '}
                {row.ip || 'unknown address'} · seen {describeWhen(row.last_seen_at)}
              </p>
            </div>
            {!row.current && (
              <button
                type="button"
                onClick={() => revoke(row.id)}
                disabled={busy === row.id}
                className="shrink-0 rounded-md border border-line px-2 py-0.5 text-[11px] hover:bg-foreground/5 disabled:opacity-50"
              >
                {busy === row.id ? 'Signing out…' : 'Sign out'}
              </button>
            )}
          </li>
        ))}
      </ul>

      {confirmAll ? (
        <div className="mt-2 flex items-center gap-2">
          <p className="flex-1 text-[11px] text-amber-300">This signs out every device, including this one.</p>
          <button type="button" onClick={revokeAll} disabled={busy === 'all'}
            className="rounded-md bg-destructive px-2 py-1 text-[11px] text-destructive-foreground disabled:opacity-50">
            {busy === 'all' ? 'Signing out…' : 'Yes, sign out all'}
          </button>
          <button type="button" onClick={() => setConfirmAll(false)}
            className="rounded-md border border-line px-2 py-1 text-[11px]">Cancel</button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirmAll(true)}
          className="mt-2 flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] hover:bg-foreground/5">
          <LogOut className="w-3 h-3" /> Sign out everywhere
        </button>
      )}

      {error && <p data-testid="sessions-error" className="mt-1 text-[11px] text-destructive">{error}</p>}
    </div>
  )
}
