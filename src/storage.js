const KEY = 'openneutron'

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}')
  } catch {
    return {}
  }
}

function save(obj) {
  localStorage.setItem(KEY, JSON.stringify({ ...load(), ...obj }))
}

export const storage = {
  getToken: () => load().token ?? null,
  getForceReset: () => load().force_reset ?? false,
  getUsername: () => load().username ?? null,
  getIsAdmin: () => load().is_admin ?? false,
  // The last deletion-log head this browser saw, so a shorter history is noticed.
  getDeletionLogPin: () => load().deletion_log_seen ?? null,
  getEncryptedKey: () => load().encrypted_key ?? null,
  getPublicKey: () => load().public_key ?? null,
  set: (obj) => save(obj),

  // Public KDF salt from the last login. Not a secret; needed to re-derive the
  // key-wrapping password after the tab (and sessionStorage) is gone.
  getLoginSalt: () => load().login_salt ?? null,
  setLoginSalt: (salt) => save({ login_salt: salt }),

  getEmailMeta: () => load().email_meta ?? {},
  setEmailMeta: (uid, patch) => {
    const meta = load().email_meta ?? {}
    meta[uid] = { ...meta[uid], ...patch }
    save({ email_meta: meta })
  },
  // One write for a whole mailbox hydration instead of one per message.
  saveEmailMeta: (meta) => save({ email_meta: meta }),

  getGroups: () => load().groups ?? [],
  saveGroups: (groups) => save({ groups }),

  getSentUids: () => load().sent_uids ?? [],
  addSentUid: (uid) => {
    const uids = load().sent_uids ?? []
    if (!uids.includes(String(uid))) save({ sent_uids: [String(uid), ...uids] })
  },
  setSentUids: (uids) => save({ sent_uids: uids }),

  clear: () => {
    const { encrypted_key, public_key, username } = load()
    localStorage.removeItem(KEY)
    if (encrypted_key || public_key) save({ encrypted_key, public_key, username })
  },
  fullClear: () => localStorage.removeItem(KEY),

  getDrafts: () => load().drafts ?? [],
  saveDraft: (draft) => {
    const drafts = load().drafts ?? []
    const idx = drafts.findIndex((d) => d.id === draft.id)
    if (idx >= 0) drafts[idx] = draft
    else drafts.unshift(draft)
    save({ drafts })
  },
  deleteDraft: (id) => {
    const drafts = (load().drafts ?? []).filter((d) => d.id !== id)
    save({ drafts })
  },
  /**
   * A held message can only be edited from the device that composed it: the server
   * stores the sealed request and cannot give the plaintext back, so the copy kept
   * here is what makes "edit" possible at all. It is the same local draft store the
   * composer already uses, tagged with the scheduled id.
   */
  saveScheduledDraft: (scheduledId, sendAt, draft) => {
    const drafts = load().drafts ?? []
    const id = `sched_${scheduledId}`
    const entry = { ...draft, id, scheduledId, sendAt }
    const idx = drafts.findIndex((d) => d.id === id)
    if (idx >= 0) drafts[idx] = entry
    else drafts.unshift(entry)
    save({ drafts })
  },
  getScheduledDraft: (scheduledId) => {
    return (load().drafts ?? []).find((d) => d.scheduledId === scheduledId) ?? null
  },
  pruneScheduledDrafts: (liveIds) => {
    const drafts = load().drafts ?? []
    const kept = drafts.filter((d) => !d.scheduledId || liveIds.has(d.scheduledId))
    if (kept.length !== drafts.length) save({ drafts: kept })
    return kept
  },
}
