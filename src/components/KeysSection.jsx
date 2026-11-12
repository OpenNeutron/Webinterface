import { useEffect, useRef, useState } from 'react'
import OpenPgpGuide from '@/components/OpenPgpGuide'
import { Lock, ShieldCheck, Copy, Download, Loader2, CheckCircle2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  getIdentity,
  hasIdentity,
  generateIdentity,
  exportKeyRingBackup,
  importKeyRingBackup,
  exportPublicKey,
  forgetIdentity,
  importPublicKey,
  listContacts,
  markContactVerified,
  markKeyBackupTaken,
  keyBackupDue,
  listKeyConflicts,
  resolveKeyConflict,
  dismissKeyConflict,
  removeContact,
  importKeyFile,
  exportPrivateKey,
  publishableKey,
} from '@/pgp'
import { wkdUrl, wkdHash, publishToKeyserver } from '@/lib/wkd'
import { pgpPublishWkd, pgpWkdStatus } from '@/api'
import { copyWithToast } from '@/lib/toast'

/**
 * Key management for OpenPGP mail: create this account's key, import a
 * correspondent's public key, and hand out your own.
 *
 * This used to be a modal called "OpenPGP" that also held nine unrelated
 * settings. It is now one section of the settings page and nothing else.
 */
export default function KeysSection({ accountEmail }) {
  const [identity, setIdentity] = useState(null)
  const [contacts, setContacts] = useState([])
  const [conflicts, setConflicts] = useState([])
  const [verifying, setVerifying] = useState('')
  const [backupDue, setBackupDue] = useState(false)
  const [mode, setMode] = useState('overview') // overview | create | import | export
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [passphrase2, setPassphrase2] = useState('')
  const [armorIn, setArmorIn] = useState('')
  const fileRef = useRef(null)
  const textRef = useRef('')
  const [wkd, setWkd] = useState(null)
  const [wkdBusy, setWkdBusy] = useState(false)
  const [ksBusy, setKsBusy] = useState(false)
  const [ksNote, setKsNote] = useState('')

  const refresh = () => {
    setIdentity(getIdentity())
    setContacts(listContacts())
    setConflicts(listKeyConflicts())
    setBackupDue(keyBackupDue())
  }

  useEffect(() => {
    refresh()
    setMode(hasIdentity() ? 'overview' : 'create')
    setError('')
    setNotice('')
    setName('')
    setEmail(accountEmail ?? '')
    setPassphrase('')
    setPassphrase2('')
    setArmorIn('')
  }, [accountEmail])

  const downloadKeyBackup = () => {
    const stamp = new Date().toISOString().slice(0, 10)
    const blob = new Blob([exportKeyRingBackup()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sloth-lee-keys-${stamp}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    markKeyBackupTaken()
    setBackupDue(keyBackupDue())
    setNotice('Key backup downloaded. Keep it somewhere safe — it can restore your keys on another device.')
  }

  const restoreKeyBackup = async (file) => {
    if (!file) return
    setError('')
    try {
      const text = await file.text()
      const result = await importKeyRingBackup(text)
      refresh()
      setNotice(
        `Restored ${result.contactsAdded} key${result.contactsAdded === 1 ? '' : 's'}` +
          (result.contactsSkipped ? `, kept ${result.contactsSkipped} already present` : '') +
          (result.identityRestored ? '. Your own key was restored too.' : '.'),
      )
    } catch (err) {
      setError(err?.message || 'That backup could not be restored')
    }
  }

  const confirmVerified = (address) => {
    markContactVerified(address, true)
    setVerifying('')
    refresh()
    setNotice(`${address} marked as verified`)
  }

  const adoptSenderKey = async (address) => {
    try {
      const result = await resolveKeyConflict(address)
      refresh()
      setNotice(`Now using ${result?.fingerprint ? result.fingerprint.slice(-16) : 'the newer key'} for ${address}`)
    } catch (err) {
      setError(err?.message || 'That key could not be saved')
    }
  }

  const keepMyKey = (address) => {
    dismissKeyConflict(address)
    refresh()
    setNotice(`Kept your saved key for ${address}`)
  }

  const handleCreate = async () => {
    setError('')
    if (passphrase !== passphrase2) {
      setError('The passphrases do not match')
      return
    }
    setBusy(true)
    try {
      await generateIdentity({ name, email, passphrase })
      refresh()
      setPassphrase('')
      setPassphrase2('')
      setMode('overview')
      setNotice('Key created. Keep the passphrase safe — without it this key cannot be used or recovered.')
    } catch (err) {
      setError(err.message || 'Could not create the key')
    } finally {
      setBusy(false)
    }
  }

  const submitToKeyserver = async () => {
    setKsBusy(true)
    setError('')
    setKsNote('')
    try {
      const { email } = await publishableKey()
      // keys.openpgp.org wants armor, so re-armor what we just dearmored.
      const armored = exportPublicKey()
      const result = await publishToKeyserver(armored, [email])
      setKsNote(
        result.verificationSent
          ? `Confirmation sent to ${email}. Click the link in that message — until you do, the key is not published.`
          : `Already published for ${email}.`,
      )
    } catch (err) {
      setError(err.message || 'The keyserver refused the key')
    } finally {
      setKsBusy(false)
    }
  }

  const publishToWkd = async () => {
    setWkdBusy(true)
    setError('')
    try {
      const { keyB64, fingerprint, email } = await publishableKey()
      // The hash is the address's z-base-32 digest, not a slice of the URL: the WKD
      // URL is the advanced /.well-known/ form, so index 3 of it is ".well-known".
      // Sending that made the server reject every publish with a bare 400.
      const hash = await wkdHash(email)
      await pgpPublishWkd({ hash, key_b64: keyB64, email, fingerprint })
      const status = await pgpWkdStatus()
      setWkd(status)
      setNotice(`Published for ${email}`)
    } catch (err) {
      // Say what the server said. "Request failed with status code 400" is a
      // description of axios, not of the problem.
      const serverSays = err?.response?.data?.message || err?.response?.data?.error
      setError(serverSays || err.message || 'Could not publish the key')
    } finally {
      setWkdBusy(false)
    }
  }

  const handleImport = async () => {
    setError('')
    setBusy(true)
    try {
      const { email: imported } = await importPublicKey(armorIn)
      refresh()
      setArmorIn('')
      setMode('overview')
      setNotice(`Imported a key for ${imported}`)
    } catch (err) {
      if (err.code === 'key_fingerprint_changed') {
        // Never swap trust silently: show both fingerprints and ask.
        const accepted = window.confirm(
          `${err.message}\n\nSaved:   …${err.pinned.slice(-16)}\nIncoming: …${err.incoming.slice(-16)}\n\nOnly accept if you have verified the new key with that person.`,
        )
        if (accepted) {
          try {
            const { email: imported } = await importPublicKey(armorIn, { replace: true })
            refresh()
            setArmorIn('')
            setMode('overview')
            setNotice(`Replaced the key for ${imported}`)
          } catch (inner) {
            setError(inner.message || 'Could not replace the key')
          }
        }
      } else {
        setError(err.message || 'That does not look like a PGP public key')
      }
    } finally {
      setBusy(false)
    }
  }

  const handleFile = async (fileList) => {
    const file = fileList?.[0]
    if (!file) return
    setError('')
    setBusy(true)
    try {
      const text = await file.text()
      textRef.current = text
      const { kind, email: imported } = await importKeyFile(text)
      refresh()
      setMode('overview')
      setNotice(
        kind === 'private'
          ? `Imported the private key for ${imported} — you can now read and sign as this identity`
          : `Imported a public key for ${imported}`,
      )
    } catch (err) {
      if (err.code === 'key_fingerprint_changed') {
        const accepted = window.confirm(
          `${err.message}\n\nSaved:   …${err.pinned.slice(-16)}\nIncoming: …${err.incoming.slice(-16)}\n\nOnly accept if you have verified the new key with that person.`,
        )
        if (accepted) {
          try {
            await importPublicKey(textRef.current, { replace: true })
            refresh()
            setMode('overview')
            setNotice(`Replaced the key for ${err.incoming.slice(-8)}`)
          } catch (inner) {
            setError(inner.message || 'Could not replace the key')
          }
        }
      } else {
        setError(err.message || 'That file could not be imported')
      }
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const copyKey = async () => {
    const ok = await copyWithToast(exportPublicKey() ?? '', 'Public key copied')
    if (!ok) setError('Copying was blocked by the browser — select the text below instead')
  }

  const downloadKey = () => {
    const armored = exportPublicKey()
    if (!armored) return
    const blob = new Blob([armored], { type: 'application/pgp-keys' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${identity?.email ?? 'key'}.asc`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
        {notice && (
          <p className="text-xs text-primary flex items-start gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{notice}</span>
          </p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}

        {mode === 'create' && !identity && (
          <>
            <p className="text-sm text-ink-2">
              Create a personal PGP key so you can exchange encrypted mail with people
              outside this server. The key is stored in this browser, protected by a
              passphrase you choose. Nobody — including this server — can recover it.
            </p>
            <div>
              <label className="text-xs font-medium text-ink-2 mb-1 block">Your name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sam Smith" />
            </div>
            <div>
              <label className="text-xs font-medium text-ink-2 mb-1 block">Your address</label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@slothlee.xyz" />
            </div>
            <div>
              <label className="text-xs font-medium text-ink-2 mb-1 block">Passphrase</label>
              <Input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="At least 8 characters"
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-ink-2 mb-1 block">Repeat passphrase</label>
              <Input
                type="password"
                value={passphrase2}
                onChange={(e) => setPassphrase2(e.target.value)}
                placeholder="Repeat passphrase"
                autoComplete="new-password"
              />
            </div>
            <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
              I already have a key — import an .asc file
            </Button>
          </>
        )}

        <OpenPgpGuide />


        {mode === 'overview' && backupDue && (
          <div className="mb-3 rounded-lg border border-destructive/40 bg-destructive/5 p-2 space-y-1">
            <p className="text-[11px] font-medium text-destructive">No backup file yet</p>
            <p className="text-[11px] text-ink-2">
              Your key is stored on your account, wrapped with your password, so signing in on another device brings
              it back. A backup file is still worth keeping: if you forget the password, the account copy cannot be
              opened — by you or by this service.
            </p>
            <button
              type="button"
              onClick={downloadKeyBackup}
              className="text-[11px] px-2 py-1 rounded bg-primary/15 text-primary"
            >
              save a key backup now
            </button>
          </div>
        )}
        {mode === 'overview' && conflicts.length > 0 && (
          <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 space-y-2">
            <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
              Two different keys for the same address
            </p>
            {conflicts.map((c) => (
              <div key={c.email} className="text-[11px] text-ink-2 space-y-1">
                <div className="font-medium text-ink-1 break-all">{c.email}</div>
                <div className="font-mono text-[10px] break-all">yours: …{(c.pinned || '').slice(-16)}</div>
                <div className="font-mono text-[10px] break-all">their message: …{(c.incoming || '').slice(-16)}</div>
                <div className="flex gap-2 pt-0.5">
                  <button type="button" onClick={() => adoptSenderKey(c.email)} className="px-2 py-1 rounded bg-primary/15 text-primary">
                    use theirs
                  </button>
                  <button type="button" onClick={() => keepMyKey(c.email)} className="px-2 py-1 rounded border border-line/70">
                    keep mine
                  </button>
                </div>
                <p className="text-[10px] text-ink-3">
                  A published key can be out of date; a key inside their message is the one their app uses. Confirm the
                  fingerprint with them if it matters.
                </p>
              </div>
            ))}
          </div>
        )}
        {mode === 'overview' && (
          <p className="text-[10px] uppercase tracking-wide text-ink-3 mt-4 first:mt-0">Keys &amp; backup</p>
        )}
        {mode === 'overview' && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-line/60 px-3 py-2.5">
            <span className="text-[11px] text-ink-2">Move these keys to another device:</span>
            <button type="button" onClick={downloadKeyBackup} className="text-[11px] underline underline-offset-2 text-primary/90">
              download key backup
            </button>
            <label className="text-[11px] underline underline-offset-2 text-primary/90 cursor-pointer">
              restore from backup
              <input
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => { restoreKeyBackup(e.target.files?.[0]); e.target.value = '' }}
              />
            </label>
          </div>
        )}
        {mode === 'overview' && (
          <p className="text-[10px] uppercase tracking-wide text-ink-3 mt-4 first:mt-0">Your identity</p>
        )}
        {mode === 'overview' && (
          <>
            {identity ? (
              <div className="rounded-lg border border-line bg-background/40 p-3 space-y-1">
                <p className="text-sm font-medium flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-primary" />
                  {identity.name} &lt;{identity.email}&gt;
                </p>
                <p className="text-[11px] font-mono break-all text-ink-3">
                  {identity.fingerprint.replace(/(.{4})/g, '$1 ').trim()}
                </p>
              </div>
            ) : (
              <p className="text-sm text-ink-2">
                No OpenPGP key in this browser yet. Encrypted mail to people outside this
                server needs one.
              </p>
            )}

            {identity && (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setMode('export')}>
                  <Download className="w-3.5 h-3.5 mr-1.5" />
                  Your public key
                </Button>
                <Button variant="outline" size="sm" onClick={() => setMode('import')}>
                  Import a key
                </Button>
              </div>
            )}

            {identity && (
              <div className="rounded-md border border-line/70 p-2.5 space-y-1.5">
                <p className="text-xs font-medium text-ink-2">Automatic discovery (WKD)</p>
                <p className="text-[11px] text-ink-3">
                  {wkd?.published
                    ? `Published — other mail clients can fetch this key for ${identity.email} without asking you.`
                    : 'Publish your public key so other mail clients can find it automatically instead of you sending it by hand.'}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant={wkd?.published ? 'ghost' : 'outline'}
                    size="sm"
                    onClick={publishToWkd}
                    disabled={wkdBusy}
                  >
                    {wkdBusy ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
                    {wkd?.published ? 'Re-publish key' : 'Publish for discovery'}
                  </Button>
                  {wkd?.published && wkd?.fingerprint && (
                    <span className="text-[10px] font-mono text-ink-3 truncate">
                      …{String(wkd.fingerprint).slice(-16)}
                    </span>
                  )}
                </div>
              </div>
            )}

            {identity && (
              <div className="rounded-md border border-line/70 p-2.5 space-y-1.5">
                <p className="text-xs font-medium text-ink-2">Public keyserver</p>
                <p className="text-[11px] text-ink-3">
                  keys.openpgp.org lets anyone find your key by address. They email a
                  verification link first, so only you can publish it.
                </p>
                <Button variant="outline" size="sm" onClick={submitToKeyserver} disabled={ksBusy}>
                  {ksBusy ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
                  Publish to keys.openpgp.org
                </Button>
                {ksNote && <p className="text-[11px] text-primary/90">{ksNote}</p>}
              </div>
            )}

            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
              {busy ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
              Import .asc file
            </Button>

            {!identity && (
              <Button variant="ghost" size="sm" onClick={() => setMode('import')}>
                Paste a key instead
              </Button>
            )}

            <div>
              <p className="text-xs font-medium text-ink-2 mb-2">
                Correspondents ({contacts.length})
              </p>
              {contacts.length === 0 ? (
                <p className="text-xs text-ink-3">
                  No keys imported yet. You can only encrypt to addresses whose public key
                  you hold.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {contacts.map((c) => (
                    <li
                      key={c.email}
                      className="flex items-center justify-between gap-3 rounded-md border border-line/60 px-3 py-2.5"
                    >
                      <span className="min-w-0">
                        <span className="block text-xs truncate">{c.email}</span>
                        {c.fingerprint && !c.verified && verifying !== c.email && (
                          <button
                            type="button"
                            onClick={() => setVerifying(c.email)}
                            className="block text-[10px] text-amber-600 dark:text-amber-400 text-left"
                          >
                            unverified — tap to check the fingerprint
                          </button>
                        )}
                        {c.verified && (
                          <span className="block text-[10px] text-emerald-600 dark:text-emerald-400">verified</span>
                        )}
                        {verifying === c.email && (
                          <div className="mt-1 rounded border border-line/70 p-1.5 space-y-1">
                            <p className="text-[10px] text-ink-2">
                              Read this to them over a call, or compare it with the fingerprint their app shows. If it
                              matches, confirm.
                            </p>
                            <p className="font-mono text-[11px] break-all leading-snug">
                              {(c.fingerprint.match(/.{1,4}/g) || []).join(' ')}
                            </p>
                            <div className="flex gap-2">
                              <button type="button" onClick={() => confirmVerified(c.email)} className="px-2 py-1 rounded bg-primary/15 text-primary text-[11px]">
                                it matches
                              </button>
                              <button type="button" onClick={() => setVerifying('')} className="px-2 py-1 rounded border border-line/70 text-[11px]">
                                cancel
                              </button>
                            </div>
                          </div>
                        )}
                        {c.fingerprint && (
                          <button
                            type="button"
                            title="Tap to copy the full fingerprint"
                            onClick={() => {
                              navigator.clipboard?.writeText(c.fingerprint)
                              setNotice(`Copied the fingerprint for ${c.email}`)
                            }}
                            className="block text-[10px] font-mono text-ink-3 hover:text-primary/80 text-left leading-tight break-all"
                          >
                            {(c.fingerprint.match(/.{1,4}/g) || []).join(' ')}
                          </button>
                        )}
                      </span>
                      {identity?.email !== c.email && (
                        <button
                          onClick={() => {
                            removeContact(c.email)
                            refresh()
                          }}
                          className="text-ink-3 hover:text-destructive shrink-0"
                          aria-label={`Remove key for ${c.email}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        {mode === 'import' && (
          <>
            <p className="text-sm text-ink-2">
              Paste a key, or import an <span className="font-mono text-xs">.asc</span> file
              exported from another PGP client. A public key lets you encrypt to that
              person; a private key makes this browser able to read mail addressed to it.
            </p>
            <textarea
              value={armorIn}
              onChange={(e) => setArmorIn(e.target.value)}
              rows={7}
              spellCheck={false}
              className="w-full rounded-md border border-line bg-background px-3 py-2 text-[11px] font-mono outline-none focus:ring-1 focus:ring-primary"
              placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----"
            />
          </>
        )}

        {mode === 'export' && identity && (
          <>
            <p className="text-sm text-ink-2">
              Share this with anyone who wants to send you encrypted mail. It is public —
              it cannot be used to read your messages.
            </p>
            <textarea
              readOnly
              value={identity.publicKey}
              rows={7}
              spellCheck={false}
              className="w-full rounded-md border border-line bg-background px-3 py-2 text-[11px] font-mono outline-none"
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={copyKey}>
                <Copy className="w-3.5 h-3.5 mr-1.5" />
                Copy
              </Button>
              <Button variant="outline" size="sm" onClick={downloadKey}>
                <Download className="w-3.5 h-3.5 mr-1.5" />
                Download .asc
              </Button>
            </div>

            <div className="rounded-md border border-line/70 p-2.5 space-y-1.5">
              <p className="text-[11px] text-ink-2">
                Back up the private key to move this identity to another device. It stays
                protected by your passphrase — anyone who has the file <em>and</em> the
                passphrase can read your mail.
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const armored = exportPrivateKey()
                  if (!armored) return
                  const blob = new Blob([armored], { type: 'application/pgp-keys' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `${identity?.email ?? 'key'}-private.asc`
                  a.click()
                  URL.revokeObjectURL(url)
                }}
              >
                <Download className="w-3.5 h-3.5 mr-1.5" />
                Export private key (.asc)
              </Button>
            </div>
          </>
        )}

      <input
        ref={fileRef}
        type="file"
        accept=".asc,.pgp,.gpg,.key,application/pgp-keys,application/pgp-encrypted,text/plain"
        className="hidden"
        onChange={(e) => handleFile(e.target.files)}
      />

      <div className="flex items-center gap-2 border-t border-line pt-3">
        {mode === 'create' && !identity && (
          <>
            <Button variant="ghost" size="sm" onClick={() => setMode('overview')}>
              Not now
            </Button>
            <Button size="sm" onClick={handleCreate} disabled={busy}>
              {busy ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
              Create key
            </Button>
          </>
        )}
        {mode === 'import' && (
          <>
            <Button variant="ghost" size="sm" onClick={() => setMode('overview')}>
              Back
            </Button>
            <Button size="sm" onClick={handleImport} disabled={busy || !armorIn.trim()}>
              {busy ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
              Import
            </Button>
          </>
        )}
        {(mode === 'overview' || mode === 'export') && (
          <>
            {identity && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive mr-auto"
                onClick={() => {
                  if (confirm('Delete this browser’s OpenPGP key? Messages encrypted to it become unreadable.')) {
                    forgetIdentity()
                    refresh()
                    setMode('create')
                  }
                }}
              >
                Delete key
              </Button>
            )}

          </>
        )}
    </div>
    </div>
  )
}
