import { useState, useRef, useCallback, useEffect } from 'react'
import {
  X,
  Minus,
  Send,
  ChevronUp,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Paperclip,
  Trash2,
  Flame,
  Link2,
  Clock,
} from 'lucide-react'
import { AddressField } from '@/components/compose/AddressField'
import { AttachmentChip } from '@/components/compose/AttachmentChip'
import { TiptapEditor } from '@/components/compose/TiptapEditor'
import { useSendEmail } from '@/hooks/useSendEmail'
import { useAttachments } from '@/hooks/useAttachments'
import { useResizable } from '@/hooks/useResizable'
import { useIsPhone } from '@/hooks/useIsPhone'
import { Lock, LockOpen } from 'lucide-react'
import { listAliases } from '@/api'
import { keyCoverage, encryptBody, encryptAttachment, hasIdentity, importPublicKey, sealToRecipients, sealWithPassphrase, sealFileWithPassphrase } from '@/pgp'
import { makePassphrase } from '@/lib/passphrase'
import { lookupKey } from '@/lib/wkd'
import { loadProfile } from '@/lib/profile'
import api from '@/api'
import { storage } from '@/storage'

/** "Tomorrow 09:00" reads better than a full date when it is close. */
function formatWhen(when) {
  if (!when) return ''
  const now = new Date()
  const sameDay = when.toDateString() === now.toDateString()
  const time = when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  if (sameDay) return time
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  if (when.toDateString() === tomorrow.toDateString()) return `tomorrow ${time}`
  return `${when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${time}`
}

/** The times people actually pick, in their own timezone. */
function whenPresets() {
  const now = new Date()
  const out = [['In an hour', new Date(now.getTime() + 60 * 60 * 1000)]]

  const evening = new Date(now)
  evening.setHours(18, 0, 0, 0)
  if (evening <= now) evening.setDate(evening.getDate() + 1)
  out.push(['This evening', evening])

  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(9, 0, 0, 0)
  out.push(['Tomorrow morning', tomorrow])

  // Next Monday at 09:00: send on Monday morning, not "in seven days".
  const monday = new Date(now)
  const daysAhead = ((8 - monday.getDay()) % 7) || 7
  monday.setDate(monday.getDate() + daysAhead)
  monday.setHours(9, 0, 0, 0)
  out.push(['Monday morning', monday])

  return out
}

const ComposeWindow = ({ myEmail, onClose, onSent, replyData = null, draftId = null, onDeleteDraft, onScheduled, replaceId = null }) => {
  const [minimized, setMinimized] = useState(false)
  const isPhone = useIsPhone()

  const currentDraftId = useRef(draftId ?? ('draft_' + Date.now()))

  const [toChips,  setToChips]  = useState(() => replyData?.to  ?? [])
  const [ccChips,  setCcChips]  = useState(() => replyData?.cc  ?? [])
  const [bccChips, setBccChips] = useState(() => replyData?.bcc ?? [])
  const [subject,  setSubject]  = useState(() => replyData?.subject ?? '')
  const [body,     setBody]     = useState(() => replyData?.body ?? '')

  // "off", "read", or a number of seconds. Server-enforced for mailboxes on this
  // server; another provider's copy is not ours to delete.
  const [vanish, setVanish] = useState('off')
  // When to hand the message over. Null means now; a date means the server holds
  // it and sends it at that time.
  // An edit opens on the time the message is already held for, not on "now":
  // sending now would deliver a second copy and leave the held one still queued.
  const [sendAt, setSendAt] = useState(() =>
    replyData?.sendAt ? new Date(replyData.sendAt * 1000) : null)
  // Which of my addresses this goes out from. Empty means the real one. A reply
  // to mail that came through an alias starts on that alias.
  const [fromAlias, setFromAlias] = useState(() => replyData?.fromAlias ?? '')
  const [myAliases, setMyAliases] = useState([])
  const [whenOpen, setWhenOpen] = useState(false)
  const ephemeralPayload = () => {
    if (vanish === 'read') return { deletes_on_read: true }
    if (vanish === 'off') return null
    return { deletes_on_read: false, expires_in_seconds: Number(vanish) }
  }
  // The rule is enforced by this server only. Saying so before sending is the
  // difference between a promise and a misunderstanding.
  const myDomain = String(myEmail || '').split('@')[1]?.toLowerCase() || ''
  const offServerRecipients = [...toChips, ...ccChips, ...bccChips]
    .filter((a) => a && a.trim())
    .filter((a) => !myDomain || !a.toLowerCase().trim().endsWith('@' + myDomain))

  const { sendState, sendError, sendResults, scheduledFor, handleSend, reportError } = useSendEmail({
    myEmail, replyData, draftId, onDeleteDraft, onSent, onClose, onScheduled, replaceId,
  })

  // Only shown when there is something to choose from, so an account with no
  // aliases never sees a picker with one option.
  useEffect(() => {
    let cancelled = false
    listAliases()
      .then((data) => {
        if (cancelled) return
        const live = (data.aliases ?? []).filter((a) => !a.disabled_at)
        setMyAliases(live)
        // A reply may name an alias that has since been switched off.
        if (fromAlias && live.length && !live.some((a) => a.local === fromAlias)) setFromAlias('')
      })
      .catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // An attachment arrives as base64; sealing wants the bytes themselves.
  const attFileBytes = (att) => {
    if (!att.data) throw new Error(`${att.name} is still being read — try again in a moment`)
    const bin = atob(att.data)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
    return out
  }

  // One place that adds the chosen time, so no send path can forget it.
  const sendNow = (args) => handleSend({ ...args, sendAt, fromAlias })

  // A scheduled message has not gone anywhere yet: say when it will, then close.
  useEffect(() => {
    if (sendState !== 'scheduled') return undefined
    const timer = setTimeout(() => onClose(null), 3500)
    return () => clearTimeout(timer)
  }, [sendState, onClose])

  const { attachments, isDragOver, setIsDragOver, fileInputRef, addFiles, removeAttachment } = useAttachments({
    onError: reportError,
  })

  const { windowRef, size, handleResizeMouseDown } = useResizable()

  // OpenPGP (inline) is separate from the server-side E2EE the send hook does:
  // it is what makes mail readable by correspondents on other providers.
  const [pgpOn, setPgpOn] = useState(false)
  // Other providers keep whatever they are sent, so for them the body is not
  // sent at all: it is sealed behind a link this server can delete.
  const [sealExternal, setSealExternal] = useState(false)
  // How the note is locked: to the recipient's key, or to a phrase the sender
  // passes on separately (the only option when they have no key at all).
  const [sealMode, setSealMode] = useState('key')
  const [sealPhrase, setSealPhrase] = useState('')
  const [phraseCopied, setPhraseCopied] = useState(false)
  const [pgpPass, setPgpPass] = useState('')
  const [keyPasteOpen, setKeyPasteOpen] = useState(false)
  const [keyPaste, setKeyPaste] = useState('')
  const [keyPasteBusy, setKeyPasteBusy] = useState(false)
  const [keyPasteNote, setKeyPasteNote] = useState('')
  const [pgpError, setPgpError] = useState('')
  const [pgpBusy, setPgpBusy] = useState(false)

  const recipients = [...toChips, ...ccChips, ...bccChips]
  const coverage = keyCoverage(recipients)

  // What the send path will actually do: it asks this server for a key per
  // recipient. A saved OpenPGP contact is evidence of a *different* key system,
  // so it must not decide this line — doing so told people "Not encrypted" for
  // colleagues whose keys the server has held all along.
  const recipientKey = recipients.join(',')
  const [serverKeys, setServerKeys] = useState({})
  useEffect(() => {
    if (!recipients.length) {
      setServerKeys({})
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const token = storage.getToken()
        const res = await api.post(
          '/email/publickeys',
          { addresses: recipients },
          { headers: { Authorization: `Bearer ${token}` } },
        )
        if (cancelled) return
        const map = {}
        for (const k of res.data?.keys ?? []) {
          const address = String(k.address ?? '').toLowerCase()
          if (address) map[address] = Boolean(k.public_key && k.public_key.length > 16)
        }
        setServerKeys(map)
      } catch {
        // No answer is not evidence of no key: stay quiet rather than warn falsely.
        if (!cancelled) setServerKeys({})
      }
    })()
    return () => { cancelled = true }
  }, [recipientKey])

  // The one line that answers "what happens if I press send?" before the user
  // has to interpret a small icon. It names the system it is talking about.
  const encryptionLine = (() => {
    if (!recipients.length) return null

    if (pgpOn) {
      if (!coverage.canEncrypt) {
        return { tone: 'warn', text: `OpenPGP: no key for ${coverage.missing.join(', ')}` }
      }
      // OpenPGP here is classical: RFC 9980 defines hybrid composites for it, but no
      // browser library implements the v6 key layer yet, so the honest line says so.
      // Account-to-account mail is different — that path is sealed and says "sealed".
      return {
        tone: 'good',
        text: `OpenPGP to ${recipients.length} recipient${recipients.length === 1 ? '' : 's'} — classical keys, not quantum-protected`,
      }
    }

    // A sealed recipient gets no message at all — only a link — so neither the
    // encrypted nor the "not encrypted" verdict describes them.
    const sealed = sealExternal ? offServerRecipients.map((a) => String(a).toLowerCase()) : []
    if (sealed.length) {
      return {
        tone: 'good',
        text: sealMode === 'phrase'
          ? `Sealed link to ${offServerRecipients.join(', ')} — locked with a passphrase, body stays here`
          : `Sealed link to ${offServerRecipients.join(', ')} — the body never leaves this server`,
      }
    }

    if (!Object.keys(serverKeys).length) return null
    const unknown = recipients.filter((a) => !serverKeys[String(a).toLowerCase()])
    if (unknown.length) {
      return { tone: 'warn', text: `Not encrypted to ${unknown.join(', ')} — no key found` }
    }
    return {
      tone: 'good',
      text: `End-to-end encrypted to ${recipients.length === 1 ? recipients[0] : `${recipients.length} recipients`}`,
    }
  })()
  const [finding, setFinding] = useState(false)
  const [found, setFound] = useState('')
  const lookedUp = useRef(new Set())
  const [keySuggestions, setKeySuggestions] = useState({})

  /** Fetch any missing recipient keys from WKD / keys.openpgp.org, then pin them. */
  const findMissingKeys = async () => {
    if (!coverage.missing.length) return
    setFinding(true)
    setFound('')
    const notes = []
    for (const address of coverage.missing) {
      try {
        const hit = await lookupKey(address)
        if (!hit) {
          notes.push(`no key found for ${address}`)
          continue
        }
        await importPublicKey(hit.armored)
        notes.push(`${address} from ${hit.source}`)
      } catch (err) {
        notes.push(`${address}: ${err.message || 'could not import'}`)
      }
    }
    setFound(notes.join(' · '))
    setFinding(false)
  }

  const plainText = (html) =>
    (html ?? '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

  const sendWithPgpIfNeeded = async () => {
    if (sealExternal && offServerRecipients.length > 0) {
      if (sealMode === 'key') {
        const coverageForSeal = keyCoverage(offServerRecipients)
        if (!coverageForSeal.canEncrypt) {
          setPgpError(`No OpenPGP key for: ${coverageForSeal.missing.join(', ')} — switch to a passphrase, or get their key`)
          return
        }
      } else if (!sealPhrase) {
        setPgpError('Generate a passphrase for the sealed note first')
        return
      }
      // A key-locked note hands the recipient armour for their own mail client;
      // making them decrypt five more files by hand would be worse than saying
      // no. A passphrase note is opened on our page, so its files can be opened
      // there too.
      if (attachments.length > 0 && sealMode !== 'phrase') {
        setPgpError('Attachments need the passphrase lock — switch the sealer to a passphrase, or send this as ordinary mail')
        return
      }
      setPgpBusy(true)
      try {
        const signature = (loadProfile().signature || '').trim()
        const noteBody = [
          `Subject: ${subject || '(no subject)'}`,
          '',
          plainText(body),
          signature ? `\n-- \n${signature}` : '',
        ].join('\n')

        const sealed = {}
        if (sealMode === 'phrase') {
          // One phrase, one armour: every sealed recipient gets the same note
          // with their own link.
          const armor = await sealWithPassphrase({ text: noteBody, passphrase: sealPhrase })
          for (const address of offServerRecipients) sealed[address] = armor

          // Each file is sealed to the same phrase and travels in the same
          // request as the note, so one fetch brings the recipient everything.
          const sealedFiles = []
          for (const att of attachments) {
            const bytes = await attFileBytes(att)
            sealedFiles.push({
              name: att.name,
              size: bytes.length,
              armored: await sealFileWithPassphrase({ bytes, passphrase: sealPhrase }),
            })
          }

          setPgpBusy(false)
          sendNow({
            toChips, ccChips, bccChips, subject, body, attachments,
            ephemeral: ephemeralPayload(), sealed,
            sealMode: 'passphrase', sealedPhrase: sealPhrase, sealedFiles,
          })
          return
        }

        for (const address of offServerRecipients) {
          sealed[address] = await sealToRecipients({ text: noteBody, recipients: [address] })
        }
        setPgpBusy(false)
        sendNow({ toChips, ccChips, bccChips, subject, body, attachments, ephemeral: ephemeralPayload(), sealed, sealMode: 'pgp' })
        return
      } catch (err) {
        setPgpBusy(false)
        setPgpError(err.message || 'Sealing failed')
        return
      }
    }

    if (!pgpOn) {
      sendNow({ toChips, ccChips, bccChips, subject, body, attachments, ephemeral: ephemeralPayload() })
      return
    }
    setPgpError('')
    if (!hasIdentity()) {
      setPgpError('Create your OpenPGP key first — Settings → OpenPGP')
      return
    }
    if (!coverage.canEncrypt) {
      setPgpError(`No OpenPGP key for: ${coverage.missing.join(', ')}`)
      return
    }
    if (!pgpPass) {
      setPgpError('Enter your PGP passphrase to sign and encrypt')
      return
    }
    if (attachments.some((a) => a.status !== 'ready')) {
      setPgpError('Some files are still being read — wait a moment and try again')
      return
    }
    setPgpBusy(true)
    try {
      const armored = await encryptBody({
        text: plainText(body),
        recipients,
        passphrase: pgpPass,
      })

      // Each file travels as its own encrypted .asc, so the recipient's client
      // never has to understand PGP/MIME to read it.
      const encryptedFiles = []
      for (const att of attachments) {
        const bytes = new Uint8Array(await att.file.arrayBuffer())
        const armoredFile = await encryptAttachment({ bytes, recipients, passphrase: pgpPass })
        encryptedFiles.push({
          name: `${att.name}.asc`,
          type: 'application/pgp-encrypted',
          data: btoa(unescape(encodeURIComponent(armoredFile))),
        })
      }

      sendNow({ toChips, ccChips, bccChips, subject, body: armored, attachments: encryptedFiles, ephemeral: ephemeralPayload() })
    } catch (err) {
      setPgpError(err.message || 'Encryption failed')
    } finally {
      setPgpBusy(false)
    }
  }

  // Paste a public key you were given (or one lifted from a message's
  // Autocrypt header). Automatic lookup cannot help here: a key that is not in
  // a keyserver or WKD is exactly the common case for a private individual.
  const acceptSuggestedKey = async (address) => {
    const hit = keySuggestions[address]
    if (!hit) return
    try {
      const imported = await importPublicKey(hit.armored)
      setKeySuggestions((prev) => {
        const next = { ...prev }
        delete next[address]
        return next
      })
      setKeyPasteNote(`Using the published key for ${imported.email}`)
    } catch (err) {
      setKeyPasteNote(err?.message || 'That key could not be saved')
    }
  }

  const savePastedKey = async () => {
    setKeyPasteNote('')
    if (!keyPaste.trim()) return
    setKeyPasteBusy(true)
    try {
      const imported = await importPublicKey(keyPaste)
      setKeyPaste('')
      setKeyPasteOpen(false)
      setKeyPasteNote(`Saved key for ${imported.email.toLowerCase()}`)
    } catch (err) {
      if (err?.code === 'key_fingerprint_changed') {
        setKeyPasteNote(err.message)
      } else {
        setKeyPasteNote(err?.message || 'That key could not be imported')
      }
    } finally {
      setKeyPasteBusy(false)
    }
  }

  // Look the key up without being asked. People should not have to know that
  // keyservers exist: add a recipient, and the key either appears or it does
  // not. Each address is attempted once per compose window.
  useEffect(() => {
    // Only hunt for OpenPGP keys when the sender has asked for OpenPGP. The
    // message is encrypted to this server's keys either way, so an unsolicited
    // "no key for …" paragraph reads as a contradiction of that.
    if (!pgpOn && !sealExternal) return
    const pending = coverage.missing.filter((a) => !lookedUp.current.has(a))
    if (!pending.length || finding) return
    pending.forEach((a) => lookedUp.current.add(a))
    let cancelled = false
    ;(async () => {
      setFinding(true)
      const notes = []
      for (const address of pending) {
        try {
          const hit = await lookupKey(address)
          if (cancelled) return
          if (!hit) {
            notes.push(
              `No key for ${address}. Their domain publishes none and no keyserver has one — ask them to send you a message (their key travels with it), then reply. Pasting their key by hand is the last resort.`,
            )
            continue
          }
          if (/^wkd$/i.test(hit.source)) {
            // Published by the recipient's own domain: safe to use straight away.
            await importPublicKey(hit.armored)
            notes.push(`${address} from ${hit.source}`)
          } else {
            // A keyserver entry is uploaded by anyone and may be years stale.
            // Offer it, never pin it silently.
            setKeySuggestions((prev) => ({ ...prev, [address]: hit }))
            notes.push(`a published key was found for ${address} — confirm it`)
          }
        } catch (err) {
          notes.push(`${address}: ${err.message || 'could not import'}`)
        }
      }
      if (!cancelled) {
        setFound(notes.join(' · '))
        setFinding(false)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pgpOn, sealExternal, recipients.join(','), coverage.missing.join(',')])

  const buildDraft = useCallback(() => {
    const hasContent = toChips.length > 0 || subject.trim() || (body && body.replace(/<(.|\n)*?>/g, '').trim()) || attachments.length > 0
    if (!hasContent) return null
    return {
      id:        currentDraftId.current,
      to:        toChips,
      cc:        ccChips,
      bcc:       bccChips,
      subject,
      body,
      updatedAt: Date.now(),
    }
  }, [toChips, ccChips, bccChips, subject, body, attachments])

  const handleClose = useCallback(() => {
    const draft = buildDraft()
    onClose(draft)
  }, [buildDraft, onClose])

  const handleDiscard = useCallback(() => {
    if (draftId) onDeleteDraft?.(draftId)
    onClose(null)
  }, [draftId, onDeleteDraft, onClose])

  const isSending       = ['resolving', 'fetchingkeys', 'encrypting', 'sending'].includes(sendState)
  const hasLoadingFiles = attachments.some((a) => a.status === 'loading')
  // An edit without a time would deliver now and leave the held copy queued.
  const editNeedsTime = Boolean(replaceId) && !sendAt
  const isSendBlocked   = isSending || sendState === 'done' || editNeedsTime

  const sendStatusLabel = {
    resolving:    'Resolving…',
    fetchingkeys: 'Fetching recipient keys…',
    encrypting:   'Encrypting…',
    sending:      'Sending…',
    done:         'Sent!',
    error:        sendError,
  }[sendState]

  return (
    <div
      ref={windowRef}
      className={`compose-window fixed z-50 flex flex-col bg-card border border-border shadow-2xl ${isPhone ? 'rounded-none border-0' : 'rounded-t-lg'}`}
      style={
        isPhone
          ? { inset: 0, width: '100%', height: '100dvh' }
          : { bottom: 0, right: 24, width: minimized ? 320 : size.w, height: minimized ? 'auto' : size.h }
      }
    >
      {!minimized && !isPhone && (
        <>
          <div className="absolute top-0 left-4 right-0 h-1.5 cursor-n-resize z-10"
               onMouseDown={(e) => handleResizeMouseDown(e, 'n')} />
          <div className="absolute left-0 top-4 bottom-0 w-1.5 cursor-w-resize z-10"
               onMouseDown={(e) => handleResizeMouseDown(e, 'w')} />
          <div className="absolute top-0 left-0 w-4 h-4 cursor-nw-resize z-20"
               onMouseDown={(e) => handleResizeMouseDown(e, 'nw')} />
        </>
      )}

      {/* Title bar */}
      <div className={`flex items-center justify-between px-3 h-12 sm:h-10 bg-muted/30 border-b border-border shrink-0 select-none ${isPhone ? '' : 'rounded-t-lg'}`}>
        <span className="text-sm font-medium text-card-foreground truncate">
          {replaceId && (
            <span className="mr-2 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary align-middle">
              Held
            </span>
          )}
          {subject || (replaceId ? 'Edit before it goes' : 'New Message')}
        </span>
        <div className="flex items-center gap-1 ml-2 shrink-0">
          {!isPhone && (
            <button
              onClick={() => setMinimized((v) => !v)}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title={minimized ? 'Expand' : 'Minimize'}
            >
              {minimized ? <ChevronUp className="w-4 h-4" /> : <Minus className="w-4 h-4" />}
            </button>
          )}
          <button
            onClick={handleDiscard}
            className="p-2 sm:p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
            title="Discard draft"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={handleClose}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Save draft & close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!minimized && (
        <>
          {/* Address + subject fields */}
          <div className="shrink-0 border-b border-border">
            <div className="px-3 pt-3">
              <AddressField label="To:" chips={toChips} onChipsChange={setToChips} />
              <AddressField label="Cc:" chips={ccChips} onChipsChange={setCcChips} />
              <AddressField label="Bcc:" chips={bccChips} onChipsChange={setBccChips} />
              {myAliases.length > 0 && (
                <div className="flex items-start gap-2 py-1">
                  <span className="text-sm font-semibold text-muted-foreground w-16 shrink-0 py-1.5">From:</span>
                  <div className="flex flex-wrap gap-1.5 py-1">
                    <button
                      type="button"
                      onClick={() => setFromAlias('')}
                      className={`px-2 py-1 rounded-full text-[11px] border transition-colors ${
                        fromAlias === ''
                          ? 'bg-primary/15 border-primary/40 text-primary'
                          : 'border-border/70 text-muted-foreground hover:border-border'
                      }`}
                    >
                      {myEmail}
                    </button>
                    {myAliases.map((a) => (
                      <button
                        key={a.local}
                        type="button"
                        onClick={() => setFromAlias(a.local)}
                        className={`px-2 py-1 rounded-full text-[11px] border transition-colors ${
                          fromAlias === a.local
                            ? 'bg-primary/15 border-primary/40 text-primary'
                            : 'border-border/70 text-muted-foreground hover:border-border'
                        }`}
                      >
                        {a.address}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 px-6">
              <span className="text-xs font-semibold text-foreground/40 shrink-0 py-1.5">Subject:</span>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject"
                className="flex-1 py-1.5 bg-transparent outline-none text-sm text-card-foreground placeholder:text-muted-foreground/60 max-sm:min-h-11"
              />
            </div>
          </div>

          {/* Body + drag-and-drop */}
          <div
            className="flex-1 flex flex-col relative min-h-0 bg-muted/20"
            onDragOver={(e)  => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true) }}
            onDragEnter={(e) => { e.preventDefault(); setIsDragOver(true) }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setIsDragOver(false) }}
            onDrop={(e) => {
              e.preventDefault()
              setIsDragOver(false)
              const files = Array.from(e.dataTransfer.files)
              if (files.length > 0) addFiles(files)
            }}
          >
            {isDragOver && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-primary/10 border-2 border-dashed border-primary/50 rounded-lg pointer-events-none">
                <Paperclip className="w-8 h-8 text-primary/70" />
                <span className="text-sm font-medium text-primary/80">Drop files to attach</span>
                <span className="text-xs text-primary/60">Max 20 MB per file</span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 border-b border-border/60 text-xs">
              <button
                type="button"
                onClick={() => { setPgpOn(!pgpOn); setPgpError('') }}
                className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors ${
                  pgpOn ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted'
                }`}
                title="Encrypt this message with OpenPGP"
              >
                {pgpOn ? <Lock className="w-3.5 h-3.5" /> : <LockOpen className="w-3.5 h-3.5" />}
                OpenPGP
              </button>
              {offServerRecipients.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setSealExternal(!sealExternal); setPgpError(''); if (!sealExternal) setPgpOn(false) }}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors ${
                    sealExternal ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted'
                  }`}
                  title="Do not email the body to other providers: send a link to it instead, and delete it when they open it"
                >
                  <Link2 className="w-3.5 h-3.5" />
                  Sealed link
                </button>
              )}
              {sealExternal && offServerRecipients.length > 0 && (
                <>
                  <span className={`text-[11px] ${keyCoverage(offServerRecipients).canEncrypt ? 'text-primary' : 'text-destructive'}`}>
                    {keyCoverage(offServerRecipients).canEncrypt
                      ? `${offServerRecipients.length === 1 ? 'body stays here' : 'bodies stay here'} for ${offServerRecipients.length} recipient${offServerRecipients.length === 1 ? '' : 's'} elsewhere`
                      : `needs their OpenPGP key: ${keyCoverage(offServerRecipients).missing.join(', ')}`}
                  </span>
                  {sealMode === 'key' && !keyCoverage(offServerRecipients).canEncrypt && (
                    <>
                      <button
                        type="button"
                        onClick={findMissingKeys}
                        disabled={finding}
                        className="text-[11px] underline underline-offset-2 text-primary/90 disabled:opacity-50"
                      >
                        {finding ? 'looking up…' : 'find key'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setKeyPasteOpen((v) => !v); setKeyPasteNote('') }}
                        className="text-[11px] underline underline-offset-2 text-foreground/50"
                      >
                        paste a key by hand
                      </button>
                    </>
                  )}
                </>
              )}
              {sealExternal && offServerRecipients.length > 0 && (
                <span className="flex items-center gap-1 text-[11px]">
                  <span className="text-foreground/40">lock with</span>
                  <button
                    type="button"
                    onClick={() => { setSealMode('key'); setSealPhrase('') }}
                    className={`px-1.5 py-0.5 rounded ${sealMode === 'key' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
                  >
                    their key
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSealMode('phrase')
                      if (!sealPhrase) setSealPhrase(makePassphrase())
                    }}
                    className={`px-1.5 py-0.5 rounded ${sealMode === 'phrase' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
                  >
                    a passphrase
                  </button>
                </span>
              )}
              {sealExternal && sealMode === 'key' && attachments.length > 0 && (
                <span className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                  attachments need
                  <button
                    type="button"
                    onClick={() => { setSealMode('phrase'); if (!sealPhrase) setSealPhrase(makePassphrase()) }}
                    className="underline underline-offset-2"
                  >
                    the passphrase lock
                  </button>
                </span>
              )}
              {pgpOn && (
                <>
                  <input
                    type="password"
                    value={pgpPass}
                    onChange={(e) => setPgpPass(e.target.value)}
                    placeholder="Key passphrase"
                    autoComplete="off"
                    className="flex-1 min-w-[8rem] bg-transparent border-b border-border/70 outline-none py-1 text-xs"
                  />
                  <span className={`text-[11px] ${coverage.canEncrypt ? 'text-primary' : 'text-destructive'}`}>
                    {coverage.canEncrypt
                      ? `encrypting to ${recipients.length} ${recipients.length === 1 ? 'recipient' : 'recipients'}`
                      : coverage.missing.length
                        ? `no key for ${coverage.missing.join(', ')} — this mail would go unencrypted`
                        : 'add a recipient to encrypt'}
                  </span>
                  {!coverage.canEncrypt && coverage.missing.length > 0 && (
                    <button
                      type="button"
                      onClick={findMissingKeys}
                      disabled={finding}
                      className="text-[11px] underline underline-offset-2 text-primary/90 disabled:opacity-50"
                    >
                      {finding ? 'looking up…' : 'find key'}
                    </button>
                  )}
                  {(!coverage.canEncrypt && found) && (
                    <button
                      type="button"
                      onClick={() => { setKeyPasteOpen((v) => !v); setKeyPasteNote('') }}
                      className="text-[11px] underline underline-offset-2 text-foreground/50"
                    >
                      paste a key by hand
                    </button>
                  )}
                  {attachments.length > 0 && (
                    <span className="text-[11px] text-foreground/45">
                      {attachments.length} file{attachments.length === 1 ? '' : 's'} encrypted separately
                    </span>
                  )}
                </>
              )}
            </div>
            {sealExternal && sealMode === 'phrase' && offServerRecipients.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border/60 text-[11px]">
                <span className="text-foreground/50">Send this to them another way:</span>
                <code className="px-2 py-1 rounded bg-muted text-foreground font-mono text-[12px] select-all">{sealPhrase}</code>
                <button
                  type="button"
                  onClick={async () => {
                    try { await navigator.clipboard.writeText(sealPhrase); setPhraseCopied(true); setTimeout(() => setPhraseCopied(false), 1500) } catch { /* select and copy by hand */ }
                  }}
                  className="text-primary underline underline-offset-2"
                >
                  {phraseCopied ? 'copied' : 'copy'}
                </button>
                <button
                  type="button"
                  onClick={() => { setSealPhrase(makePassphrase()); setPhraseCopied(false) }}
                  className="text-foreground/50 underline underline-offset-2"
                >
                  new phrase
                </button>
                <span className="text-amber-600 dark:text-amber-400 w-full">It is not in the email — anything else you use to tell them is the weak link.</span>
              </div>
            )}
            {Object.keys(keySuggestions).length > 0 && (
              <div className="px-3 py-2 border-b border-border/60 space-y-1">
                {Object.entries(keySuggestions).map(([address]) => (
                  <div key={address} className="flex items-center gap-2 text-[11px]">
                    <span className="text-foreground/60 min-w-0 truncate">
                      {address}: published key found
                    </span>
                    <button
                      type="button"
                      onClick={() => acceptSuggestedKey(address)}
                      className="px-2 py-0.5 rounded bg-primary/15 text-primary shrink-0"
                    >
                      use it
                    </button>
                    <button
                      type="button"
                      onClick={() => setKeySuggestions((prev) => { const n = { ...prev }; delete n[address]; return n })}
                      className="text-foreground/40 shrink-0"
                    >
                      skip
                    </button>
                  </div>
                ))}
                <p className="text-[10px] text-foreground/45">
                  Published keys can be out of date. If this person writes to you, their real key replaces this one
                  automatically.
                </p>
              </div>
            )}
            {keyPasteOpen && (
              <div className="px-3 py-2 border-b border-border/60 space-y-1.5">
                <textarea
                  value={keyPaste}
                  onChange={(e) => setKeyPaste(e.target.value)}
                  rows={4}
                  placeholder="Only if this person sent you their public key directly (BEGIN PGP PUBLIC KEY BLOCK)"
                  className="w-full bg-transparent border border-border/70 rounded px-2 py-1 text-[11px] font-mono resize-y outline-none"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={savePastedKey}
                    disabled={keyPasteBusy || !keyPaste.trim()}
                    className="text-[11px] px-2 py-1 rounded bg-primary/15 text-primary disabled:opacity-50"
                  >
                    {keyPasteBusy ? 'saving…' : 'Save key'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setKeyPasteOpen(false); setKeyPaste(''); setKeyPasteNote('') }}
                    className="text-[11px] text-foreground/50"
                  >
                    cancel
                  </button>
                  <span className="text-[11px] text-foreground/60">{keyPasteNote}</span>
                </div>
              </div>
            )}
            {keyPasteNote && !keyPasteOpen && (
              <p className="px-3 py-1 text-[11px] text-primary/80 border-b border-border/60">{keyPasteNote}</p>
            )}
            {pgpOn && found && (
              <p className="px-3 py-1 text-[11px] text-foreground/60 border-b border-border/60">{found}</p>
            )}
            {pgpError && (
              <p className="px-3 py-1 text-[11px] text-destructive border-b border-border/60">{pgpError}</p>
            )}
            <TiptapEditor
              value={body}
              onChange={setBody}
              placeholder="Write your message… (or drag & drop files to attach)"
            />

            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-3 py-2 border-t border-border/60 shrink-0">
                {attachments.map((att) => (
                  <AttachmentChip key={att.id} att={att} onRemove={() => removeAttachment(att.id)} />
                ))}
              </div>
            )}
          </div>

          {/* Footer. The encryption line gets its own block: one long warning in a
              row with the buttons is what pushed Send off the right edge of a
              phone. On small screens the actions own a row and Send is pinned
              right, so it cannot be crowded out by text. */}
          <div className="shrink-0 border-t border-border">
            {encryptionLine && (
              <p
                className={`px-3 pt-2 text-[11px] leading-snug ${
                  encryptionLine.tone === 'good' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
                }`}
              >
                {encryptionLine.text}
              </p>
            )}

            <div className="px-3 py-2 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
                {hasLoadingFiles && !isSending && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Reading files…
                  </span>
                )}
                {isSending && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> {sendStatusLabel}
                  </span>
                )}
                {sendState === 'done' && (
                  <span className="flex items-center gap-1.5 text-xs text-primary">
                    <CheckCircle2 className="w-3.5 h-3.5" /> {sendStatusLabel}
                  </span>
                )}
                {sendState === 'scheduled' && (
                  <span className="flex items-center gap-1.5 text-xs text-primary">
                    <Clock className="w-3.5 h-3.5" />
                    Held until {scheduledFor ? formatWhen(new Date(scheduledFor * 1000)) : 'then'} — nothing has gone out yet
                  </span>
                )}
                {sendState === 'error' && (
                  <span className="flex items-center gap-1.5 text-xs text-destructive min-w-0">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate" title={sendError}>{sendError}</span>
                  </span>
                )}
                {sendState === 'done' && sendResults.length > 0 && (
                  <div className="flex items-center gap-1.5 text-xs ml-2 shrink-0">
                    {sendResults.map((r, i) => (
                      <span
                        key={i}
                        title={r.error ?? undefined}
                        className={r.status === 'failed' ? 'text-destructive' : 'text-primary'}
                      >
                        {r.address.split('@')[0]}: {r.status}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 w-full sm:w-auto shrink-0">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? [])
                    if (files.length > 0) addFiles(files)
                    e.target.value = ''
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isSendBlocked}
                  className="p-2 sm:p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
                  title="Attach files (max 20 MB each)"
                  aria-label="Attach files"
                >
                  <Paperclip className="w-4 h-4" />
                </button>
                <label
                  className="flex items-center gap-1 text-xs text-muted-foreground"
                  title="The recipient's copy is deleted by the server. Works for mailboxes on this server; another provider keeps its own copy."
                >
                  <Flame className={`w-4 h-4 sm:w-3.5 sm:h-3.5 ${vanish === 'off' ? 'opacity-50' : 'text-primary'}`} />
                  <select
                    value={vanish}
                    onChange={(e) => setVanish(e.target.value)}
                    disabled={isSendBlocked}
                    className="bg-transparent border border-border rounded px-1.5 py-1.5 sm:py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 max-sm:min-h-11 max-sm:w-[7.5rem]"
                    aria-label="Disappearing message"
                  >
                    <option value="off">No expiry</option>
                    <option value="read">Deletes after reading</option>
                    <option value="3600">Deletes in 1 hour</option>
                    <option value="86400">Deletes in 1 day</option>
                    <option value="604800">Deletes in 7 days</option>
                  </select>
                </label>
                {vanish !== 'off' && offServerRecipients.length > 0 && (
                  <span
                    className="hidden md:inline text-[10px] text-amber-600 dark:text-amber-400 max-w-[130px] leading-tight"
                    title={offServerRecipients.join(', ')}
                  >
                    {offServerRecipients.length} recipient{offServerRecipients.length === 1 ? ' is' : 's are'} elsewhere — {sealExternal ? 'sealed link, body stays here' : 'nothing to delete there'}
                  </span>
                )}
                {/* A disabled button with no reason reads as a broken app. */}
                {editNeedsTime && (
                  <span
                    title="This message is still held — pick a time to update it"
                    className="text-[10px] text-amber-600 dark:text-amber-400"
                  >
                    Pick a time
                  </span>
                )}
                <div className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setWhenOpen((v) => !v)}
                    title={sendAt ? `Held until ${formatWhen(sendAt)} — change` : 'Hold this message until…'}
                    className={`flex items-center gap-1 px-2 py-2 sm:py-1.5 rounded-md border text-xs ${
                      sendAt ? 'border-primary/40 text-primary bg-primary/10' : 'border-border text-foreground/60'
                    }`}
                  >
                    <Clock className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                    {sendAt && <span className="hidden sm:inline">{formatWhen(sendAt)}</span>}
                  </button>
                  {whenOpen && (
                    <div className="absolute bottom-full right-0 mb-2 w-56 rounded-lg border border-border bg-popover p-2 shadow-lg z-20">
                      <p className="px-1 pb-1 text-[11px] text-foreground/55">Hold until…</p>
                      {whenPresets().map(([label, when]) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => { setSendAt(when); setWhenOpen(false) }}
                          className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-foreground/5"
                        >
                          {label} <span className="text-foreground/45">· {formatWhen(when)}</span>
                        </button>
                      ))}
                      <input
                        type="datetime-local"
                        className="mt-1 w-full rounded border border-border bg-transparent px-2 py-1 text-xs"
                        onChange={(e) => {
                          const when = e.target.value ? new Date(e.target.value) : null
                          setSendAt(when)
                          if (when) setWhenOpen(false)
                        }}
                      />
                      {sendAt && !replaceId && (
                        <button
                          type="button"
                          onClick={() => { setSendAt(null); setWhenOpen(false) }}
                          className="mt-1 w-full rounded px-2 py-1.5 text-left text-xs text-destructive hover:bg-foreground/5"
                        >
                          Send now instead
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <button
                  onClick={sendWithPgpIfNeeded}
                  disabled={isSendBlocked || hasLoadingFiles || pgpBusy}
                  title={hasLoadingFiles
                    ? 'Waiting for files to finish loading…'
                    : editNeedsTime ? 'Pick a time — this message is still held' : undefined}
                  className="ml-auto sm:ml-0 flex items-center justify-center gap-2 px-5 sm:px-4 py-2 sm:py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0 max-sm:min-h-11"
                >
                  {isSending
                    ? <Loader2 className="w-4 h-4 sm:w-3.5 sm:h-3.5 animate-spin" />
                    : <Send className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                  }
                  {isSending
                    ? null
                    : replaceId
                      ? (sendAt ? `Update · ${formatWhen(sendAt)}` : 'Update')
                      : (sendAt ? `Hold · ${formatWhen(sendAt)}` : 'Send')}
                </button>
              </div>
            </div>

            {vanish !== 'off' && offServerRecipients.length > 0 && (
              <p className="px-3 pb-2 text-[10px] text-amber-600 dark:text-amber-400 md:hidden">
                Disappearing applies on this server only — {offServerRecipients.length} recipient
                {offServerRecipients.length === 1 ? ' is' : 's are'} elsewhere and will keep their copy.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default ComposeWindow
