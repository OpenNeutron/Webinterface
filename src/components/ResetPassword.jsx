import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { hashPassword } from '@/crypto'
import { resetWithToken } from '@/api'
import AuthShell, { Field, PasswordInput } from '@/components/AuthShell'
import { Button } from '@/components/ui/button'
import { cryptoUnavailableMessage, isCryptoUnavailable } from '@/lib/cryptoFailure'

/**
 * Public page reached from the recovery email: choose a new password.
 *
 * The token in the URL is the only proof of identity, which is why it is
 * single-use and expires. The password is hashed here exactly like login, so
 * the server never sees it.
 */
export default function ResetPassword() {
  const [params] = useSearchParams()
  const token = params.get('t') || ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setError('')

    if (!token) {
      setError('This link is missing its code. Ask the operator for a new one.')
      return
    }
    if (password.length < 8) {
      setError('Use at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('The two passwords do not match.')
      return
    }

    setBusy(true)
    try {
      const credentials = await hashPassword(password)
      await resetWithToken(token, credentials)
      setDone(true)
    } catch (err) {
      if (isCryptoUnavailable(err)) {
        setError(cryptoUnavailableMessage('password step'))
        setBusy(false)
        return
      }
      const message = err?.response?.data?.error
      setError(message || 'That reset link is invalid or has expired.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell>
      <h1 className="display text-[24px] leading-tight text-ink-1">Choose a new password</h1>
      <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">
        This link works once and expires an hour after it was sent.
      </p>

      {done ? (
        <div className="mt-7 space-y-4">
          <p className="text-[12.5px] leading-relaxed text-ink-2">
            Your password is set. Sign in with it and you will be asked to create a new encryption key.
          </p>
          <p className="text-[12px] leading-relaxed text-ink-3">
            Mail that was encrypted to your old key cannot be read any more. If you exported a copy
            of that key, import it after signing in — everything opens again.
          </p>
          <Link
            to="/login"
            className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition-colors duration-120 hover:bg-primary/90"
          >
            Go to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-7 space-y-4">
          <Field label="New password" id="reset-password">
            <PasswordInput
              id="reset-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="At least 8 characters"
            />
          </Field>
          <Field label="Repeat password" id="reset-confirm">
            <PasswordInput
              id="reset-confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              placeholder="Repeat it"
            />
          </Field>

          {error && (
            <p id="reset-message" className="text-[12.5px] leading-relaxed text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Saving…' : 'Set new password'}
          </Button>
        </form>
      )}
    </AuthShell>
  )
}
