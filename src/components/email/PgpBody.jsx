import { useState } from 'react'
import { Lock, Loader2, ShieldCheck, ShieldAlert, ShieldQuestion } from 'lucide-react'
import { decryptBody, hasIdentity } from '@/pgp'

/**
 * Reader for an OpenPGP (inline) message.
 *
 * The body arrives as armored ciphertext because the sender encrypted it with
 * our public key. Decryption happens here in the browser with the passphrase —
 * the server never sees it.
 */
export function PgpBody({ armored, senderHint }) {
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const unlock = async () => {
    setError('')
    setBusy(true)
    try {
      const out = await decryptBody({ armored, passphrase, sender: senderHint })
      setResult(out)
      setPassphrase('')
    } catch (err) {
      const msg = String(err?.message ?? err)
      setError(
        /passphrase|decrypt|session key|checksum|tag/i.test(msg)
          ? 'Wrong passphrase, or this message was encrypted to a different key'
          : msg,
      )
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    const sig = result.signature
    const bad = sig === 'bad-signature' || sig === 'wrong-signer'
    const label = {
      good: 'Decrypted · signed by the key saved for this sender',
      'wrong-signer': 'Decrypted · WARNING: signed by a different key than the one saved for this sender',
      'unknown-signer': 'Decrypted · signed, but no key is saved for this sender',
      'bad-signature': 'Decrypted · WARNING: the signature does not verify',
      none: 'Decrypted · message is not signed',
    }[sig] ?? 'Decrypted'

    return (
      <div className="space-y-3">
        <div
          className={`flex items-start gap-1.5 text-[11px] rounded-md px-2.5 py-1.5 border ${
            sig === 'good'
              ? 'text-primary border-primary/30 bg-primary/10'
              : bad
                ? 'text-destructive border-destructive/40 bg-destructive/10'
                : 'text-amber-500 border-amber-500/30 bg-amber-500/10'
          }`}
        >
          {sig === 'good' ? (
            <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          ) : bad ? (
            <ShieldAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          ) : (
            <ShieldQuestion className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          )}
          <span className="space-y-0.5">
            <span className="block">{label}</span>
            {result.signerFingerprint && (
              <span className="block font-mono opacity-70 break-all">
                {result.signerFingerprint.replace(/(.{4})/g, '$1 ').trim()}
              </span>
            )}
          </span>
        </div>
        <pre className="whitespace-pre-wrap break-words font-sans text-sm/relaxed">
          {result.text}
        </pre>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-secondary/20 p-4 space-y-3 max-w-md">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Lock className="w-4 h-4 text-primary" />
        OpenPGP-encrypted message
      </div>
      <p className="text-xs text-foreground/60">
        {senderHint ? `${senderHint} sent this encrypted to your key. ` : ''}
        Enter your PGP passphrase to read it. It is never sent to the server.
      </p>
      {!hasIdentity() && (
        <p className="text-xs text-destructive">
          This browser has no OpenPGP key — import the matching private key first.
        </p>
      )}
      <div className="flex gap-2">
        <input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && passphrase) unlock()
          }}
          placeholder="PGP passphrase"
          autoComplete="off"
          className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          onClick={unlock}
          disabled={busy || !passphrase}
          className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Decrypt'}
        </button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <details className="text-[11px] text-foreground/40">
        <summary className="cursor-pointer">Show raw message</summary>
        <pre className="mt-1 whitespace-pre-wrap break-all font-mono">{armored}</pre>
      </details>
    </div>
  )
}
