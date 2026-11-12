import api from '@/api'
import { storage } from '@/storage'
import { toast } from '@/lib/toast'
import { deleteMessage } from '@/lib/deleteMessage'

/**
 * Every action here used to end in `catch {}`: a refused star, read mark, move or delete
 * looked done on screen and quietly came back on the next refresh. The screen now changes
 * only to what the server accepted — an optimistic change is put back when it is refused —
 * and a refusal says so in a toast.
 */
export function useEmailActions({
  emailMeta, setEmailMeta, setUids, setPreviews, setSelectedUid, setGroups, groups,
  sentUids = [], setSentUids = () => {},
}) {
  const patchMeta = (uid, patch) => {
    setEmailMeta((prev) => {
      const updated = { ...prev, [uid]: { ...prev[uid], ...patch } }
      storage.setEmailMeta(uid, patch)
      return updated
    })
  }

  const headers = () => ({ Authorization: `Bearer ${storage.getToken()}` })

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

  /** Forget a deleted message everywhere the screen holds it. */
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
    setGroups((prev) => prev.map((g) => ({ ...g, email_uids: g.email_uids.filter((u) => !set.has(String(u))) })))
  }

  /** The server already drops a deleted message from its groups; tidy any group that still lists it. */
  const leaveGroups = async (uid) => {
    for (const g of groups) {
      if (g.email_uids.map(String).includes(String(uid))) {
        try {
          await api.post('/group/remove-email', `{"group_uid":${g.uid},"email_uid":${uid}}`, { headers: headers() })
        } catch {
          // silent: the delete itself removed the message from its groups; this is housekeeping.
        }
      }
    }
  }

  /** Delete one message. Returns true when the server deleted it. */
  const deleteEmail = async (uid) => {
    try {
      await deleteMessage(uid, sentUids)
    } catch {
      toast('That message was not deleted — the server refused. It is still here.')
      return false
    }
    await leaveGroups(uid)
    forget([uid])
    toast('Message deleted')
    return true
  }

  /** Delete several. Only what the server deleted leaves the screen; the rest is returned. */
  const deleteMany = async (list) => {
    const failed = []
    await Promise.all(list.map(async (uid) => {
      try {
        await deleteMessage(uid, sentUids)
        await leaveGroups(uid)
      } catch {
        failed.push(uid)
      }
    }))
    const gone = list.filter((uid) => !failed.includes(uid))
    if (gone.length) forget(gone)
    return { gone, failed }
  }

  const moveToGroup = async (emailUid, groupId) => {
    try {
      for (const g of groups) {
        if (g.uid !== groupId && g.email_uids.includes(emailUid)) {
          await api.post('/group/remove-email', `{"group_uid":${g.uid},"email_uid":${emailUid}}`, { headers: headers() })
        }
      }
      await api.post('/group/add-email', `{"group_uid":${groupId},"email_uid":${emailUid}}`, { headers: headers() })
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
      await api.post('/group/remove-email', `{"group_uid":${groupId},"email_uid":${emailUid}}`, { headers: headers() })
    } catch {
      toast('Could not take that message out of the group.')
      return
    }
    setGroups((prev) => prev.map((g) =>
      g.uid === groupId ? { ...g, email_uids: g.email_uids.filter((u) => u !== emailUid) } : g,
    ))
  }

  return { patchMeta, markRead, markUnread, toggleStar, deleteEmail, deleteMany, moveToGroup, removeFromGroup }
}
