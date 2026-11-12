import { useEffect, useRef, useState } from 'react'
import { Check, KeyRound, Loader2, ShieldCheck, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { keySession } from '@/keySession'
import { enablePostQuantum, fetchPostQuantumStatus } from '@/lib/pqSetup'
import { toast } from '@/lib/toast'
import { runReseal } from '@/lib/reseal'
import { makeResealIo } from '@/lib/resealIo'
import { fetchPostQuantumMigration } from '@/lib/pqSetup'

/**
 * Post-quantum protection, stated as what it is.
 *
 * Mail is sealed to the account key with RSA today; RSA is what a quantum
 * computer breaks outright, and mail is the data someone harvests now to read
 * later. Turning this on adds an ML-KEM-768 half to every new message, so
 * opening one needs both keys.
 *
 * Two things this panel refuses to blur: messages stored before the switch stay
 * RSA-only (they would have to be decrypted and re-sealed one by one), and the
 * key itself is wrapped with the account password, so enabling it needs that
 * password once — in the browser, never sent anywhere.
 */
export default function PostQuantumSection() {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [migration, setMigration] = useState(null)
  const [resealing, setResealing] = useState(false)
  const [progress, setProgress] = useState(null)
  const [outcome, setOutcome] = useState(null)
  const stopRef = useRef(false)

  useEffect(() => {
    let alive = true
    fetchPostQuantumStatus()
      .then((s) => {
        if (!alive) return
        setStatus(s)
        if (s?.enabled) {
          fetchPostQuantumMigration().then((m) => { if (alive) setMigration(m) }).catch(() => {})
        }
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const reseal = async () => {
    setOutcome(null)
    setResealing(true)
    stopRef.current = false
    try {
      const { io, keys } = await makeResealIo(status)
      const result = await runReseal({
        keys,
        io,
        onProgress: setProgress,
        shouldStop: () => stopRef.current,
      })
      setOutcome(result)
      if (result.resealed > 0) toast(`${result.resealed} message${result.resealed === 1 ? '' : 's'} re-sealed`)
    } catch (err) {
      setOutcome({ resealed: 0, failed: [], error: err?.response?.data?.error || err?.message || 'Re-sealing stopped' })
    } finally {
      setResealing(false)
      setProgress(null)
      fetchPostQuantumMigration().then(setMigration).catch(() => {})
    }
  }

  const enable = async (e) => {
    e.preventDefault()
    setError('')
    if (!password) { setError('Enter your password to protect the new key with it'); return }
    setBusy(true)
    try {
      await enablePostQuantum(password, keySession.getSalt())
      setStatus(await fetchPostQuantumStatus())
      setPassword('')
      toast('Post-quantum protection is on for new mail')
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'That could not be enabled')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[12.5px] text-ink-3">
        <Loader2 className="size-3.5 animate-spin" /> Checking…
      </div>
    )
  }

  const on = !!status?.enabled

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        {on ? (
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
        ) : (
          <KeyRound className="mt-0.5 size-3.5 shrink-0 text-sand" />
        )}
        <div className="min-w-0">
          <p className="text-[12.5px] text-ink-1">
            {on ? 'On — ML-KEM-768' : 'Not enabled'}
            {on && status?.created_at ? (
              <span className="text-ink-3">
                {' · '}sealing since {new Date(status.created_at * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 max-w-[62ch] text-[11.5px] leading-relaxed text-ink-3">
            {on
              ? 'New mail is sealed with an RSA key and a post-quantum key together: opening it needs both, so breaking one leaves the message closed. Mail stored before you switched is sealed with RSA alone — that can be fixed message by message, in this browser.'
              : 'Mail is sealed with RSA only. RSA is the part a quantum computer breaks, and stored mail is exactly what gets harvested today to read later. Turning this on adds a post-quantum half to every new message.'}
            {on
              ? ' It cannot be switched off: messages already sealed this way need the key, so removing it would make them unreadable.'
              : ''}
          </p>
        </div>
      </div>

      {on && migration && (
        <div className="rounded-md bg-secondary/60 px-3 py-2.5">
          {resealing ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[12px] text-ink-1">
                  Re-sealing {progress ? `${progress.done} of ${progress.total}` : '…'}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { stopRef.current = true }}
                  disabled={stopRef.current}
                  className="gap-1.5 max-sm:min-h-[44px]"
                >
                  <Square className="size-3" /> Stop
                </Button>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-line">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300"
                  style={{ width: `${progress?.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
                />
              </div>
            </div>
          ) : migration.pending > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-[52ch] text-[12px] leading-relaxed text-ink-2">
                <span className="text-ink-1">{migration.pending} of {migration.total}</span> messages are
                still sealed with RSA alone.
              </p>
              <Button onClick={reseal} className="gap-2 max-sm:min-h-[44px]">
                <ShieldCheck className="size-3.5" /> Re-seal them
              </Button>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-[12px] text-ink-2">
              <Check className="size-3.5 shrink-0 text-primary" />
              All {migration.total} messages are sealed with both keys.
            </p>
          )}

          {!resealing && migration.pending > 0 && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-4">
              Each message is opened and sealed again in this browser, twenty at a time — the plaintext
              never leaves it. Stopping is safe: it resumes from whatever is still sealed the old way.
            </p>
          )}

          {outcome && !resealing && (
            <div className="mt-2 space-y-1.5">
              <p className={`text-[11.5px] ${outcome.error || outcome.failed?.length ? 'text-sand' : 'text-ink-2'}`}>
                {outcome.error
                  ? `Stopped: ${outcome.error}`
                  : `${outcome.resealed} re-sealed${outcome.failed?.length ? `, ${outcome.failed.length} could not be opened and were left as they were` : ''}.`}
              </p>
              {outcome.failed?.length > 0 && (
                <ul className="space-y-1 rounded-lg bg-secondary/60 p-2.5" data-testid="pq-failed-list">
                  {outcome.failed.slice(0, 5).map((f) => (
                    <li key={String(f.uid)} className="mono text-[11px] leading-relaxed text-ink-2">
                      message …{String(f.uid).slice(-8)} — {f.reason}
                    </li>
                  ))}
                  {outcome.failed.length > 5 && (
                    <li className="mono text-[11px] text-ink-3">and {outcome.failed.length - 5} more</li>
                  )}
                  <li className="text-[11px] leading-relaxed text-ink-3">
                    A message like this was sealed to a key this account no longer holds — usually one
                    from before a key was replaced. Re-sealing it would destroy it, so it is left alone.
                    A key backup file made before the change can still open it.
                  </li>
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {!on && (
        <form onSubmit={enable} className="space-y-2">
          <label htmlFor="pq-password" className="label">
            Account password
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="pq-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              autoComplete="current-password"
              className="w-full max-w-[320px] max-sm:min-h-[44px]"
            />
            <Button type="submit" disabled={busy} className="gap-2 max-sm:min-h-[44px]">
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              {busy ? 'Creating…' : 'Turn on'}
            </Button>
          </div>
          <p className="text-[11px] text-ink-4">
            The key is wrapped with your password in this browser before it is stored. The server
            never sees the password or the unwrapped key.
          </p>
          {error && <p className="text-[11.5px] text-destructive">{error}</p>}
        </form>
      )}
    </div>
  )
}
