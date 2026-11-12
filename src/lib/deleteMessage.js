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

const auth = () => ({ headers: { Authorization: `Bearer ${storage.getToken()}` } })

/**
 * A server that predates the trash answers its router's 404 (`not_found`), not the
 * endpoint's `email_not_found`. Told apart so the app can say "update the server"
 * instead of pretending the message is missing.
 */
export function isMissingRoute(error) {
  return error?.response?.status === 404 && error?.response?.data?.code === 'not_found'
}

/** Move one message (received or sent) to the trash. */
export async function trashMessage(uid) {
  const { data } = await api.post('/email/trash', `{"uid":"${uid}"}`, auth())
  return data
}

/** Take one message out of the trash, back to where it was. */
export async function restoreMessage(uid) {
  await api.post('/email/restore', `{"uid":"${uid}"}`, auth())
}

/** The trash, newest first: [{ uid, kind: 'inbox'|'sent', trashed_at, deletes_at }]. */
export async function listTrash() {
  const { data } = await api.post('/email/trash/list', {}, auth())
  return { items: (data?.items ?? []).map((item) => ({ ...item, uid: String(item.uid) })), retentionDays: data?.retention_days ?? 30 }
}

/** Delete everything in the trash, for good. */
export async function emptyTrash() {
  const { data } = await api.post('/email/trash/empty', {}, auth())
  return data
}

/** Delete one trashed message for good, from the list it belongs to. */
export async function deleteForever(uid, kind) {
  await api.post(kind === 'sent' ? '/email/sent/delete' : '/email/delete', `{"uid":"${uid}"}`, auth())
}
