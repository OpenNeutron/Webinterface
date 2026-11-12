import api from '@/api'
import { storage } from '@/storage'

/**
 * One delete for every folder.
 *
 * The server keeps received mail and the sender's own sent copies in two lists, and its
 * inbox delete only looks in the first. A message deleted from Sent was answered 404 and
 * the app swallowed it: the row stayed, nothing said why. A sent copy goes to its own
 * endpoint; everything else to the inbox one.
 *
 * @param {string|number} uid
 * @param {Iterable<string>} sentUids the uids of the caller's sent copies
 */
export function deleteEndpoint(uid, sentUids = []) {
  const id = String(uid)
  for (const sent of sentUids) if (String(sent) === id) return '/email/sent/delete'
  return '/email/delete'
}

/**
 * Delete one message. Throws when the server refuses, so the caller can keep the row and say so.
 * The uid is sent as a string: it is a 128-bit number and JSON numbers lose precision past 2^53.
 */
export async function deleteMessage(uid, sentUids) {
  const token = storage.getToken()
  await api.post(deleteEndpoint(uid, sentUids), `{"uid":"${uid}"}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}
