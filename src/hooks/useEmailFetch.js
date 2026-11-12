import { useState, useRef, useCallback } from 'react'
import { storage } from '@/storage'
import { keySession } from '@/keySession'
import api from '@/api'
import { decryptStored } from '@/lib/decryptStored'
import { parseEmail } from '@/emailParser'
import { addressBook } from '@/addressBook'

const LIMIT = 20

export function useEmailFetch() {
  const [uids, setUids] = useState([])
  const [previews, setPreviews] = useState({})
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [offset, setOffset] = useState(0)
  const isFetchingRef = useRef(false)

  /** Previews for received messages by uid — the inbox page, or messages in the trash. */
  const fetchPreviewsFor = useCallback(async (list) => {
    if (!list.length) return
    const token = storage.getToken()
    const bulkRes = await api.post(
      '/email/bulk',
      `{"uids":[${list.map((u) => `"${u}"`).join(',')}]}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const privateKey = await keySession.get()
    const newPreviews = {}
    await Promise.all(
      bulkRes.data.emails.map(async ({ uid, data, message_key, received_at, ephemeral, from, alias }) => {
        try {
          // A message that deletes on open is never delivered through this
          // path (the server withholds its body), so there is nothing to
          // decrypt here — label it from the plaintext envelope instead.
          if (ephemeral === 'read') {
            newPreviews[uid] = {
              subject: 'Disappearing message',
              from: from ? { name: '', email: from } : null,
              date: received_at ? new Date(received_at) : null,
              preview: 'Deletes when you open it',
              attachments: [],
              ephemeral: 'read',
              alias: alias ?? null,
            }
            return
          }
          if (!privateKey) {
            console.warn('[useEmailFetch] Private key unavailable, cannot decrypt uid=%s', uid)
            newPreviews[uid] = { subject: '(key unavailable)', from: null, date: received_at ? new Date(received_at) : null, preview: '', attachments: [], decryptFailed: true }
            return
          }
          const text = await decryptStored(data, message_key, privateKey)
          const parsed = parseEmail(text)
          // A sender who attaches their key (Autocrypt) saves everyone a
          // lookup. Failures are silent by design: a bad header in one
          // message must not stop that message from loading.
          if (parsed?.autocrypt && parsed?.from?.email) {
            // Loads the OpenPGP library only for mail that actually carries a key.
            import('@/pgp').then((m) => m.importAutocryptKey(parsed.autocrypt, parsed.from.email)).catch(() => {})
          }
          addressBook.addAll(parsed?.from ? [parsed.from] : [])
          addressBook.addAll(parsed?.to ?? [])
          addressBook.addAll(parsed?.cc ?? [])
          newPreviews[uid] = {
            // Which address this arrived at, when it was an alias: a reply
            // should leave from the same one.
            alias:       alias ?? null,
            subject:     parsed?.subject     ?? '(no subject)',
            from:        parsed?.from        ?? null,
            date:        parsed?.date        ?? (received_at ? new Date(received_at) : null),
            preview:     parsed?.preview     ?? '',
            // Threading: keep the headers so conversations can be grouped.
            messageId:   parsed?.messageId   ?? '',
            inReplyTo:   parsed?.inReplyTo   ?? '',
            references:  parsed?.references  ?? '',
            attachments: parsed?.attachments ?? [],
            e2ee:        parsed?.e2ee        ?? false,
          }
        } catch (err) {
          console.error('[useEmailFetch] Failed to decrypt uid=%s:', uid, err)
          newPreviews[uid] = { subject: '(encrypted)', from: null, date: received_at ? new Date(received_at) : null, preview: '', attachments: [], decryptFailed: true }
        }
      }),
    )
    setPreviews((prev) => ({ ...prev, ...newPreviews }))
  }, [])

  const fetchEmails = useCallback(async (currentOffset) => {
    if (isFetchingRef.current) return
    isFetchingRef.current = true
    setLoading(true)
    try {
      const token = storage.getToken()
      const res = await api.post(
        '/email/recent',
        { offset: currentOffset, limit: LIMIT },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      const newUids = res.data.uids
      setUids((prev) => (currentOffset === 0 ? newUids : [...prev, ...newUids]))
      setHasMore(newUids.length === LIMIT)
      if (newUids.length > 0) await fetchPreviewsFor(newUids)
    } catch {}
    finally {
      isFetchingRef.current = false
      setLoading(false)
    }
  }, [fetchPreviewsFor])

  const loadMore = () => {
    if (isFetchingRef.current || !hasMore) return
    const next = offset + LIMIT
    setOffset(next)
    fetchEmails(next)
  }

  return { uids, setUids, previews, setPreviews, loading, hasMore, fetchEmails, loadMore, fetchPreviewsFor }
}
