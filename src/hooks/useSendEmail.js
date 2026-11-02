import { useState, useCallback } from 'react'
import api from '@/api'
import { storage } from '@/storage'
import { keySession } from '@/keySession'
import { encryptEmail, getPublicCryptoKeyFromPrivate, hashPublicKey, sealForRecipient } from '@/crypto'
import { buildEmail } from '@/lib/emailBuilder'
import { loadProfile, formatSender } from '@/lib/profile'
import { utf8ToBase64 } from '@/lib/mime'
import { isValidEmail } from '@/lib/utils'

/**
 * A sealed note nobody can find is litter on the server, so every note gets a
 * deadline even when the sender picked "delete when read" and no timer.
 */
const SEALED_DEFAULT_SECONDS = 7 * 24 * 60 * 60

function formatDeadline(expiresAt) {
  if (!expiresAt) return ''
  const date = new Date(expiresAt * 1000)
  return date.toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function sealedNotice({ url, expiresAt, subject, from, passphrase }) {
  const deadline = formatDeadline(expiresAt)
  const how = passphrase
    ? [
        'The message itself is not in this email. It is locked with a passphrase',
        'the sender will send you separately, and held on their server until you',
        'open the link — then it is deleted and the link stops working.',
        '',
        'Open the link, type the passphrase, and the message appears. Nothing to',
        'install.',
      ]
    : [
        'The message itself is not in this email. It is encrypted to your OpenPGP',
        "key and held on the sender's server until you open the link — then it is",
        'deleted, and the link stops working.',
        '',
        'You will need your private key to read it: your mail client, or',
        'gpg --decrypt on the text the page gives you.',
      ]
  return [
    `${from} sent you a sealed note.`,
    '',
    `Subject: ${subject || '(no subject)'}`,
    '',
    'Open it here:',
    url,
    '',
    ...how,
    '',
    deadline ? `The link closes on ${deadline}.` : '',
  ].filter((line) => line !== null).join('\n')
}

export function useSendEmail({ myEmail, replyData, draftId, onDeleteDraft, onSent, onClose, onScheduled, replaceId = null }) {
  const [sendState, setSendState] = useState('idle')
  const [scheduledFor, setScheduledFor] = useState(0)
  const [sendError, setSendError] = useState('')
  const [sendResults, setSendResults] = useState([])
  // Notes created by the last send, so the window can name their links.
  const [sealedNotes, setSealedNotes] = useState([])

  const reportError = useCallback((msg) => {
    setSendError(msg)
    setSendState('error')
  }, [])

  /**
   * Sealed notes: for a recipient on another provider the message body is not
   * sent at all. It is PGP-armoured by the compose window ("sealed" here) and
   * stored on this server; the recipient gets a link that we can delete.
   */
  const handleSend = async ({ toChips, ccChips, bccChips, subject, body, attachments, ephemeral, sealed, sealMode, sealedPhrase, sealedFiles, sendAt: whenToSend, fromAlias = '' }) => {
    const allTo  = toChips.filter((a) => a.trim())
    const allCc  = ccChips.filter((a) => a.trim())
    const allBcc = bccChips.filter((a) => a.trim())
    const allRecipients = [...allTo, ...allCc, ...allBcc]
    // Empty means the account address. The server checks the alias is ours and on.
    const aliasField = fromAlias ? { from_alias: fromAlias } : {}

    if (allTo.length === 0) {
      reportError('Add at least one recipient in the To field.')
      return
    }
    const invalid = allRecipients.filter((a) => !isValidEmail(a))
    if (invalid.length > 0) {
      reportError(`Invalid address${invalid.length > 1 ? 'es' : ''}: ${invalid.join(', ')}`)
      return
    }
    const loadingFiles = attachments.filter((a) => a.status === 'loading')
    if (loadingFiles.length > 0) {
      reportError(`${loadingFiles.length} attachment${loadingFiles.length > 1 ? 's are' : ' is'} still loading - please wait.`)
      return
    }
    const failedFiles = attachments.filter((a) => a.status === 'error')
    if (failedFiles.length > 0) {
      reportError(`Remove failed attachment${failedFiles.length > 1 ? 's' : ''} before sending: ${failedFiles.map((a) => a.name).join(', ')}`)
      return
    }

    setSendError('')
    setSendState('resolving')

    try {
      const token   = storage.getToken()
      const headers = { Authorization: `Bearer ${token}` }

      setSendState('fetchingkeys')
      const resolveRes = await api.post('/email/publickeys', { addresses: allRecipients }, { headers })
      const keyEntries = resolveRes.data.keys ?? []
      const keyMap = Object.fromEntries(
        keyEntries.map((k) => [k.address.toLowerCase(), k.public_key])
      )
      // Where a recipient also published an ML-KEM key, their copy is sealed to
      // both halves. A missing key is not a downgrade to hide: there is nothing
      // to seal to, and the copy says so by being RSA-only.
      const pqKeyMap = Object.fromEntries(
        keyEntries.filter((k) => k.pq_public_key).map((k) => [k.address.toLowerCase(), k.pq_public_key])
      )

      setSendState('encrypting')

      const hasAnyKey = allRecipients.some((addr) => !!keyMap[addr.toLowerCase()])

      const profile = loadProfile()
      // Sending from an alias has to change the header too — on the encrypted
      // path the server only sets the envelope, it never sees this text.
      const sendAs = fromAlias ? `${fromAlias}@${myEmail.split('@').slice(1).join('@')}` : myEmail
      const fromHeader = formatSender(sendAs, profile.displayName)

      // The signature is appended to the body, so it is inside the ciphertext
      // like everything else the recipient reads.
      const signature = (profile.signature || '').trim()
      const bodyWithSignature = signature
        ? `${body}${body && !body.endsWith('\n') ? '\n' : ''}\n-- \n${signature}`
        : body

      const rawEmail = buildEmail({
        from:        fromHeader,
        to:          allTo,
        cc:          allCc,
        subject,
        body:        bodyWithSignature,
        attachments: attachments.map(({ name, type, data }) => ({ name, type, data })),
        inReplyTo:   replyData?.inReplyTo ?? '',
        references:  replyData?.references ?? '',
        e2ee:        hasAnyKey,
      })

      const privateKey = await keySession.get()
      if (!privateKey) throw new Error('Session expired - please log in again.')

      const myPublicKey = await getPublicCryptoKeyFromPrivate(privateKey)
      // Filled in below when a sealed note is created: the sender's own copy is
      // the only place the link — and a passphrase — is written down.
      let localCopy = await encryptEmail(rawEmail, myPublicKey)

      let publicKeyHash = ''
      const storedPubKey = storage.getPublicKey()
      if (storedPubKey) publicKeyHash = await hashPublicKey(storedPubKey)

      const sealedMap = sealed && typeof sealed === 'object' ? sealed : {}
      const sealedAddrs = allRecipients.filter((addr) => sealedMap[addr])

      const recipientsPayload = {}
      for (const addr of allRecipients) {
        if (sealedAddrs.includes(addr)) continue
        const lower = addr.toLowerCase()
        const recipientKeyB64 = keyMap[lower]
        if (recipientKeyB64) {
          recipientsPayload[addr] = await sealForRecipient(
            rawEmail,
            { publicKeyBase64: recipientKeyB64, pqPublicKey: pqKeyMap[lower] },
            lower.split('@')[0],
          )
        } else {
          recipientsPayload[addr] = { aes_encrypted: '', data_encrypted: utf8ToBase64(rawEmail), e2ee: false }
        }
      }

      // A note has to exist before the notification that points at it goes out.
      // If the send then fails, the note is unreachable: nobody has the link,
      // and its timer clears it.
      const notes = []
      for (const addr of sealedAddrs) {
        const seconds = ephemeral?.expires_in_seconds ?? SEALED_DEFAULT_SECONDS
        const noteRes = await api.post(
          '/note/create',
          {
            recipient: addr,
            subject,
            armored: sealedMap[addr],
            deletes_on_read: true,
            expires_in_seconds: seconds,
            mode: sealMode === 'passphrase' ? 'passphrase' : 'pgp',
            // Sealed to the same phrase as the body: the recipient's page opens
            // one and has the other already in hand.
            ...(sealMode === 'passphrase' && sealedFiles?.length ? { files: sealedFiles } : {}),
          },
          { headers },
        )
        const { url, expires_at } = noteRes.data
        notes.push({ address: addr, url, expiresAt: expires_at })

        const notice = sealedNotice({ url, expiresAt: expires_at, subject, from: fromHeader, passphrase: sealMode === 'passphrase' })
        const noticeEmail = buildEmail({
          from:        fromHeader,
          to:          [addr],
          cc:          [],
          subject,
          body:        notice,
          attachments: [],
          inReplyTo:   replyData?.inReplyTo ?? '',
          references:  replyData?.references ?? '',
          e2ee:        !!keyMap[addr.toLowerCase()],
        })

        const lower = addr.toLowerCase()
        const recipientKeyB64 = keyMap[lower]
        if (recipientKeyB64) {
          recipientsPayload[addr] = await sealForRecipient(
            noticeEmail,
            { publicKeyBase64: recipientKeyB64, pqPublicKey: pqKeyMap[lower] },
            lower.split('@')[0],
          )
        } else {
          recipientsPayload[addr] = { aes_encrypted: '', data_encrypted: utf8ToBase64(noticeEmail), e2ee: false }
        }
      }

      if (notes.length > 0) {
        const block = notes
          .map((n) => [
            `Sealed note to ${n.address}`,
            `  link: ${n.url}`,
            sealMode === 'passphrase' ? `  passphrase: ${sealedPhrase}` : '  locked to their OpenPGP key',
            `  closes: ${formatDeadline(n.expiresAt)}`,
          ].join('\n'))
          .join('\n\n')
        const localRaw = buildEmail({
          from:        fromHeader,
          to:          allTo,
          cc:          allCc,
          subject,
          body:        `${bodyWithSignature}\n\n---\n${block}\n`,
          attachments: attachments.map(({ name, type, data }) => ({ name, type, data })),
          inReplyTo:   replyData?.inReplyTo ?? '',
          references:  replyData?.references ?? '',
          e2ee:        hasAnyKey,
        })
        localCopy = await encryptEmail(localRaw, myPublicKey)
      }

      setSendState('sending')

      // A time, if the sender picked one. The server holds the message — built,
      // encrypted and addressed exactly as an immediate send — and releases it.
      const sendAt = whenToSend ? Math.floor(whenToSend.getTime() / 1000) : 0

      const res = await api.post(
        '/email/sendencrypted',
        {
          localcopy: {
            to:              allRecipients,
            timestamp:       Math.floor(Date.now() / 1000),
            public_key_hash: publicKeyHash,
            raw_data:        localCopy.data_encrypted,
            message_key:     localCopy.aes_encrypted,
            e2ee:            true,
          },
          recipients: recipientsPayload,
          // Only applied to mailboxes on this server; the compose window says so.
          ...(ephemeral && (ephemeral.deletes_on_read || ephemeral.expires_in_seconds)
            ? { ephemeral }
            : {}),
          ...(sendAt > 0 ? { send_at: sendAt, subject } : {}),
          // Editing a held message: the server replaces it in place and keeps the
          // id, so this is the same request shape as a first scheduling.
          // Always named when editing, even if no time was chosen: the server must
          // be able to refuse that case instead of sending a second copy.
          ...(replaceId ? { replace_id: replaceId } : {}),
          // Keep the account address in the sent copy either way: the message
          // went out as the alias, and this is where it is filed.
          ...aliasField,
        },
        { headers },
      )

      if (res.data.scheduled) {
        // Nothing went out yet, so there is no sent copy to record. The compose
        // window says when it will go and closes.
        setScheduledFor(res.data.send_at)
        // The server cannot hand the plaintext back — it never had it. The device
        // keeps its own copy so the message can be reopened and edited here.
        onScheduled?.({
          ...res.data,
          draft: { to: allTo, cc: allCc, bcc: allBcc, subject, body },
        })
        // An edit keeps the device-side copy: it is the only thing that can reopen
        // this message later. A first scheduling still clears the plain draft.
        if (draftId && !replaceId) onDeleteDraft?.(draftId)
        setSendState('scheduled')
        return
      }

      if (res.data.sent_email_uid) storage.addSentUid(res.data.sent_email_uid)
      if (draftId) onDeleteDraft?.(draftId)

      const results = res.data.delivery_results ?? []
      setSendResults(results)
      if (notes.length > 0) {
        setSealedNotes(notes)
      }
      if (onSent) onSent(res.data.sent_email_uid)

      // The server reports delivery per recipient. A rejected address is not a
      // sent message: saying "Sent" would hide a message the user believes went
      // out, so the compose window stays open and names what failed.
      const failed = results.filter((r) => r && r.success === false)
      if (failed.length > 0) {
        const summary = failed
          .slice(0, 3)
          .map((r) => `${r.address}${r.error ? ` — ${r.error}` : ''}`)
          .join('; ')
        const more = failed.length > 3 ? ` (+${failed.length - 3} more)` : ''
        // A notification that never arrives leaves a note nobody has the link
        // to: say so, and when it dies, instead of only "not delivered".
        const noteLine = notes.length
          ? ` The sealed note could not be announced; it closes unopened on ${formatDeadline(notes[0].expiresAt)}.`
          : ''
        setSendError(`Not delivered to ${failed.length} of ${results.length}: ${summary}${more}.${noteLine}`)
        setSendState('error')
        return
      }

      setSendState('done')
      setTimeout(() => onClose(null), 2000)
    } catch (err) {
      reportError(err.response?.data?.error ?? err.message ?? 'Send failed. Please try again.')
    }
  }

  return { sendState, sendError, sendResults, sealedNotes, scheduledFor, handleSend, reportError }
}
