import { useRef } from 'react'
import api from '@/api'
import { storage } from '@/storage'
import { toast } from '@/lib/toast'
import { isMissingRoute, restoreMessage, trashMessage } from '@/lib/deleteMessage'
import { groupEmail } from '@/lib/groupEmail'

/**
 * Delete moves to Trash (see core::trash on the server); Undo, Restore and Delete forever
 * live in useTrash.
 *
 * Every action here used to end in `catch {}`: a refused star, read mark, move or delete
 * looked done on screen and quietly came back on the next refresh. The screen now changes
 * only to what the server accepted — an optimistic change is put back when it is refused —
 * and a refusal says so in a toast.
 */
export function useEmailActions({
  emailMeta, setEmailMeta, setUids, setPreviews, setSelectedUid, setGroups, groups,
  setSentUids = () => {}, onTrashed = () => {}, onRestored = () => {},
}) {
  const patchMeta = (uid, patch) => {
    setEmailMeta((prev) => {
      const updated = { ...prev, [uid]: { ...prev[uid], ...patch } }
      storage.setEmailMeta(uid, patch)
      return updated
    })
  }

  const headers = () => ({ Authorization: `Bearer ${storage.getToken()}` })
  // The last delete that can still be taken back, for the Z shortcut.
  const lastTrashed = useRef([])

  const markRead = async (uid) => {
    if (emailMeta[uid]?.unread === false) return
    patchMeta(uid, { unread: false })
    try {
      await api.post('/email/read', `{"uid":"${uid}"}`, { headers: headers() })
    } catch {
      patchMeta(uid, { unread: true })
      toast('Could not mark that as read. Try again in a moment.')
    }
  }

  const markUnread = async (uid) => {
    patchMeta(uid, { unread: true })
    try {
      await api.post('/email/unread', `{"uid":"${uid}"}`, { headers: headers() })
    } catch {
      patchMeta(uid, { unread: false })
      toast('Could not mark that as unread. Try again in a moment.')
    }
  }

  const toggleStar = async (uid) => {
    const next = !emailMeta[uid]?.starred
    patchMeta(uid, { starred: next })
    try {
      await api.post('/email/star', `{"uid":"${uid}","starred":${next}}`, { headers: headers() })
    } catch {
      patchMeta(uid, { starred: !next })
      toast(next ? 'Could not star that message.' : 'Could not remove the star.')
    }
  }

  /** Forget a trashed message everywhere the screen holds it (groups keep it: Restore brings it back there). */
  const forget = (gone) => {
    const set = new Set(gone.map(String))
    setUids((prev) => prev.filter((u) => !set.has(String(u))))
    setSentUids((prev) => {
      const next = prev.filter((u) => !set.has(String(u)))
      if (next.length !== prev.length) storage.setSentUids(next)
      return next
    })
    setPreviews((prev) => {
      const next = { ...prev }
      for (const uid of gone) delete next[uid]
      return next
    })
    setSelectedUid((prev) => (set.has(String(prev)) ? null : prev))
  }

  /** Put trashed messages back: one restore each, then the folders are read again from the server. */
  const undoTrash = async (list) => {
    if (lastTrashed.current === list) lastTrashed.current = []
    const failed = []
    await Promise.all(list.map(async (uid) => {
      try { await restoreMessage(uid) } catch { failed.push(uid) }
    }))
    await onRestored(list.filter((uid) => !failed.includes(uid)))
    if (failed.length) toast(`${failed.length} could not be restored — they are still in Trash.`)
  }

  /**
   * Delete = move to Trash, for every folder. Received mail and sent copies both go there; the
   * server remembers which list each came from. Only what the server moved leaves the screen.
   * Returns { gone, failed, missingRoute }.
   */
  const trashMany = async (list) => {
    const failed = []
    const moved = []
    let missingRoute = false
    await Promise.all(list.map(async (uid) => {
      try {
        const res = await trashMessage(uid)
        moved.push({ uid: String(uid), kind: res?.kind ?? 'inbox', trashed_at: Math.floor(Date.now() / 1000) })
      } catch (error) {
        if (isMissingRoute(error)) missingRoute = true
        failed.push(uid)
      }
    }))
    const gone = list.filter((uid) => !failed.includes(uid))
    if (gone.length) {
      forget(gone)
      onTrashed(moved)
      lastTrashed.current = gone
    }
    return { gone, failed, missingRoute }
  }

  const trashedToast = (gone, failed) => {
    const n = gone.length
    const head = n === 1 ? 'Moved to Trash' : `Moved ${n} to Trash`
    const tail = failed.length ? ` ${failed.length} could not be moved — still selected.` : ''
    toast(`${head}.${tail}`, { action: { label: 'Undo', run: () => undoTrash(gone) } })
  }

  /** Z: take back the last delete, if there is one to take back. */
  const undoLast = async () => {
    const list = lastTrashed.current
    if (!list.length) {
      toast('Nothing to undo.')
      return
    }
    await undoTrash(list)
    toast(list.length === 1 ? 'Restored' : `Restored ${list.length}`)
  }

  /**
   * Delete one message (to Trash, with Undo). Returns true when it moved, 'no-trash' when this
   * server has no Trash (the caller offers to delete for good instead), false when refused.
   */
  const deleteEmail = async (uid) => {
    const { gone, failed, missingRoute } = await trashMany([uid])
    if (!gone.length) {
      if (missingRoute) return 'no-trash'
      toast('That message was not deleted — the server refused. It is still here.')
      return false
    }
    trashedToast(gone, failed)
    return true
  }

  /**
   * Delete several (to Trash, with one Undo for all). A server with no Trash moves nothing and
   * says so with `missingRoute`; the caller offers to delete for good instead of pretending.
   */
  const deleteMany = async (list) => {
    const outcome = await trashMany(list)
    if (outcome.gone.length) trashedToast(outcome.gone, outcome.failed)
    else if (outcome.failed.length && !outcome.missingRoute) {
      toast(outcome.failed.length === 1
        ? 'That message was not deleted — the server refused. It is still here.'
        : `None of the ${outcome.failed.length} were deleted — the server refused. They are still here.`)
    }
    return outcome
  }

  const moveToGroup = async (emailUid, groupId) => {
    try {
      for (const g of groups) {
        if (g.uid !== groupId && g.email_uids.includes(emailUid)) {
          await groupEmail('remove', g.uid, emailUid)
        }
      }
      await groupEmail('add', groupId, emailUid)
    } catch {
      toast('Could not move that message. It is where it was.')
      return
    }
    setGroups((prev) => prev.map((g) => {
      if (g.uid === groupId) return { ...g, email_uids: [...new Set([...g.email_uids, emailUid])] }
      return { ...g, email_uids: g.email_uids.filter((u) => u !== emailUid) }
    }))
  }

  const removeFromGroup = async (emailUid, groupId) => {
    try {
      await groupEmail('remove', groupId, emailUid)
    } catch {
      toast('Could not take that message out of the group.')
      return
    }
    setGroups((prev) => prev.map((g) =>
      g.uid === groupId ? { ...g, email_uids: g.email_uids.filter((u) => u !== emailUid) } : g,
    ))
  }

  return { patchMeta, markRead, markUnread, toggleStar, deleteEmail, deleteMany, undoTrash, undoLast, moveToGroup, removeFromGroup, forget }
}
