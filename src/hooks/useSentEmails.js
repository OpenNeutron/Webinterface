import { useState, useRef, useCallback } from 'react'
import { storage } from '@/storage'
import { keySession } from '@/keySession'
import api from '@/api'
import { decryptStored } from '@/lib/decryptStored'
import { parseEmail } from '@/emailParser'

export function useSentEmails(setPreviews) {
  const [sentUids, setSentUids] = useState(() => storage.getSentUids())
  const isFetchingSentRef = useRef(false)

  const fetchSentUids = useCallback(async () => {
    try {
      const token = storage.getToken()
      const res = await api.post(
        '/email/sent/recent',
        { offset: 0, limit: 200 },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      const uids = (res.data.uids ?? []).map(String)
      setSentUids(uids)
      storage.setSentUids(uids)
      return uids
    } catch {
      return []
    }
  }, [])

  const fetchSentPreviews = useCallback(async (uids) => {
    if (!uids.length || isFetchingSentRef.current) return
    isFetchingSentRef.current = true
    try {
      const token = storage.getToken()
      const bulkRes = await api.post(
        '/email/sent/bulk',
        `{"uids":[${uids.map((u) => `"${u}"`).join(',')}]}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      const privateKey = await keySession.get()
      const newPreviews = {}
      await Promise.all(
        bulkRes.data.emails.map(async ({ uid, data, message_key, received_at }) => {
          try {
            if (!privateKey) {
              console.warn('[useSentEmails] Private key unavailable, cannot decrypt uid=%s', uid)
              newPreviews[uid] = { subject: '(key unavailable)', from: null, date: received_at ? new Date(received_at) : null, preview: '', attachments: [], decryptFailed: true }
              return
            }
            const text = await decryptStored(data, message_key, privateKey)
            const parsed = parseEmail(text)
            newPreviews[uid] = {
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
            console.error('[useSentEmails] Failed to decrypt uid=%s:', uid, err)
            newPreviews[uid] = { subject: '(encrypted)', from: null, date: received_at ? new Date(received_at) : null, preview: '', attachments: [], decryptFailed: true }
          }
        }),
      )
      setPreviews((prev) => ({ ...prev, ...newPreviews }))
    } catch {}
    finally {
      isFetchingSentRef.current = false
    }
  }, [setPreviews])

  return { sentUids, setSentUids, fetchSentUids, fetchSentPreviews }
}
