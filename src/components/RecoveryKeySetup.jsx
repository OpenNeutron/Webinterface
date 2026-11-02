import { useState, useEffect } from 'react'
import { KeyRound, Download, Copy, ShieldCheck, AlertTriangle } from 'lucide-react'
import { generateRecoveryKey, wrapPrivateKeyWithRecovery, recoveryAuthProof, newRecoverySalt, normalizeRecoveryKey } from '@/lib/recoveryKey'
import { userSetRecoveryKey } from '@/api'
import { keySession } from '@/keySession'

/**
 * Shown immediately after an account's key pair is created.
 *
 * The point of this screen is that it cannot be skipped silently: the user
 * either saves the key or explicitly accepts that forgetting their password
 * means losing the archive.
 */
export default function RecoveryKeySetup({ privateKey, username, onDone }) {
  const [recoveryKey, setRecoveryKey] = useState('')
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmSkip, setConfirmSkip] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    generateRecoveryKey().then(({ text }) => {
      if (!cancelled) setRecoveryKey(text)
    })
    return () => { cancelled = true }
  }, [])

  const groups = recoveryKey ? recoveryKey.split('-') : []
  const expectedCheck = groups.slice(0, 2).join('')
  const typedCheck = normalizeRecoveryKey(typed)
  const confirmed = expectedCheck.length === 8 && typedCheck === expectedCheck

  const download = () => {
    const body = [
      'Sloth Lee Mail — recovery key',
      '',
      `Account: ${username || '(this account)'}`,
      `Created: ${new Date().toISOString()}`,
      '',
      'Recovery key:',
      recoveryKey,
      '',
      'Keep this somewhere separate from your computer and phone.',
      'Anyone holding it can unlock your mailbox. Without it, a forgotten',
      'password means the encrypted mail is unrecoverable.',
      '',
      'This key works once, then you will be asked for a new one.',
    ].join('\n')
    const blob = new Blob([body], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'slothlee-recovery-key.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(recoveryKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Clipboard unavailable — select the key and copy it by hand')
    }
  }

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const salt = newRecoverySalt()
      // Both halves or the recovery is a half-recovery: an account restored without
      // the ML-KEM secret cannot open any message sealed since quantum protection.
      const pqSecret = keySession.getPq()
      const wrapped = await wrapPrivateKeyWithRecovery(privateKey, recoveryKey, salt, pqSecret)
      const proof = await recoveryAuthProof(recoveryKey)
      await userSetRecoveryKey(wrapped, salt, proof)
      onDone()
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Could not save the recovery key')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-2xl">
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-medium">Save your recovery key</h2>
        </div>

        <p className="mt-2 text-xs text-foreground/60">
          This key is the only way back in if you forget your password — without it, encrypted mail
          is gone for good. It is not stored anywhere you can look it up later.
        </p>

        <div className="mt-3 rounded-lg border border-border bg-black/40 p-3">
          <code className="block break-all font-mono text-[13px] leading-6 text-foreground">
            {recoveryKey || 'generating…'}
          </code>
        </div>

        <div className="mt-3 flex gap-2">
          <button
            onClick={download}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs hover:bg-foreground/5"
          >
            <Download className="w-3.5 h-3.5" /> Download file
          </button>
          <button
            onClick={copy}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs hover:bg-foreground/5"
          >
            <Copy className="w-3.5 h-3.5" /> {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        <label className="mt-4 block text-xs uppercase tracking-wide text-foreground/50">
          Type the first two groups to confirm you have it
        </label>
        <input
          id="recovery-confirm"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="XXXX-XXXX"
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm tracking-widest"
        />

        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

        <button
          onClick={save}
          disabled={!confirmed || busy}
          className="mt-4 w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? 'Saving…' : confirmed ? 'Save recovery key' : 'Type the key to continue'}
        </button>

        {confirmSkip ? (
          <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
            <p className="flex items-start gap-2 text-xs text-amber-400">
              <AlertTriangle className="mt-0.5 w-3.5 h-3.5 shrink-0" />
              Without a recovery key, forgetting your password permanently loses every encrypted
              message you have received.
            </p>
            <div className="mt-2 flex gap-2">
              <button onClick={onDone} className="rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs text-amber-300">
                I understand, skip
              </button>
              <button onClick={() => setConfirmSkip(false)} className="rounded-lg px-3 py-1.5 text-xs text-foreground/60">
                Go back
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirmSkip(true)}
            className="mt-3 w-full text-center text-[11px] text-foreground/35 hover:text-foreground/60"
          >
            Skip — I accept losing my mail if I forget my password
          </button>
        )}

        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-foreground/35">
          <ShieldCheck className="w-3 h-3" /> Stored encrypted. The server cannot open it.
        </p>
      </div>
    </div>
  )
}
