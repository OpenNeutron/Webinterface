import { useState } from 'react'
import { Eye, EyeOff, Lock, TriangleAlert } from 'lucide-react'
import { keySession } from '@/keySession'
import { storage } from '@/storage'
import { emailListAll, emailGetRaw } from '@/api'
import { decryptEmailBytes } from '@/crypto'
import { decryptStored } from '@/lib/decryptStored'
import { exportMailbox, collectRaw, downloadBytes, downloadText } from '@/lib/exportMailbox'
import { sealArchive } from '@/lib/slotharc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * Getting your mail out.
 *
 * Two formats, and the difference is stated rather than implied: a sealed archive
 * that only this passphrase opens, and a plain .mbox that anything can read. The
 * plain one stays because leaving with your mail should not force a tool choice,
 * but it says out loud that it writes every message to disk in the clear.
 */
export default function ExportSection() {
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState('')
  const [reveal, setReveal] = useState(false)
  const [status, setStatus] = useState({ kind: '', text: '' })

  const say = (text, kind = 'info') => setStatus({ kind, text })

  async function readMailbox() {
    const privateKey = await keySession.get()
    if (!privateKey) {
      throw new Error('Unlock your encryption key first, then try again.')
    }
    say('Reading your mailbox…')
    const { messages, failed } = await collectRaw({
      list: emailListAll,
      get: emailGetRaw,
      // Bytes, not text: only the client can decrypt, and a string conversion
      // would rewrite any MIME that is not valid UTF-8.
      decryptBytes: (data, key) =>
        decryptEmailBytes(data, key, privateKey, keySession.getPq(), storage.getUsername() || ''),
    })
    return { messages, failed }
  }

  async function exportSealed(e) {
    e.preventDefault()
    if (passphrase.length < 8) return say('Use a passphrase of at least 8 characters', 'error')
    if (passphrase !== confirm) return say('The two passphrases do not match', 'error')
    setBusy('sealed')
    setStatus({ kind: '', text: '' })
    try {
      const { messages, failed } = await readMailbox()
      say('Sealing…')
      const archive = await sealArchive(
        messages,
        passphrase,
        { account: storage.getUsername() || '' },
        ({ done, total }) => say(`Sealing… ${done} of ${total}`),
      )
      const stamp = new Date().toISOString().slice(0, 10)
      downloadBytes(`sloth-lee-mail-${stamp}.slotharc`, archive, 'application/x-slotharc')
      setPassphrase('')
      setConfirm('')
      say(
        failed.length
          ? `Sealed ${messages.length} messages. ${failed.length} could not be decrypted and were left out.`
          : `Sealed ${messages.length} messages. Keep the passphrase — without it the file cannot be opened by anyone, including us.`,
        failed.length ? 'warn' : 'ok',
      )
    } catch (err) {
      say(err?.message || 'The archive could not be written', 'error')
    }
    setBusy('')
  }

  async function exportMbox() {
    setBusy('mbox')
    setStatus({ kind: '', text: '' })
    try {
      const privateKey = await keySession.get()
      if (!privateKey) throw new Error('Unlock your encryption key first, then try again.')
      say('Reading your mailbox…')
      const { mbox, total, failed } = await exportMailbox({
        list: emailListAll,
        get: emailGetRaw,
        decrypt: (data, key, keyOverride) => decryptStored(data, key, keyOverride),
        privateKey,
      })
      const stamp = new Date().toISOString().slice(0, 10)
      downloadText(`sloth-lee-mail-${stamp}.mbox`, mbox)
      say(
        failed.length
          ? `Wrote ${total} messages in the clear. ${failed.length} could not be decrypted and were skipped.`
          : `Wrote ${total} messages in the clear.`,
        failed.length ? 'warn' : 'ok',
      )
    } catch (err) {
      say(err?.message || 'The export could not be completed', 'error')
    }
    setBusy('')
  }

  return (
    // Settings gives this section its card and title; no second card or heading inside.
    <section>

      <form onSubmit={exportSealed} className="space-y-2">
        <p className="max-w-[62ch] text-xs leading-relaxed text-ink-3">
          A sealed archive: every message encrypted with a passphrase you choose, with nothing
          readable inside the file. Restore it here through{' '}
          <a href="/settings#import" className="underline underline-offset-2">Import</a>. Symmetric
          encryption, so the archive stays sealed even against a quantum computer — what protects it
          is the strength of your passphrase.
        </p>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,220px)_minmax(0,220px)_auto] sm:items-end">
          <div className="min-w-0">
            <div className="mb-1 flex items-center justify-between gap-2">
              <label htmlFor="arc-pass" className="text-[11px] text-ink-3">
                Passphrase
              </label>
              <button
                type="button"
                onClick={() => setReveal((v) => !v)}
                aria-pressed={reveal}
                aria-label={reveal ? 'Hide the passphrase' : 'Show the passphrase'}
                className="-my-1 rounded p-1 text-ink-3 hover:text-ink-1 max-sm:min-h-[44px] max-sm:min-w-[44px]"
              >
                {reveal ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </div>
            <Input
              id="arc-pass"
              type={reveal ? 'text' : 'password'}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoComplete="new-password"
              className="w-full max-sm:min-h-[44px]"
            />
          </div>
          <div className="min-w-0">
            <label htmlFor="arc-pass2" className="mb-1 block text-[11px] text-ink-3">
              Repeat it
            </label>
            <Input
              id="arc-pass2"
              type={reveal ? 'text' : 'password'}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              className="w-full max-sm:min-h-[44px]"
            />
          </div>
          <Button type="submit" disabled={!!busy} className="gap-2 max-sm:min-h-[44px] sm:justify-self-start">
            <Lock className="size-3.5" />
            {busy === 'sealed' ? 'Sealing…' : 'Download .slotharc'}
          </Button>
        </div>
        <p className="text-[11px] text-ink-4">
          There is no recovery for this passphrase. Losing it loses the archive.
        </p>
      </form>

      <div className="mt-4 border-t border-line pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex max-w-[52ch] items-start gap-1.5 text-[11.5px] leading-relaxed text-ink-3">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-sand" />
            Need a file any mail client can open? A plain .mbox writes every message to disk
            unencrypted — fine for importing into Thunderbird, wrong for a backup.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={exportMbox}
            disabled={!!busy}
            className="max-sm:min-h-[44px]"
          >
            {busy === 'mbox' ? 'Preparing…' : 'Export unencrypted .mbox'}
          </Button>
        </div>
      </div>

      {status.text ? (
        <p
          className={`mt-3 text-xs ${
            status.kind === 'error' ? 'text-destructive' : status.kind === 'warn' ? 'text-sand' : 'text-ink-2'
          }`}
        >
          {status.text}
        </p>
      ) : null}
    </section>
  )
}
