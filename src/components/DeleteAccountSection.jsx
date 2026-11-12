import { useState } from 'react'
import { Trash2, AlertTriangle } from 'lucide-react'
import { hashPassword } from '@/crypto'
import { userDeleteAccount } from '@/api'
import { cryptoUnavailableMessage, isCryptoUnavailable } from '@/lib/cryptoFailure'

// Closing your own mailbox. The server releases everything with the account:
// mail, encrypted blobs, recovery record, second factor and sessions. That is
// the promise, so the confirmation has to be deliberate rather than a stray
// click.
export default function DeleteAccountSection({ onDeleted }) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmWord, setConfirmWord] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (confirmWord.trim().toUpperCase() !== 'DELETE') {
      setError('Type DELETE to confirm')
      return
    }
    setBusy(true)
    try {
      const token = await hashPassword(password)
      await userDeleteAccount(token)
      // Nothing on this device should outlive the account.
      try {
        localStorage.removeItem('sloth.pgp.keyring.v1')
        localStorage.removeItem('sloth.profile.v1')
        sessionStorage.clear()
      } catch {
        // ignore
      }
      if (onDeleted) onDeleted()
      else window.location.replace('/login')
    } catch (err) {
      setError(
        isCryptoUnavailable(err)
          ? cryptoUnavailableMessage('password step')
          : err?.message || 'The account could not be deleted',
      )
      setBusy(false)
    }
  }

  return (
    <section className="mb-4 rounded-xl bg-red-950/25 p-4">
      <div className="mb-2 flex items-center gap-2">
        <Trash2 size={16} className="text-red-400" />
        <h3 className="text-sm font-medium text-red-200">Delete this account</h3>
      </div>
      <p className="mb-3 text-xs text-ink-2">
        Deletes the mailbox, every message stored for it, your recovery record,
        two-factor setup and all signed-in devices. This cannot be undone, and
        mail already sent to others is not affected.
      </p>

      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="rounded-lg border border-red-800 px-3 py-1.5 text-sm text-red-300 hover:bg-red-950/50"
        >
          Delete account…
        </button>
      ) : (
        <form onSubmit={submit} className="space-y-2">
          <div className="flex items-start gap-2 rounded-lg bg-red-950/40 p-2 text-xs text-red-200">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>Your encrypted mail cannot be recovered after this. Export anything you want to keep first.</span>
          </div>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
            autoComplete="current-password"
            className="w-full rounded-lg border border-line-strong bg-field px-3 py-2 text-sm text-ink-1 outline-none focus:border-line-strong"
          />
          <input
            value={confirmWord}
            onChange={(e) => setConfirmWord(e.target.value)}
            placeholder="Type DELETE to confirm"
            className="w-full rounded-lg border border-line-strong bg-field px-3 py-2 text-sm text-ink-1 outline-none focus:border-line-strong"
          />
          {error ? <p className="text-xs text-red-300">{error}</p> : null}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
            >
              {busy ? 'Deleting…' : 'Permanently delete'}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setError(''); setPassword(''); setConfirmWord('') }}
              className="rounded-lg border border-line-strong px-3 py-1.5 text-sm text-ink-2 hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
