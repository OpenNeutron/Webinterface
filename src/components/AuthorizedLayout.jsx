import { useState, useCallback, useEffect, useMemo, Suspense, lazy } from 'react'
import { useNavigate } from 'react-router-dom'
import { Inbox, PenLine, X } from 'lucide-react'
import Sidebar from '@/components/Sidebar'
import EmailList from '@/components/EmailList'
import ScheduledPanel from '@/components/ScheduledPanel'
import EmailView from '@/components/EmailView'
import { ConfirmModal, InputModal } from '@/components/ui/Modal'
import { TopBar } from '@/components/TopBar'
import SetupStrip from '@/components/SetupStrip'
import { fetchPostQuantumStatus } from '@/lib/pqSetup'
import { hasIdentity } from '@/lib/pgpRing'
import { UnlockModal } from '@/components/UnlockModal'
import { EmailToolbar } from '@/components/EmailToolbar'
import { useEmailFetch } from '@/hooks/useEmailFetch'
import { useSentEmails } from '@/hooks/useSentEmails'
import { useTrash } from '@/hooks/useTrash'
import { listShortcut, neighbourAfterRemoval, stepThrough } from '@/lib/mailNav'
import { useEmailActions } from '@/hooks/useEmailActions'
import { useGroupActions } from '@/hooks/useGroupActions'
import { keySession } from '@/keySession'
import { mergeServerFlags } from '@/lib/mailboxState'
import { storage } from '@/storage'
import { buildQuotedBody } from '@/emailParser'
import api, { userRecoveryKeyStatus } from '@/api'
import useSearchShortcut from '@/hooks/useSearchShortcut'

// The editor (Tiptap) and the sending code load when a message is first written.
const ComposeWindow = lazy(() => import('@/components/ComposeWindow'))
const PAGE_SIZE = 20

const AuthorizedLayout = () => {
  const [selectedUid, setSelectedUid] = useState(null)
  const [navOpen, setNavOpen] = useState(false)
  const [selectedFolder, setSelectedFolder] = useState('inbox')
  useSearchShortcut()
  const [searchQuery, setSearchQuery] = useState('')
  const [filterMode, setFilterMode] = useState('all')
  const [page, setPage] = useState(0)
  const [emailMeta, setEmailMeta] = useState(() => storage.getEmailMeta())
  const [groups, setGroups] = useState([])
  const [checkedUids, setCheckedUids] = useState(new Set())
  const [modalState, setModalState] = useState({ type: null })
  const [composeOpen, setComposeOpen] = useState(false)
  const [replyData, setReplyData] = useState(null)
  const [composeDraftId, setComposeDraftId] = useState(null)
  // Set when the composer was opened from a held message, so sending it edits that
  // message instead of queueing a second one.
  const [composeReplaceId, setComposeReplaceId] = useState(null)
  // Bumped whenever a held message changes, so the panel does not wait a minute
  // to show the edit the sender just made.
  const [scheduledVersion, setScheduledVersion] = useState(0)
  const [drafts, setDrafts] = useState(() => storage.getDrafts())
  const navigate = useNavigate()
  const [userEmail, setUserEmail] = useState('')
  const [isAdmin, setIsAdmin] = useState(() => storage.getIsAdmin())
  const [setupDismissed, setSetupDismissed] = useState(false)
  // null = unknown (not fetched yet), false = no recovery key on file.
  const [recoveryKeySet, setRecoveryKeySet] = useState(null)
  const [recoveryPromptDismissed, setRecoveryPromptDismissed] = useState(false)

  useEffect(() => {
    let cancelled = false
    userRecoveryKeyStatus()
      .then((data) => { if (!cancelled) setRecoveryKeySet(!!data.set) })
      .catch(() => { if (!cancelled) setRecoveryKeySet(null) })
    return () => { cancelled = true }
  }, [])
  const [hasOwnKey, setHasOwnKey] = useState(true)
  // null = not known yet. An unanswered request must not be drawn as a gap.
  const [pqEnabled, setPqEnabled] = useState(null)

  // Every incomplete security step, gathered so one strip can carry them all.
  const setupGaps = []
  if (recoveryKeySet === false) {
    setupGaps.push({
      id: 'recovery',
      label: 'Recovery key',
      href: '/settings#recovery',
      note: 'Without one, a forgotten password means your encrypted mail cannot be read again — the reset link cannot open it either.',
    })
  }
  if (!hasOwnKey) {
    setupGaps.push({
      id: 'openpgp',
      label: 'OpenPGP key',
      note: 'Mail between mailboxes here is already encrypted with your account key. An OpenPGP key is what lets you exchange encrypted mail with people on other providers.',
      href: '/settings#keys',
    })
  }
  if (pqEnabled === false) {
    setupGaps.push({
      id: 'post-quantum',
      label: 'Post-quantum protection',
      note: 'Mail is sealed with RSA alone, and RSA is the part a quantum computer breaks. Turning it on adds a quantum-resistant half to every new message.',
      href: '/settings#post-quantum',
    })
  }
  const dismissSetup = () => setSetupDismissed(true)
  const [needsUnlock, setNeedsUnlock] = useState(false)
  const [serverStatus, setServerStatus] = useState('checking')

  const { uids, setUids, previews, setPreviews, loading, hasMore, fetchEmails, loadMore, fetchPreviewsFor } = useEmailFetch()
  const { sentUids, setSentUids, fetchSentUids, fetchSentPreviews } = useSentEmails(setPreviews)
  // After a restore (Undo, or from Trash) the folders are read again: the server knows where
  // each message goes back to, in its order.
  const reloadFolders = useCallback(async () => {
    await fetchEmails(0)
    const sent = await fetchSentUids()
    if (sent.length) await fetchSentPreviews(sent)
  }, [fetchEmails, fetchSentUids, fetchSentPreviews])
  const trash = useTrash({ fetchPreviewsFor, fetchSentPreviews, setPreviews, onRestored: reloadFolders })
  const { markRead, markUnread, toggleStar, deleteEmail, deleteMany, undoLast, moveToGroup, removeFromGroup } = useEmailActions({
    emailMeta, setEmailMeta, setUids, setPreviews, setSelectedUid, setGroups, groups, setSentUids,
    onTrashed: trash.addTrashed,
    onRestored: async (back) => {
      if (back.length) trash.fetchTrash()
      await reloadFolders()
    },
  })
  const { createGroup, renameGroup, deleteGroup } = useGroupActions({ setGroups, setSelectedFolder, setModalState })

  useEffect(() => {
    let alive = true
    fetchPostQuantumStatus()
      .then((s) => { if (alive && !s?.unavailable) setPqEnabled(!!s?.enabled) })
      .catch(() => { /* unknown stays unknown; no gap is invented */ })
    return () => { alive = false }
  }, [])

  const checkServer = useCallback(async () => {
    try {
      const token = storage.getToken()
      const res = await api.get('/user/me', { headers: { Authorization: `Bearer ${token}` } })
      const user = res.data
      if (user) {
        setUserEmail(user.email ?? user.username ?? '')
        const admin = user.is_admin ?? false
        setIsAdmin(admin)
        storage.set({ is_admin: admin })
      }
      setServerStatus('ok')
    } catch {
      setServerStatus('unreachable')
    }
  }, [])

  const fetchGroups = useCallback(async () => {
    try {
      const token = storage.getToken()
      const res = await api.get('/group/list', { headers: { Authorization: `Bearer ${token}` } })
      setGroups(res.data.groups ?? [])
    } catch {}
  }, [])

  const handleRefresh = useCallback(() => {
    fetchEmails(0)
  }, [fetchEmails])

  useEffect(() => {
    checkServer()
    fetchEmails(0)
    fetchGroups()
    // The private key lives only in the session; a reload drops it, and without
    // it every message renders as undecryptable. Ask once, up front.
    keySession.get().then((k) => { if (!k) setNeedsUnlock(true) })

    // Adopt the server's read/starred state so this browser agrees with every
    // other one. Until this lands, meta is treated as a cache, not the truth.
    api.post('/email/flags', {}, { headers: { Authorization: `Bearer ${storage.getToken()}` } })
      .then((res) => {
        const flags = res.data?.flags ?? []
        if (!flags.length) return
        setEmailMeta((prev) => {
          const merged = mergeServerFlags(prev, flags)
          storage.saveEmailMeta(merged)
          return merged
        })
      })
      .catch(() => {})
    const serverPollId = setInterval(() => checkServer(), 30000)
    return () => {
      clearInterval(serverPollId)
    }
  }, [])

  useEffect(() => {
    try {
      setHasOwnKey(hasIdentity())
    } catch {
      setHasOwnKey(true)
    }
  }, [])

  const visibleUids = (() => {
    if (selectedFolder === 'inbox') return uids
    if (selectedFolder === 'starred') return uids.filter((uid) => emailMeta[uid]?.starred)
    if (selectedFolder === 'sent') return sentUids
    if (selectedFolder === 'drafts') return drafts.map((d) => d.id)
    if (selectedFolder === 'trash') return trash.items.map((item) => item.uid)
    const group = groups.find((g) => g.uid === selectedFolder)
    if (group) return group.email_uids.filter((uid) => uids.includes(uid) || sentUids.includes(uid))
    return uids
  })()

  const draftPreviews = useMemo(() => {
    const map = {}
    for (const d of drafts) {
      map[d.id] = {
        subject:  d.subject || '(no subject)',
        from:     { email: '', name: d.to?.[0] ? `To: ${d.to[0]}` : '(no recipients)' },
        date:     d.updatedAt ? new Date(d.updatedAt) : null,
        preview:  d.body?.slice(0, 100) ?? '',
        isDraft:  true,
      }
    }
    return map
  }, [drafts])

  const allPreviews = selectedFolder === 'drafts' ? draftPreviews : previews

  const filteredUids = useMemo(() => {
    if (selectedFolder === 'drafts') return visibleUids
    let result = visibleUids
    if (filterMode === 'unread') result = result.filter((uid) => emailMeta[uid]?.unread !== false)
    else if (filterMode === 'read') result = result.filter((uid) => emailMeta[uid]?.unread === false)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter((uid) => {
        const p = previews[uid]
        if (!p) return false
        return (
          p.subject?.toLowerCase().includes(q) ||
          p.from?.name?.toLowerCase().includes(q) ||
          p.from?.email?.toLowerCase().includes(q)
        )
      })
    }
    return result
  }, [visibleUids, filterMode, searchQuery, emailMeta, previews, selectedFolder])

  const totalFiltered = filteredUids.length
  // The bar's badge counts what the inbox holds, not whatever list happens to be open.
  const inboxUnread = useMemo(
    () => (selectedFolder === 'inbox' ? uids.filter((uid) => emailMeta[uid]?.unread !== false).length : 0),
    [uids, emailMeta, selectedFolder],
  )
  const pageCount = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pageStart = totalFiltered === 0 ? 0 : safePage * PAGE_SIZE + 1
  const pageEnd = Math.min((safePage + 1) * PAGE_SIZE, totalFiltered)
  const pagedUids = filteredUids.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)

  useEffect(() => { setPage(0) }, [selectedFolder, filterMode, searchQuery])

  const { fetchTrash } = trash
  useEffect(() => {
    if (selectedFolder === 'trash') fetchTrash()
  }, [selectedFolder, fetchTrash])

  useEffect(() => {
    if (selectedFolder === 'sent') {
      fetchSentUids().then((uids) => {
        const missing = uids.filter((uid) => !previews[uid])
        if (missing.length > 0) fetchSentPreviews(missing)
      })
    }
  }, [selectedFolder])

  const folderLabel = (() => {
    if (selectedFolder === 'inbox') return 'Inbox'
    if (selectedFolder === 'starred') return 'Starred'
    if (selectedFolder === 'sent') return 'Sent'
    if (selectedFolder === 'drafts') return 'Drafts'
    if (selectedFolder === 'trash') return 'Trash'
    return groups.find((g) => g.uid === selectedFolder)?.title ?? 'Inbox'
  })()

  const handleSelect = (uid) => {
    if (String(uid).startsWith('draft_')) {
      const draft = drafts.find((d) => d.id === uid)
      if (draft) {
        setReplyData({ to: draft.to ?? [], cc: draft.cc ?? [], bcc: draft.bcc ?? [], subject: draft.subject ?? '', body: draft.body ?? '' })
        setComposeDraftId(draft.id)
        setComposeOpen(true)
      }
      return
    }
    setSelectedUid(uid)
    markRead(uid)
  }

  const handleLogout = () => {
    keySession.clear()
    storage.clear()
    console.log('[Logout] localStorage after clear:', JSON.stringify(JSON.parse(localStorage.getItem('openneutron') || '{}')))
    window.location.reload()
  }

  const handleCheck = (uid) => {
    setCheckedUids(prev => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }

  const handleToggleSelectAll = () => {
    // Page-scoped, and it does not throw away a selection made on another page: the control says
    // "select all N on this page", so it must mean exactly that.
    setCheckedUids(prev => {
      const next = new Set(prev)
      const allOnPage = pagedUids.length > 0 && pagedUids.every(uid => next.has(uid))
      for (const uid of pagedUids) {
        if (allOnPage) next.delete(uid)
        else next.add(uid)
      }
      return next
    })
  }

  // After the open message is deleted, the next one opens — on a screen wide enough to show
  // the list and the message side by side. On a phone the reader is the whole screen, and
  // going back to the list is what people expect there.
  // The rows in the order they are shown (EmailList reports it); the server's order is not it.
  const [displayOrder, setDisplayOrder] = useState([])
  // Same rows, same array: the list re-reports on every render, and a new array each time
  // would render the page again, forever.
  const handleOrder = useCallback((order) => {
    setDisplayOrder((prev) => (prev.length === order.length && prev.every((uid, i) => uid === order[i]) ? prev : order))
  }, [])
  const listOrder = useMemo(() => {
    const visible = new Set(pagedUids.map(String))
    const shown = displayOrder.filter((uid) => visible.has(String(uid)))
    return shown.length ? shown : pagedUids
  }, [displayOrder, pagedUids])

  const openNeighbour = (removed) => {
    if (!selectedUid || !removed.map(String).includes(String(selectedUid))) return
    const wide = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches
    const next = wide ? neighbourAfterRemoval(listOrder, removed) : null
    setSelectedUid(next)
  }

  /** Several at once: to Trash (with one Undo), or in Trash, delete for good after asking. */
  const deleteUids = async (list) => {
    if (!list.length) return
    if (selectedFolder === 'trash') {
      setModalState({ type: 'delete-forever', uids: list })
      return
    }
    const { gone, failed } = await deleteMany(list)
    openNeighbour(gone)
    return failed
  }

  // Delete moves to Trash with an Undo, so it no longer asks first. Only in Trash is a delete
  // permanent, and only there does it ask.
  const deleteSelected = async () => {
    const toDelete = [...checkedUids]
    setModalState({ type: null })
    // A delete the server refuses must not vanish from the screen; what did not move stays checked.
    const failed = await deleteUids(toDelete)
    if (failed) setCheckedUids(new Set(failed))
  }

  const restoreSelected = async () => {
    const { failed } = await trash.restore([...checkedUids])
    setCheckedUids(new Set(failed))
  }

  const deleteOne = async (uid) => {
    if (String(uid).startsWith('draft_')) return handleDeleteDraft(uid)
    if (selectedFolder === 'trash') return setModalState({ type: 'delete-forever', uids: [uid] })
    const next = neighbourAfterRemoval(listOrder, [uid])
    const wasOpen = String(selectedUid) === String(uid)
    if (await deleteEmail(uid) && wasOpen) {
      const wide = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches
      setSelectedUid(wide ? next : null)
    }
  }

  // The list's keyboard: Delete or # deletes what is checked, or else the open message;
  // Z takes back the last delete; J and K move through the list. Nothing fires while a box
  // is open, while composing, or while typing.
  useEffect(() => {
    const onKey = (event) => {
      if (composeOpen || modalState.type || needsUnlock) return
      const action = listShortcut(event, document.activeElement)
      if (!action) return
      if (action === 'undo') {
        if (selectedFolder === 'trash') return
        event.preventDefault()
        undoLast()
        return
      }
      if (action === 'next' || action === 'prev') {
        const next = stepThrough(listOrder, selectedUid, action === 'next' ? 1 : -1)
        if (next == null) return
        event.preventDefault()
        handleSelect(next)
        return
      }
      if (action === 'delete' && selectedFolder !== 'drafts') {
        if (checkedUids.size) {
          event.preventDefault()
          deleteSelected()
        } else if (selectedUid) {
          event.preventDefault()
          deleteOne(selectedUid)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const markSelectedRead = () => {
    checkedUids.forEach(uid => markRead(uid))
    setCheckedUids(new Set())
  }

  const markSelectedUnread = () => {
    checkedUids.forEach(uid => markUnread(uid))
    setCheckedUids(new Set())
  }

  const moveSelectedToGroup = (groupId) => {
    checkedUids.forEach(uid => moveToGroup(uid, groupId))
    setCheckedUids(new Set())
  }

  const handleRemoveFromGroup = useCallback((uid) => removeFromGroup(uid, selectedFolder), [removeFromGroup, selectedFolder])

  const handleSent = useCallback((newUid) => {
    if (!newUid) return
    const uid = String(newUid)
    setSentUids((prev) => (prev.includes(uid) ? prev : [uid, ...prev]))
    fetchSentPreviews([uid])
  }, [fetchSentPreviews])

  const handleComposeClose = useCallback((savedDraft) => {
    if (savedDraft) {
      storage.saveDraft(savedDraft)
      setDrafts(storage.getDrafts())
    }
    setComposeOpen(false)
    setReplyData(null)
    setComposeDraftId(null)
    setComposeReplaceId(null)
  }, [])

  const handleScheduled = useCallback(({ id, sendAt, draft }) => {
    if (!id || !draft) return
    storage.saveScheduledDraft(id, sendAt, draft)
    setDrafts(storage.getDrafts())
    setScheduledVersion((n) => n + 1)
  }, [])

  const handleEditScheduled = useCallback((item) => {
    const draft = storage.getScheduledDraft(item.id)
    if (!draft) {
      // Only reachable from another device: the copy that could be edited lives
      // on the one that composed it.
      return
    }
    setReplyData({
      to: draft.to ?? [], cc: draft.cc ?? [], bcc: draft.bcc ?? [],
      subject: draft.subject ?? '', body: draft.body ?? '',
      // Opens on the time it is already held for, so the button says "Update"
      // instead of offering to send a second copy now.
      sendAt: item.send_at ?? draft.sendAt ?? null,
    })
    setComposeDraftId(draft.id)
    setComposeReplaceId(item.id)
    setComposeOpen(true)
  }, [])

  const handleCancelledScheduled = useCallback((id) => {
    storage.deleteDraft(`sched_${id}`)
    setDrafts(storage.getDrafts())
  }, [])

  const handleScheduledItems = useCallback((items) => {
    const live = new Set(items.filter((i) => i.status === 'pending').map((i) => i.id))
    const next = storage.pruneScheduledDrafts(live)
    setDrafts(next)
  }, [])

  const handleDeleteDraft = useCallback((draftId) => {
    storage.deleteDraft(draftId)
    setDrafts(storage.getDrafts())
  }, [])

  const handleComposeTo = useCallback((emailAddr) => {
    setReplyData({ to: [emailAddr], subject: '', body: '' })
    setComposeDraftId(null)
    setComposeOpen(true)
  }, [])

  // Everyone the message already went to who is not me: the sender, the other To's,
  // and the Cc list. Reply-all without them is a reply that quietly drops people.
  const handleReplyAll = useCallback((email) => {
    const addr = (a) => (a?.email ?? '').toLowerCase()
    const me = String(userEmail ?? '').toLowerCase()
    // The account identity in this app can be a bare username while the header carries
    // name@domain, so compare local parts too — otherwise you reply-all to yourself.
    const meLocal = me.split('@')[0]
    const isMe = (e) => e === me || (meLocal && e.split('@')[0] === meLocal)
    const seen = new Set()
    if (me) seen.add(me)
    const out = []
    for (const a of [...(email.replyTo ?? []), email.from, ...(email.to ?? []), ...(email.cc ?? [])]) {
      const e = addr(a)
      if (!e || isMe(e) || seen.has(e)) continue
      seen.add(e)
      out.push(a.email)
    }
    const subj = /^Re:/i.test(email.subject ?? '') ? email.subject : `Re: ${email.subject ?? ''}`
    setReplyData({
      to: out,
      subject: subj,
      body: `\n\n${buildQuotedBody(email)}`,
      inReplyTo: email.messageId ?? '',
      references: email.messageId ?? '',
      fromAlias: email.alias ?? '',
    })
    setComposeOpen(true)
  }, [userEmail])

  // Forward is the same quoted body with no threading: it is a new conversation, and
  // pretending otherwise would file the reply under the original.
  const handleForward = useCallback((email) => {
    const subj = /^Fwd:/i.test(email.subject ?? '') ? email.subject : `Fwd: ${email.subject ?? ''}`
    setReplyData({
      to: [],
      subject: subj,
      body: `\n\n${buildQuotedBody(email)}`,
      inReplyTo: '',
      references: '',
      fromAlias: email.alias ?? '',
    })
    setComposeOpen(true)
  }, [])

  const handleReply = useCallback((email) => {
    const sender = email.replyTo?.[0] ?? email.from
    const replyAddr = sender?.email ?? ''
    const subj = /^Re:/i.test(email.subject ?? '') ? email.subject : `Re: ${email.subject ?? ''}`
    setReplyData({
      to:        replyAddr ? [replyAddr] : [],
      subject:   subj,
      body:      `\n\n${buildQuotedBody(email)}`,
      inReplyTo: email.messageId ?? '',
      references: email.messageId ?? '',
      // Answer from the address they wrote to, not from the real one.
      fromAlias: email.alias ?? '',
    })
    setComposeOpen(true)
  }, [])

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <div className="flex flex-1 overflow-hidden">
        <div className="hidden md:block w-64 shrink-0">
          <Sidebar
            selectedFolder={selectedFolder}
            onSelectFolder={setSelectedFolder}
            groups={groups}
            onRequestCreateGroup={() => setModalState({ type: 'create-group' })}
            onRequestRenameGroup={(id, name) => setModalState({ type: 'rename-group', id, name })}
            onRequestDeleteGroup={(id, name) => setModalState({ type: 'delete-group', id, name })}
            emailMeta={emailMeta}
            uids={uids}
            sentCount={sentUids.length}
            draftsCount={drafts.length}
            trashCount={trash.items.length}
            onCompose={() => setComposeOpen(true)}
            onOpenSettings={() => navigate('/settings')}
          />
        </div>
        {/* Mobile folder drawer */}
        {navOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            <div
              className="absolute inset-0 bg-black/60"
              onClick={() => setNavOpen(false)}
            />
            <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-border bg-background shadow-2xl">
              {/* A drawer whose only exit is a tap on a dimmed strip or the system
                  back gesture strands anyone who does not know that gesture exists. */}
              <button
                type="button"
                onClick={() => setNavOpen(false)}
                aria-label="Close folders"
                className="absolute right-1.5 top-1.5 z-10 flex size-11 items-center justify-center rounded-md text-ink-3 transition-colors duration-120 hover:bg-accent hover:text-ink-1"
              >
                <X className="size-5" />
              </button>
              <Sidebar
                selectedFolder={selectedFolder}
                onSelectFolder={(folder) => { setSelectedFolder(folder); setNavOpen(false) }}
                groups={groups}
                onRequestCreateGroup={() => { setNavOpen(false); setModalState({ type: 'create-group' }) }}
                onRequestRenameGroup={(id, name) => { setNavOpen(false); setModalState({ type: 'rename-group', id, name }) }}
                onRequestDeleteGroup={(id, name) => { setNavOpen(false); setModalState({ type: 'delete-group', id, name }) }}
                emailMeta={emailMeta}
                uids={uids}
                sentCount={sentUids.length}
                draftsCount={drafts.length}
                trashCount={trash.items.length}
                onCompose={() => { setNavOpen(false); setComposeOpen(true) }}
                onOpenSettings={() => { setNavOpen(false); navigate('/settings') }}
              />
            </div>
          </div>
        )}
        <div className="flex-1 flex flex-col min-w-0">
          <TopBar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            userEmail={userEmail}
            isAdmin={isAdmin}
            serverStatus={serverStatus}
            onLogout={handleLogout}
            onRetryServer={checkServer}
            
            onOpenNav={() => setNavOpen(true)}
            
          />
          <SetupStrip
            items={setupDismissed ? [] : setupGaps}
            onOpen={(href) => navigate(href || '/settings')}
            onDismiss={dismissSetup}
          />
          <div
            /* The phone bar is fixed to the bottom edge; reserve its height here so the
               list ends above it instead of being clipped mid-row behind it. */
            className="flex-1 flex min-h-0 max-sm:pb-[72px]"
          >
            {/* With nothing open the list takes the whole width. An empty reading
                pane on a resting screen is half the app showing nothing. */}
            <div
              className={`flex w-full flex-col overflow-hidden ${
                selectedUid ? 'md:w-[400px] md:shrink-0 md:border-r md:border-line' : ''
              }`}
            >
              {selectedFolder !== 'drafts' && (
              <EmailToolbar
                pagedUids={pagedUids}
                checkedUids={checkedUids}
                totalFiltered={totalFiltered}
                pageStart={pageStart}
                pageEnd={pageEnd}
                safePage={safePage}
                pageCount={pageCount}
                hasMore={selectedFolder === 'inbox' && hasMore}
                groups={groups}
                filterMode={filterMode}
                onFilterModeChange={(m) => { setFilterMode(m); setPage(0) }}
                onToggleSelectAll={handleToggleSelectAll}
                allChecked={pagedUids.length > 0 && pagedUids.every(uid => checkedUids.has(uid))}
                onDeleteSelected={deleteSelected}
                onRestoreSelected={selectedFolder === 'trash' ? restoreSelected : null}
                onMarkSelectedRead={markSelectedRead}
                onMarkSelectedUnread={markSelectedUnread}
                onMoveSelectedToGroup={moveSelectedToGroup}
                onPrevPage={() => setPage(p => Math.max(0, p - 1))}
                onNextPage={() => {
                  const next = safePage + 1
                  setPage(next)
                  if (next >= pageCount - 1 && hasMore) loadMore()
                }}
                onRefresh={handleRefresh}
                refreshing={loading}
              />
              )}
              {selectedFolder === 'trash' && (
                <div className="border-b border-line">
                  <div className="mx-auto flex w-full max-w-[1040px] items-center gap-3 px-4 py-2 text-[12px] text-ink-2">
                    <span className="min-w-0 flex-1">
                      {trash.available
                        ? `Deleted mail waits here for ${trash.retentionDays} days, then it is deleted for good. Restore puts it back where it was.`
                        : 'Trash needs the latest mail server. Until it is updated, nothing can be moved here.'}
                    </span>
                    {trash.available && trash.items.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setModalState({ type: 'empty-trash' })}
                        className="shrink-0 rounded-md px-2 py-1 font-medium text-destructive transition-colors duration-120 hover:bg-destructive/10 max-sm:min-h-11"
                      >
                        Empty trash
                      </button>
                    )}
                  </div>
                </div>
              )}
              {selectedFolder === 'sent' && (
                <ScheduledPanel
                  editableIds={new Set(drafts.filter((d) => d.scheduledId).map((d) => d.scheduledId))}
                  onEdit={handleEditScheduled}
                  onCancelled={handleCancelledScheduled}
                  onItems={handleScheduledItems}
                  version={scheduledVersion}
                />
              )}
              <EmailList
                searchQuery={searchQuery}
                filterMode={filterMode}
                uids={pagedUids}
                previews={allPreviews}
                emailMeta={emailMeta}
                selectedUid={selectedUid}
                checkedUids={checkedUids}
                onSelect={handleSelect}
                onCheck={handleCheck}
                loading={loading}
                hasMore={selectedFolder === 'inbox' && hasMore}
                onLoadMore={loadMore}
                onMarkRead={markRead}
                onMarkUnread={markUnread}
                onToggleStar={toggleStar}
                onDeleteEmail={deleteOne}
                onDeleteThread={deleteUids}
                onOrder={handleOrder}
                onMoveToGroup={moveToGroup}
                onRemoveFromGroup={handleRemoveFromGroup}
                groups={groups}
                folderLabel={folderLabel}
                selectedFolder={selectedFolder}
              />
            </div>
            {selectedUid && (
            <div className="fixed inset-0 z-40 flex min-w-0 flex-1 flex-col bg-background md:static md:z-auto md:block">
              {/* On a phone the back control lives in the reader's own action bar: two
                  stacked bars cost 100px of a 700px screen, and the message is the point. */}
              <button
                onClick={() => setSelectedUid(null)}
                  className="hidden min-h-11 items-center gap-1.5 px-3 py-2 border-b border-border text-sm text-foreground/70"
                >
                <span aria-hidden="true">←</span> Back to inbox
              </button>
              <EmailView
                key={selectedUid}
                uid={selectedUid}
                onBack={() => setSelectedUid(null)}
                myEmail={userEmail}
                emailMeta={selectedUid ? (emailMeta[selectedUid] ?? {}) : null}
                arrivedAt={selectedUid ? (previews[selectedUid]?.alias ?? null) : null}
                onToggleStar={toggleStar}
                onMarkRead={markRead}
                onMarkUnread={markUnread}
                onDeleteEmail={deleteOne}
                onRestore={selectedFolder === 'trash' ? (uid) => trash.restore([uid]).then(() => setSelectedUid(null)) : null}
                onMessageDeleted={(uid) => {
                  // The server already deleted it, so drop the row without asking
                  // the delete endpoint again. The open message stays on screen:
                  // it is the last time it can be read.
                  setUids((prev) => prev.filter((u) => u !== uid))
                  setPreviews((prev) => {
                    const next = { ...prev }
                    delete next[uid]
                    return next
                  })
                }}
                onMoveToGroup={moveToGroup}
                onRemoveFromGroup={handleRemoveFromGroup}
                groups={groups}
                selectedFolder={selectedFolder}
                onReply={handleReply}
                onReplyAll={handleReplyAll}
                onForward={handleForward}
                onComposeTo={handleComposeTo}
              />
            </div>
            )}
          </div>
        </div>
      </div>

      {/* A phone gets a bar, not a floating button: the action that defines the app on
          the right, and the drawer's only other job — switching folder — on the left,
          where a thumb can reach it. Hidden while composing or reading, because both
          take the bottom of the screen for themselves. */}
      {!composeOpen && !selectedUid && (
        <nav
          aria-label="Mail actions"
          data-testid="phone-bar"
          className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-3 border-t border-line bg-card/95 px-4 backdrop-blur sm:hidden"
          style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))', paddingTop: '0.5rem' }}
        >
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label={inboxUnread ? `Folders and mailboxes, ${inboxUnread} unread in the inbox` : 'Folders and mailboxes'}
            className="flex min-h-11 items-center gap-2 rounded-lg px-2 text-[13px] text-ink-2 transition-colors duration-120 active:bg-accent"
          >
            <Inbox className="size-4.5" />
            <span>Folders</span>
            {/* No badge here. A bare number beside "Folders" reads as a folder count, and
                the toolbar above already says "6 messages" — two numbers meaning different
                things, next to each other, is worse than one. */}
            {inboxUnread > 0 && <span className="sr-only">{inboxUnread} unread</span>}
          </button>
          <button
            type="button"
            onClick={() => setComposeOpen(true)}
            aria-label="New message"
            data-testid="compose-fab"
            className="flex min-h-11 items-center gap-2 rounded-full bg-primary px-4 text-[13.5px] font-semibold text-primary-foreground transition-transform duration-120 active:scale-[0.98]"
          >
            <PenLine className="size-4" strokeWidth={2.4} />
            <span>New mail</span>
          </button>
        </nav>
      )}

      <InputModal
        isOpen={modalState.type === 'create-group'}
        onClose={() => setModalState({ type: null })}
        title="Create New Group"
        label="Group Name"
        placeholder="e.g. Work, Family"
        onConfirm={createGroup}
      />
      <InputModal
        isOpen={modalState.type === 'rename-group'}
        onClose={() => setModalState({ type: null })}
        title="Rename Group"
        label="New Group Name"
        initialValue={modalState.name}
        onConfirm={(name) => renameGroup(modalState.id, name)}
      />
      <ConfirmModal
        isOpen={modalState.type === 'delete-forever'}
        onClose={() => setModalState({ type: null })}
        title="Delete for good"
        description={`Delete ${modalState.uids?.length === 1 ? 'this message' : `${modalState.uids?.length ?? 0} messages`} for good? This cannot be undone.`}
        confirmText={modalState.uids?.length === 1 ? 'Delete for good' : `Delete ${modalState.uids?.length ?? 0} for good`}
        onConfirm={async () => {
          const list = modalState.uids ?? []
          setModalState({ type: null })
          const { gone, failed } = await trash.deleteForever(list)
          setCheckedUids(new Set(failed))
          openNeighbour(gone)
        }}
      />
      <ConfirmModal
        isOpen={modalState.type === 'empty-trash'}
        onClose={() => setModalState({ type: null })}
        title="Empty trash"
        description={`Delete all ${trash.items.length} message${trash.items.length !== 1 ? 's' : ''} in Trash for good? This cannot be undone.`}
        confirmText="Empty trash"
        onConfirm={async () => {
          setModalState({ type: null })
          await trash.empty()
          setSelectedUid(null)
          setCheckedUids(new Set())
        }}
      />
      <ConfirmModal
        isOpen={modalState.type === 'delete-group'}
        onClose={() => setModalState({ type: null })}
        title="Delete Group"
        description={`Are you sure you want to delete the group "${modalState.name}"? This cannot be undone.`}
        confirmText="Delete"
        onConfirm={() => deleteGroup(modalState.id)}
      />

      {composeOpen && (
        <Suspense fallback={null}>
        <ComposeWindow
          myEmail={userEmail}
          onClose={handleComposeClose}
          onSent={handleSent}
          replyData={replyData}
          draftId={composeDraftId}
          onDeleteDraft={handleDeleteDraft}
          onScheduled={handleScheduled}
          replaceId={composeReplaceId}
        />
        </Suspense>
      )}

      <UnlockModal
        isOpen={needsUnlock}
        onUnlocked={() => window.location.reload()}
      />
    </div>
  )
}

export default AuthorizedLayout
