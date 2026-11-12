/**
 * The server is the source of truth for read/starred.
 *
 * localStorage still caches the mailbox, but a browser that has never seen a
 * message must take these flags from the server — otherwise the same account
 * shows every message as unread (and nothing starred) on a second device.
 */
export function mergeServerFlags(prevMeta, flags) {
  const next = { ...(prevMeta ?? {}) }
  for (const f of flags ?? []) {
    if (f?.uid === undefined || f?.uid === null) continue
    const key = String(f.uid)
    next[key] = {
      ...(next[key] ?? {}),
      unread: !f.read,
      starred: !!f.starred,
    }
  }
  return next
}

/** Count what the sidebar shows, using the same merged state. */
export function folderCounts(meta, uids) {
  let unread = 0
  let starred = 0
  for (const uid of uids ?? []) {
    const m = meta?.[uid]
    if (m?.unread !== false) unread += 1
    if (m?.starred) starred += 1
  }
  return { unread, starred }
}
