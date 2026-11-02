import { useState } from 'react'
import { Link } from 'react-router-dom'
import { hashPassword, encryptPrivateKey } from '@/crypto'
import { unwrapRecoveryBundle, recoveryAuthProof } from '@/lib/recoveryKey'
import { wrapSecretBytes } from '@/crypto'
import { userFetchRecoveryBlob, userRestoreWithRecoveryKey } from '@/api'
import AuthShell from '@/components/AuthShell'
import { cryptoUnavailableMessage, isCryptoUnavailable } from '@/lib/cryptoFailure'

/**
 * Public page: regain access with a saved recovery key.
 *
 * Unlike an emailed reset, this keeps the *same* private key, so previously
 * received mail still decrypts. The key is unwrapped locally; the server only
 * ever sees a one-way proof and the re-wrapped key.
 */
export default function RecoverAccount() {
  const [step, setStep] = useState('username') // username -> key -> password -> done
  const [username, setUsername] = useState('')
  const [secret, setSecret] = useState('')
  const [bundle, setBundle] = useState(null)
  const [recoveredKey, setRecoveredKey] = useState(null)
  // null when the blob predates quantum protection; the done screen says so.
  const [recoveredPq, setRecoveredPq] = useState(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const b64ToBytes = (text) => {
    const binary = atob(text)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
    return out
  }

  const fail = (err, fallback) => {
    setError(
      isCryptoUnavailable(err)
        ? cryptoUnavailableMessage('password step')
        : err?.response?.data?.error || err?.message || fallback,
    )
    setBusy(false)
  }

  const lookup = async (event) => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const data = await userFetchRecoveryBlob(username.trim().toLowerCase())
      setBundle(data)
      setStep('key')
      setBusy(false)
    } catch (err) {
      fail(err, 'No recovery key is on file for that account')
    }
  }

  const unlock = async (event) => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const opened = await unwrapRecoveryBundle(bundle.wrapped_key, secret, bundle.kdf_salt)
      setRecoveredKey(opened.privateKey)
      setRecoveredPq(opened.pqSecret)
      setStep('password')
      setBusy(false)
    } catch (err) {
      fail(err, 'That recovery key does not unlock this account')
    }
  }

  const finish = async (event) => {
    event.preventDefault()
    setError('')
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
      const wrapped = await encryptPrivateKey(recoveredKey, password, bundle.account_salt)
      // Re-wrap the quantum secret under the new password, or it stays locked behind
      // a password that no longer exists.
      const wrappedPq = recoveredPq
        ? await wrapSecretBytes(b64ToBytes(recoveredPq), password, bundle.kdf_salt)
        : null
      const proof = await recoveryAuthProof(secret)
      await userRestoreWithRecoveryKey({
        username: username.trim().toLowerCase(),
        auth_proof: proof,
        credentials,
        wrapped_key: wrapped,
        kdf_salt: bundle.account_salt,
        ...(wrappedPq ? { wrapped_pq_key: wrappedPq } : {}),
      })
      setStep('done')
    } catch (err) {
      fail(err, 'Could not restore the account')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell>
      <h1 className="display text-[24px] leading-tight text-ink-1">Recover your account</h1>
      <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">
        A recovery key is the only thing that opens mail encrypted to a key you have lost. Your
        password alone cannot.
      </p>

        {step === 'username' && (
          <form onSubmit={lookup} className="mt-4 space-y-4">
            <p className="text-[12.5px] leading-relaxed text-ink-2">
              Enter your mailbox name. You will need the recovery key you saved when the account was
              created.
            </p>
            <div>
              <label htmlFor="recover-username" className="mb-1.5 block text-[12px] font-medium text-ink-2">
                Username
              </label>
              <input
                id="recover-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="h-10 w-full rounded-lg border border-line-strong bg-field px-3 text-[13.5px] text-ink-1"
              />
            </div>
            {error && <p id="recover-message" className="text-[12.5px] text-destructive">{error}</p>}
            <button
              type="submit"
              disabled={busy || !username.trim()}
              className="h-10 w-full rounded-lg bg-primary text-[13px] font-semibold text-primary-foreground transition-colors duration-120 hover:bg-primary/90 disabled:opacity-60"
            >
              {busy ? 'Looking…' : 'Continue'}
            </button>
          </form>
        )}

        {step === 'key' && (
          <form onSubmit={unlock} className="mt-4 space-y-4">
            <p className="text-[12.5px] leading-relaxed text-ink-2">
              Paste the recovery key for <span className="text-foreground/80">{username}</span>.
              Dashes and letter case do not matter.
            </p>
            <div>
              <label htmlFor="recover-key" className="mb-1.5 block text-[12px] font-medium text-ink-2">
                Recovery key
              </label>
              <input
                id="recover-key"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="XXXX-XXXX-XXXX-…"
                className="h-10 w-full rounded-lg border border-line-strong bg-field px-3 mono text-[13px] text-ink-1"
              />
            </div>
            {error && <p id="recover-message" className="text-[12.5px] text-destructive">{error}</p>}
            <button
              type="submit"
              disabled={busy || !secret.trim()}
              className="h-10 w-full rounded-lg bg-primary text-[13px] font-semibold text-primary-foreground transition-colors duration-120 hover:bg-primary/90 disabled:opacity-60"
            >
              {busy ? 'Unlocking…' : 'Unlock my mailbox'}
            </button>
          </form>
        )}

        {step === 'password' && (
          <form onSubmit={finish} className="mt-4 space-y-4">
            <p className="text-[12.5px] leading-relaxed text-ink-2">
              Your key is unlocked. Choose a new password — your existing mail stays readable.
            </p>
            <div>
              <label htmlFor="recover-password" className="mb-1.5 block text-[12px] font-medium text-ink-2">
                New password
              </label>
              <input
                id="recover-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-10 w-full rounded-lg border border-line-strong bg-field px-3 text-[13.5px] text-ink-1"
              />
            </div>
            <div>
              <label htmlFor="recover-confirm" className="mb-1.5 block text-[12px] font-medium text-ink-2">
                Repeat password
              </label>
              <input
                id="recover-confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="h-10 w-full rounded-lg border border-line-strong bg-field px-3 text-[13.5px] text-ink-1"
              />
            </div>
            {error && <p id="recover-message" className="text-[12.5px] text-destructive">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="h-10 w-full rounded-lg bg-primary text-[13px] font-semibold text-primary-foreground transition-colors duration-120 hover:bg-primary/90 disabled:opacity-60"
            >
              {busy ? 'Saving…' : 'Set new password and sign in'}
            </button>
          </form>
        )}

        {step === 'done' && (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-foreground/70">
              Your account is restored and every message you already had is still readable.
            </p>
            <p className="text-xs text-foreground/50">
              That recovery key is now spent. After you sign in, create a new one.
            {recoveredPq === null && (
              <span className="mt-2 block text-[12px] text-sand">
                This recovery key was made before quantum protection existed, so it restored your
                password and your key but not the extra quantum half. Messages sealed with that half
                will not open. After you sign in, turn post-quantum protection on again in Settings —
                that creates a fresh key, and from then on your recovery key covers both.
              </span>
            )}
            </p>
            <Link to="/login" className="inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              Go to sign in
            </Link>
          </div>
        )}

        {step !== 'done' && (
          <p className="mt-6 text-[11.5px] leading-relaxed text-ink-3">
            No recovery key? <Link to="/login" className="text-ink-2 underline underline-offset-2">Back to sign in</Link>
            {' '}— a password reset restores access to the account, but not to mail encrypted with the
            key you lost.
          </p>
        )}
    </AuthShell>
  )
}
