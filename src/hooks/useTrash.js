import { useCallback, useState } from 'react'
import { toast } from '@/lib/toast'
import { deleteForever as deleteForeverApi, emptyTrash, isMissingRoute, listTrash, restoreMessage } from '@/lib/deleteMessage'

/**
 * The Trash folder: what was deleted in the last thirty days, from any folder.
 *
 * The server keeps the record (core::trash); this holds the list for the screen. Restore
 * puts a message back where it came from. Delete forever and Empty trash are the only
 * permanent deletes in the app, and the only ones that ask first.
 */
export function useTrash({ fetchPreviewsFor, fetchSentPreviews, setPreviews, onRestored }) {
  const [items, setItems] = useState([])
  const [retentionDays, setRetentionDays] = useState(30)
  const [available, setAvailable] = useState(true)

  const fetchTrash = useCallback(async () => {
    try {
      const { items: list, retentionDays: days } = await listTrash()
      setItems(list)
      setRetentionDays(days)
      setAvailable(true)
      const inbox = list.filter((item) => item.kind !== 'sent').map((item) => item.uid)
      const sent = list.filter((item) => item.kind === 'sent').map((item) => item.uid)
      await Promise.all([
        inbox.length ? fetchPreviewsFor(inbox).catch(() => {}) : null,
        sent.length ? fetchSentPreviews(sent) : null,
      ])
    } catch (error) {
      // A server without the trash: the folder says so instead of looking empty.
      if (isMissingRoute(error)) setAvailable(false)
    }
  }, [fetchPreviewsFor, fetchSentPreviews])

  /** Messages just moved to the trash elsewhere in the app, so the folder is current without a fetch. */
  const addTrashed = useCallback((moved) => {
    setItems((prev) => {
      const known = new Set(prev.map((item) => item.uid))
      return [...moved.filter((item) => !known.has(item.uid)), ...prev]
    })
  }, [])

  const drop = (uids) => {
    const set = new Set(uids.map(String))
    setItems((prev) => prev.filter((item) => !set.has(item.uid)))
  }

  const restore = useCallback(async (uids) => {
    const failed = []
    await Promise.all(uids.map(async (uid) => {
      try { await restoreMessage(uid) } catch { failed.push(uid) }
    }))
    const back = uids.filter((uid) => !failed.includes(uid))
    drop(back)
    if (back.length) await onRestored(back)
    toast(failed.length
      ? `Restored ${back.length}. ${failed.length} could not be restored.`
      : back.length === 1 ? 'Restored' : `Restored ${back.length}`)
    return { back, failed }
  }, [onRestored])

  /**
   * Permanent. The caller has already asked. `sentUids` says which list a message belongs to
   * when it is not in the trash (a server with no Trash deletes straight from the folder).
   */
  const deleteForever = useCallback(async (uids, { sentUids = [] } = {}) => {
    const kinds = new Map(items.map((item) => [item.uid, item.kind]))
    const sent = new Set(sentUids.map(String))
    const kindOf = (uid) => kinds.get(String(uid)) ?? (sent.has(String(uid)) ? 'sent' : 'inbox')
    const failed = []
    await Promise.all(uids.map(async (uid) => {
      try { await deleteForeverApi(uid, kindOf(uid)) } catch { failed.push(uid) }
    }))
    const gone = uids.filter((uid) => !failed.includes(uid))
    drop(gone)
    setPreviews((prev) => {
      const next = { ...prev }
      for (const uid of gone) delete next[uid]
      return next
    })
    toast(failed.length
      ? `Deleted ${gone.length} for good. ${failed.length} could not be deleted.`
      : gone.length === 1 ? 'Deleted for good' : `Deleted ${gone.length} for good`)
    return { gone, failed }
  }, [items, setPreviews])

  /** Permanent. The caller has already asked. */
  const empty = useCallback(async () => {
    try {
      const { deleted = 0, failed = 0 } = await emptyTrash()
      await fetchTrash()
      toast(failed ? `Deleted ${deleted} for good. ${failed} could not be deleted.` : `Trash emptied — ${deleted} deleted for good`)
    } catch {
      toast('Trash was not emptied — the server refused. Nothing was deleted.')
    }
  }, [fetchTrash])

  return { items, retentionDays, available, fetchTrash, addTrashed, restore, deleteForever, empty }
}
