import { useCallback, useEffect, useState } from 'react'
import { KeyRound, Plus, Trash2, ShieldCheck } from 'lucide-react'
import {
  userSecurityKeys,
  userSecurityKeyRegisterBegin,
  userSecurityKeyRegisterFinish,
  userSecurityKeyRemove,
} from '@/api'
import { createSecurityKey, describeKeyError, securityKeyProblem } from '@/lib/webauthn'

const when = (unix) => {
  if (!unix) return 'never used'
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - unix)
  if (diff < 60) return 'used just now'
  if (diff < 3600) return `used ${Math.floor(diff / 60)} min ago`
  if (diff < 86400) return `used ${Math.floor(diff / 3600)} h ago`
  return `used ${new Date(unix * 1000).toLocaleDateString()}`
}

/**
 * Security keys (YubiKey and anything else that speaks WebAuthn).
 *
 * Two rules this screen keeps: a key can only be added or removed with a fresh
 * authenticator code, and a key is never described as "the only way in" —
 * TOTP and the recovery codes stay available, so losing the hardware is an
 * inconvenience rather than a lockout.
 */
export default function SecurityKeysSection() {
  const [data, setData] = useState(null)
  const [phase, setPhase] = useState('idle') // idle | adding | removing
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [target, setTarget] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const problem = securityKeyProblem()

  const refresh = useCallback(() => {
    userSecurityKeys()
      .then((d) => setData(d))
      .catch(() => setData({ keys: [], max: 10 }))
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const startAdd = () => {
    setPhase('adding')
    setError('')
    setNotice('')
    setCode('')
    setName('')
  }

  const addKey = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      // The code is proven first: without it a stolen session could enrol a key
      // of its own and keep access after the password is changed.
      const begun = await userSecurityKeyRegisterBegin(code.trim())
      const credential = await createSecurityKey(begun.options)
      await userSecurityKeyRegisterFinish({
        challenge_id: begun.challenge_id,
        name: name.trim() || 'Security key',
        clientDataJSON: credential.clientDataJSON,
        attestationObject: credential.attestationObject,
      })
      setPhase('idle')
      setNotice('Security key added. It can be used the next time you sign in.')
      refresh()
    } catch (err) {
      const serverError = err?.response?.data?.error
      setError(serverError || describeKeyError(err))
    } finally {
      setBusy(false)
    }
  }

  const removeKey = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await userSecurityKeyRemove(target.id, code.trim())
      setPhase('idle')
      setTarget(null)
      setCode('')
      setNotice('Security key removed.')
      refresh()
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not remove that key')
    } finally {
      setBusy(false)
    }
  }

  const keys = data?.keys || []
  const atCap = data && keys.length >= (data.max || 10)
  // Only ask for a code when the account actually has one to give.
  const codeRequired = data?.code_required !== false

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-secondary/60 p-4">
        <div className="flex items-start gap-3">
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
          <div className="min-w-0">
            <p className="text-[13px] leading-relaxed text-ink-2">
              A security key such as a YubiKey proves it is really you by signing a challenge
              inside the key itself. Nothing secret leaves the hardware, and the server only
              ever stores the matching public key.
            </p>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-3">
              Your authenticator app and recovery codes keep working. A lost key is never the
              only way back into your account.
            </p>
          </div>
        </div>
      </div>

      {problem && (
        <p className="rounded-lg bg-destructive/10 p-3 text-[12.5px] leading-relaxed text-destructive">
          {problem}
        </p>
      )}

      {notice && <p className="text-[12.5px] text-primary">{notice}</p>}
      {error && <p className="text-[12.5px] leading-relaxed text-destructive">{error}</p>}

      {keys.length === 0 ? (
        <p className="text-[12.5px] text-ink-3">No security keys are registered yet.</p>
      ) : (
        <ul className="space-y-2">
          {keys.map((key) => (
            <li
              key={key.id}
              className="flex items-center justify-between gap-3 rounded-lg bg-secondary/60 px-4 py-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-ink-1">{key.name}</p>
                  <p className="text-[11.5px] text-ink-3">
                    added {new Date(key.created_at * 1000).toLocaleDateString()} · {when(key.last_used_at)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setPhase('removing'); setTarget(key); setCode(''); setError('') }}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors duration-120 hover:bg-destructive/10 hover:text-destructive"
                aria-label={`Remove ${key.name}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {phase === 'adding' && (
        <form onSubmit={addKey} className="space-y-3 rounded-lg bg-secondary/60 p-4" data-testid="security-key-add">
          <p className="text-[12.5px] leading-relaxed text-ink-2">
            {codeRequired
              ? 'Enter a code from your authenticator app, then touch the key when it blinks.'
              : 'Have the key ready — the browser will ask you to touch it in a moment.'}
          </p>
          {codeRequired && (
            <input
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.trim())}
              className="w-full rounded-md border border-line bg-background px-2.5 py-2.5 text-[13px] text-ink-1"
              data-testid="security-key-code"
            />
          )}
          <input
            placeholder="Name this key (e.g. blue YubiKey)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            className="w-full rounded-md border border-line bg-background px-3 py-2.5 text-[13px] text-ink-1"
            data-testid="security-key-name"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || (codeRequired && !code.trim()) || !!problem}
              className="h-11 flex-1 rounded-md bg-primary px-4 text-[13px] font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy ? 'Waiting for the key…' : 'Add security key'}
            </button>
            <button
              type="button"
              onClick={() => { setPhase('idle'); setError('') }}
              className="h-11 rounded-md px-4 text-[13px] text-ink-2 hover:text-ink-1"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {phase === 'removing' && target && (
        <form onSubmit={removeKey} className="space-y-3 rounded-lg bg-secondary/60 p-4" data-testid="security-key-remove">
          <p className="text-[12.5px] leading-relaxed text-ink-2">
            Remove <span className="font-medium text-ink-1">{target.name}</span>.
            {codeRequired ? ' Enter a code from your authenticator app to confirm.' : ' It will stop working at sign-in immediately.'}
          </p>
          {codeRequired && (
            <input
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.trim())}
              className="w-full rounded-md border border-line bg-background px-2.5 py-2.5 text-[13px] text-ink-1"
            />
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || (codeRequired && !code.trim())}
              className="h-11 flex-1 rounded-md bg-destructive px-4 text-[13px] font-medium text-white disabled:opacity-50"
            >
              {busy ? 'Removing…' : 'Remove key'}
            </button>
            <button
              type="button"
              onClick={() => { setPhase('idle'); setTarget(null); setError('') }}
              className="h-11 rounded-md px-4 text-[13px] text-ink-2 hover:text-ink-1"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {phase === 'idle' && (
        <button
          type="button"
          onClick={startAdd}
          disabled={!!problem || atCap}
          className="flex h-11 items-center gap-2 rounded-md bg-secondary/60 px-4 text-[13px] font-medium text-ink-1 transition-colors duration-120 hover:bg-secondary disabled:opacity-50"
          data-testid="security-key-add-button"
        >
          <Plus className="h-4 w-4" />
          {atCap ? 'Key limit reached' : 'Add a security key'}
        </button>
      )}
    </div>
  )
}
