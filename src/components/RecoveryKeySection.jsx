import { useEffect, useState } from 'react'
import { KeyRound, ShieldCheck, ShieldAlert } from 'lucide-react'
import RecoveryKeySetup from '@/components/RecoveryKeySetup'
import { userRecoveryKeyStatus } from '@/api'
import { keySession } from '@/keySession'
import { storage } from '@/storage'

// 2026-11-02T06:20Z: the deploy that made a recovery blob carry the ML-KEM secret as well
// as the RSA key. Anything set before it is a v1 blob.
const RECOVERY_BUNDLE_V2_FROM = Date.parse('2026-11-02T06:20:00Z')

const when = (seconds) => (seconds ? new Date(seconds * 1000).toLocaleString() : null)

/**
 * "Recovery key" section for settings, available to any signed-in user.
 *
 * Without this, a recovery key could only be created during first-time setup -
 * so every account that already existed had no way to get one.
 */
export default function RecoveryKeySection() {
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [privateKey, setPrivateKey] = useState(null)

  const refresh = async () => {
    try {
      const data = await userRecoveryKeyStatus()
      setStatus(data)
      setError('')
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not read recovery key status')
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const start = async () => {
    const key = await keySession.get()
    if (!key) {
      setError('Unlock your mailbox first — the recovery key has to wrap your private key.')
      return
    }
    setPrivateKey(key)
    setCreating(true)
  }

  return (
    <section className="rounded-xl bg-secondary/60 p-3">
      <div className="flex items-center gap-2">
        <KeyRound className="w-3.5 h-3.5 text-primary" />
        <h3 className="text-xs font-medium uppercase tracking-wide text-ink-2">Recovery key</h3>
      </div>

      {status === null && !error && <p className="mt-2 text-xs text-ink-3">Checking…</p>}

      {/* Recovery keys made before the blob carried the quantum half restore the RSA key
          and nothing else: the account comes back, mail sealed afterwards does not open.
          The date is the deploy that changed the format; a key set before it is a v1 blob. */}
      {status?.set && status.set_at * 1000 < RECOVERY_BUNDLE_V2_FROM && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-400">
          <ShieldAlert className="mt-0.5 w-3.5 h-3.5 shrink-0" />
          <span>
            This key was made before recovery covered your quantum key. It restores your account,
            but mail sealed since then would stay unreadable — replace it below.
          </span>
        </p>
      )}

      {status && (
        <div className="mt-2 space-y-2">
          {status.set ? (
            <p className="flex items-start gap-1.5 text-xs text-green-400">
              <ShieldCheck className="mt-0.5 w-3.5 h-3.5 shrink-0" />
              <span>
                Set {when(status.set_at)}. {status.used_at > 0 && `Last used ${when(status.used_at)} — create a new one.`}
              </span>
            </p>
          ) : (
            <p className="flex items-start gap-1.5 text-xs text-amber-400">
              <ShieldAlert className="mt-0.5 w-3.5 h-3.5 shrink-0" />
              <span>
                No recovery key. If you forget your password, your encrypted mail cannot be recovered.
              </span>
            </p>
          )}

          <button
            onClick={start}
            className="w-full rounded-lg border border-line-strong px-3 py-2 text-xs hover:bg-foreground/5"
          >
            {status.set ? 'Replace recovery key' : 'Create recovery key'}
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      {creating && privateKey && (
        <RecoveryKeySetup
          privateKey={privateKey}
          username={storage.getUsername()}
          onDone={() => {
            setCreating(false)
            setPrivateKey(null)
            refresh()
          }}
        />
      )}
    </section>
  )
}
