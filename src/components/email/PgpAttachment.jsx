import { useState } from 'react'
import { Lock, Loader2, Download } from 'lucide-react'
import { decryptAttachment } from '@/pgp'

function base64ToText(b64) {
  try {
    return decodeURIComponent(escape(atob(b64)))
  } catch {
    return atob(b64)
  }
}

/**
 * The parser hands attachments back already decoded, but some code paths carry
 * base64. Accept either so an encrypted file is never silently unreadable.
 */
function armorFromAttachment(att) {
  const raw = att?.data ?? ''
  if (typeof raw !== 'string') return ''
  if (raw.includes('BEGIN PGP MESSAGE')) return raw
  try {
    return base64ToText(raw)
  } catch {
    return raw
  }
}

export { isPgpAttachment } from '@/lib/pgpRing'

/**
 * An attachment that arrived encrypted. It is a normal attachment on the wire,
 * but its contents are an armored PGP message, so the passphrase turns it back
 * into the original file.
 */
export function PgpAttachment({ att }) {
  const [asking, setAsking] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const originalName = (att.name ?? 'attachment').replace(/\.(asc|pgp|gpg)$/i, '')

  const decryptAndDownload = async () => {
    setError('')
    setBusy(true)
    try {
      const armored = armorFromAttachment(att)
      const bytes = await decryptAttachment({ armored, passphrase })
      const blob = new Blob([bytes], { type: 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = originalName
      a.click()
      URL.revokeObjectURL(url)
      setAsking(false)
      setPassphrase('')
    } catch (err) {
      const msg = String(err?.message ?? err)
      setError(/passphrase|decrypt|session key|checksum|tag/i.test(msg) ? 'Wrong passphrase' : msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="inline-flex flex-col gap-2 px-3 py-2 rounded-lg bg-white/5 border border-primary/25">
      <div className="flex items-center gap-2.5">
        <Lock className="size-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground truncate max-w-[200px]">{originalName}</p>
          <p className="text-xs text-primary/70">Encrypted · OpenPGP</p>
        </div>
        {!asking && (
          <button
            onClick={() => setAsking(true)}
            className="ml-1 px-2 py-1 rounded text-xs font-medium bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
          >
            Decrypt
          </button>
        )}
      </div>

      {asking && (
        <div className="flex items-center gap-1.5">
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && passphrase) decryptAndDownload()
            }}
            placeholder="PGP passphrase"
            autoComplete="off"
            autoFocus
            className="flex-1 min-w-0 rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            onClick={decryptAndDownload}
            disabled={busy || !passphrase}
            className="px-2 py-1 rounded bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50"
            title="Decrypt and download"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
          </button>
        </div>
      )}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  )
}
