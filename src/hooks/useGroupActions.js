import api from '@/api'
import { storage } from '@/storage'
import { toast } from '@/lib/toast'

const auth = () => ({ headers: { Authorization: `Bearer ${storage.getToken()}` } })

/** One address per entry, lowercased, deduplicated; anything without an @ is dropped. */
export function cleanAddresses(list) {
  const out = []
  for (const raw of list) {
    const match = String(raw ?? '').match(/<([^>]+)>/)
    const address = (match ? match[1] : String(raw ?? '')).trim().replace(/^"+|"+$/g, '').toLowerCase()
    if (address.includes('@') && !/\s/.test(address) && !out.includes(address)) out.push(address)
  }
  return out
}

/**
 * Groups and their sender rules. Every call here used to end in `catch {}`: a group that was not
 * created, renamed or deleted looked as if it had been, until the next reload.
 */
export function useGroupActions({ setGroups, setSelectedFolder, setModalState }) {
  const createGroup = async (name) => {
    if (!name) return
    try {
      const res = await api.post('/group/create', { title: name, filter_addresses: [] }, auth())
      setGroups((prev) => [...prev, res.data])
    } catch {
      toast(`The group “${name}” was not created — the server refused. Try again in a moment.`)
    }
    setModalState({ type: null })
  }

  const renameGroup = async (uid, name) => {
    if (!name) return
    try {
      const res = await api.post('/group/update', `{"uid":"${uid}","title":${JSON.stringify(name)}}`, auth())
      setGroups((prev) => prev.map((g) => (g.uid === uid ? res.data : g)))
    } catch {
      toast('The group was not renamed — the server refused. It keeps its old name.')
    }
    setModalState({ type: null })
  }

  const deleteGroup = async (uid) => {
    try {
      await api.post('/group/delete', `{"uid":"${uid}"}`, auth())
      setGroups((prev) => prev.filter((g) => g.uid !== uid))
      setSelectedFolder('inbox')
    } catch {
      toast('The group was not deleted — the server refused. It is still there.')
    }
    setModalState({ type: null })
  }

  /**
   * Replace a group's sender rules: mail from these addresses is filed into the group as it
   * arrives. Returns the updated group, or null when the server refused.
   */
  const setSenderRules = async (uid, addresses) => {
    const clean = cleanAddresses(addresses)
    try {
      const res = await api.post('/group/update', `{"uid":"${uid}","filter_addresses":${JSON.stringify(clean)}}`, auth())
      setGroups((prev) => prev.map((g) => (g.uid === uid ? res.data : g)))
      return res.data
    } catch {
      toast('The sender rules were not saved — the server refused. Nothing changed.')
      return null
    }
  }

  return { createGroup, renameGroup, deleteGroup, setSenderRules }
}
