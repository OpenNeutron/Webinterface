import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, RefreshCw, Plus, Trash2, ShieldCheck, Shield, KeyRound, Copy, X,
  Search, Server, HardDrive, Inbox, ExternalLink,
} from 'lucide-react'
import EmptyArt from '@/components/EmptyArt'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmModal, InputModal } from '@/components/ui/Modal'
import {
  adminGetUsers, adminCreateUser, adminDeleteUser, adminSetAdminStatus,
  adminGetWaitlist, adminApproveWaitlist, adminGetPending, adminApprovePending,
  adminDenyPending, adminSetRecoveryAddress, adminSendRecovery,
  adminGetRecipients, adminGetDiskUsage,
} from '@/api'
import { storage } from '@/storage'

/**
 * Admin: four tabs, one shell, the same tokens as the rest of the app.
 *
 * This used to be a single long page of stacked tables — pending accounts,
 * invites, then every user — with no way to answer the question an operator
 * actually has ("why did mail not arrive"). The four questions are now four
 * tabs, and each one loads the data it needs.
 */

const TABS = [
  { id: 'people', label: 'People', icon: Inbox },
  { id: 'access', label: 'Access', icon: ShieldCheck },
  { id: 'deliverability', label: 'Deliverability', icon: Server },
  { id: 'system', label: 'System', icon: HardDrive },
]

const inviteStatus = (status) => {
  if (status === 'pending') return 'waiting for a decision'
  if (status === 'approved') return 'code issued, not used yet'
  if (status === 'used') return 'account created with this code'
  return status
}

const bytes = (n) => {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1 }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

const when = (seconds) => (seconds ? new Date(seconds * 1000).toLocaleString() : 'unknown')

function Panel({ title, note, action, children }) {
  return (
    <section>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="display text-[18px] text-ink-1">{title}</h2>
          {note && <p className="mt-1 max-w-[62ch] text-[12.5px] leading-relaxed text-ink-3">{note}</p>}
        </div>
        {action}
      </div>
      <div className="mt-4 overflow-hidden rounded-xl border border-line bg-card">{children}</div>
    </section>
  )
}

function Empty({ children, art }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      {art && <EmptyArt kind={art} className="h-11 w-[58px] text-ink-4" />}
      <p className={`max-w-[46ch] text-[12.5px] leading-relaxed text-ink-3 ${art ? 'mt-3' : ''}`}>{children}</p>
    </div>
  )
}

function Admin() {
  const navigate = useNavigate()
  const [tab, setTab] = useState('people')
  const [error, setError] = useState('')
  const [modalState, setModalState] = useState({ type: null })

  const [users, setUsers] = useState([])
  const [usersLoading, setUsersLoading] = useState(true)
  const [pending, setPending] = useState([])
  const [pendingLoading, setPendingLoading] = useState(true)
  const [invites, setInvites] = useState([])
  const [invitesLoading, setInvitesLoading] = useState(true)
  const [recipients, setRecipients] = useState(null)
  const [disk, setDisk] = useState(null)

  const [busy, setBusy] = useState('')
  const [copied, setCopied] = useState('')
  const [query, setQuery] = useState('')
  const [recovery, setRecovery] = useState(null)

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true)
    try {
      const data = await adminGetUsers()
      setUsers(data.users ?? [])
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not load accounts')
    } finally {
      setUsersLoading(false)
    }
  }, [])

  const fetchPending = useCallback(async () => {
    setPendingLoading(true)
    try {
      const data = await adminGetPending()
      setPending(data.entries ?? [])
    } catch {
      setPending([])
    } finally {
      setPendingLoading(false)
    }
  }, [])

  const fetchInvites = useCallback(async () => {
    setInvitesLoading(true)
    try {
      const data = await adminGetWaitlist()
      setInvites(data.entries ?? [])
    } catch {
      setInvites([])
    } finally {
      setInvitesLoading(false)
    }
  }, [])

  const fetchDelivery = useCallback(async () => {
    try {
      const [r, d] = await Promise.all([adminGetRecipients(), adminGetDiskUsage()])
      setRecipients(r?.recipients ?? [])
      setDisk(d?.users ?? [])
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not read delivery state')
    }
  }, [])

  useEffect(() => {
    if (!storage.getIsAdmin()) {
      navigate('/')
      return
    }
    fetchUsers()
    fetchPending()
    fetchInvites()
    fetchDelivery()
  }, [fetchUsers, fetchPending, fetchInvites, fetchDelivery, navigate])

  const refresh = (which = tab) => {
    setError('')
    if (which === 'people') fetchUsers()
    if (which === 'access') { fetchPending(); fetchInvites() }
    if (which === 'deliverability' || which === 'system') fetchDelivery()
  }

  // ── decisions ────────────────────────────────────────────────────────────
  const decidePending = async (username, action) => {
    setBusy(username)
    setError('')
    try {
      if (action === 'approve') await adminApprovePending(username)
      else await adminDenyPending(username)
      await Promise.all([fetchPending(), fetchUsers()])
    } catch (err) {
      setError(err?.response?.data?.error || `Could not ${action} that account`)
    } finally {
      setBusy('')
    }
  }

  const approveInvite = async (email) => {
    setBusy(email)
    setError('')
    try {
      await adminApproveWaitlist(email)
      await fetchInvites()
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not approve that request')
    } finally {
      setBusy('')
    }
  }

  const inviteMessage = (entry) => `Your Sloth Lee Mail invite code is: ${entry.code}

Go to https://mail.slothlee.xyz/signup and paste it to create your account. It works once.`

  const copyInvite = async (entry) => {
    try {
      await navigator.clipboard.writeText(inviteMessage(entry))
      setCopied(entry.email)
      setTimeout(() => setCopied(''), 2500)
    } catch {
      setError('Could not copy — select the code and copy it by hand')
    }
  }

  const shareInvite = async (entry) => {
    const text = inviteMessage(entry)
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Sloth Lee Mail invite', text })
        return
      }
      window.location.href =
        `mailto:${encodeURIComponent(entry.email)}?subject=${encodeURIComponent('Your Sloth Lee Mail invite')}&body=${encodeURIComponent(text)}`
    } catch {
      // A cancelled share sheet is not an error worth showing.
    }
  }

  const createUser = async (username) => {
    setModalState({ type: null })
    try {
      await adminCreateUser(username.trim())
      fetchUsers()
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not create that account')
    }
  }

  const deleteUser = async () => {
    const { username } = modalState
    setModalState({ type: null })
    try {
      await adminDeleteUser(username)
      fetchUsers()
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not delete that account')
    }
  }

  const toggleAdmin = async (user) => {
    if (user.username === storage.getUsername()) return
    try {
      await adminSetAdminStatus(user.username, !user.is_admin)
      setUsers((prev) => prev.map((u) => (u.username === user.username ? { ...u, is_admin: !u.is_admin } : u)))
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not change that role')
    }
  }

  // ── recovery (kept from the old page: the only way to help a locked-out user) ──
  const openRecovery = (user) => setRecovery({
    username: user.username, email: user.recovery_email || '', saving: false, sending: false, result: null, error: '', copied: false,
  })

  const saveRecoveryAddress = async () => {
    setRecovery((r) => ({ ...r, saving: true, error: '' }))
    try {
      const data = await adminSetRecoveryAddress(recovery.username, recovery.email.trim())
      setRecovery((r) => ({ ...r, saving: false, email: data.recovery_email || '' }))
      fetchUsers()
    } catch (err) {
      setRecovery((r) => ({ ...r, saving: false, error: err?.response?.data?.error || 'Could not save that address' }))
    }
  }

  const sendRecoveryEmail = async () => {
    setRecovery((r) => ({ ...r, sending: true, error: '', result: null }))
    try {
      const data = await adminSendRecovery(recovery.username)
      setRecovery((r) => ({ ...r, sending: false, result: data }))
    } catch (err) {
      setRecovery((r) => ({ ...r, sending: false, error: err?.response?.data?.error || 'Could not send the recovery email' }))
    }
  }

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return users
    return users.filter((u) => `${u.username} ${u.email ?? ''}`.toLowerCase().includes(q))
  }, [users, query])

  const diskTotals = useMemo(() => {
    const rows = disk ?? []
    return {
      messages: rows.reduce((n, r) => n + (r.email_count ?? 0), 0),
      bytesUsed: rows.reduce((n, r) => n + (r.disk_usage_bytes ?? 0), 0),
      biggest: [...rows].sort((a, b) => (b.disk_usage_bytes ?? 0) - (a.disk_usage_bytes ?? 0)).slice(0, 5),
    }
  }, [disk])

  const aliasCount = recipients ? Math.max(0, recipients.length - users.length) : 0

  const cell = 'px-4 py-3 text-[12.5px]'

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-background/90 backdrop-blur-sm">
        <div className="mx-auto flex h-14 w-full max-w-[1080px] items-center gap-3 px-4">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12.5px] text-ink-2 transition-colors duration-120 hover:bg-accent hover:text-ink-1"
          >
            <ArrowLeft className="size-3.5" /> Mail
          </button>
          <span className="display text-[16px] text-ink-1">Admin</span>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => refresh()}
              className="rounded-md p-2 text-ink-3 transition-colors duration-120 hover:bg-accent hover:text-ink-1"
              aria-label="Refresh"
              title="Refresh"
            >
              <RefreshCw className="size-4" />
            </button>
            <Button size="sm" className="gap-1.5" onClick={() => setModalState({ type: 'create' })}>
              <Plus className="size-3.5" /> New mailbox
            </Button>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-[1080px]">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-background to-transparent sm:hidden"
          />
          <div className="flex w-full gap-1 overflow-x-auto pl-4 pr-10 pb-2 sm:px-4 [scrollbar-width:none]">
          {TABS.map(({ id, label, icon: Icon }) => {
            const count = id === 'people' ? users.length : id === 'access' ? pending.length : 0
            const active = tab === id
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] transition-colors duration-120 ${
                  active ? 'bg-secondary font-medium text-ink-1' : 'text-ink-3 hover:bg-accent hover:text-ink-1'
                }`}
              >
                <Icon className="size-3.5" />
                {label}
                {count > 0 && <span className="mono text-[11px] text-ink-3">{count}</span>}
              </button>
            )
          })}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1080px] space-y-8 px-4 py-6">
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2 text-[12.5px] text-destructive">
            <span className="flex-1">{error}</span>
            <button onClick={() => setError('')} aria-label="Dismiss" className="text-destructive/70 hover:text-destructive">
              <X className="size-3.5" />
            </button>
          </div>
        )}

        {/* ── People ─────────────────────────────────────────────────────── */}
        {tab === 'people' && (
          <Panel
            title="Mailboxes"
            note="Every account on this server. Deleting one removes its mail, its key and its addresses; that cannot be undone."
          >
            <div className="flex items-center gap-2 border-b border-line px-4 py-2">
              <Search className="size-3.5 text-ink-3" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name or address"
                className="w-full bg-transparent text-[12.5px] text-ink-1 placeholder:text-ink-3 focus:outline-none"
              />
              <span className="mono shrink-0 text-[11px] text-ink-3">
                {filteredUsers.length} of {users.length}
              </span>
            </div>

            {usersLoading ? (
              <Empty>Loading accounts…</Empty>
            ) : filteredUsers.length === 0 ? (
              <Empty>
                {users.length > 0
                  ? 'No account matches that search.'
                  : error
                    ? `The account list could not be read${error ? `: ${error}` : ''}.`
                    : 'No accounts yet.'}
              </Empty>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line text-left">
                    <th className={`${cell} label`}>Mailbox</th>
                    <th className={`${cell} label hidden sm:table-cell`}>Recovery</th>
                    <th className={`${cell} label`}>Role</th>
                    <th className={`${cell} label text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user) => {
                    const self = user.username === storage.getUsername()
                    return (
                      <tr key={user.uid ?? user.username} className="border-b border-line/70 last:border-0">
                        <td className={cell}>
                          <p className="truncate font-medium text-ink-1" title={user.username}>{user.username}</p>
                          <p className="mono truncate text-[11px] text-ink-3">{user.email ?? `${user.username}@slothlee.xyz`}</p>
                        </td>
                        <td className={`${cell} hidden sm:table-cell`}>
                          {user.recovery_email ? (
                            <span className="text-ink-2">{user.recovery_email}</span>
                          ) : (
                            // "not set" reads as a dead end; the useful thing to
                            // offer is the way to set it.
                            <button
                              onClick={() => openRecovery(user)}
                              className="text-[12px] text-ink-4 underline decoration-line-strong underline-offset-2 transition-colors duration-120 hover:text-primary"
                            >
                              Set recovery
                            </button>
                          )}
                        </td>
                        <td className={cell}>
                          <button
                            onClick={() => toggleAdmin(user)}
                            disabled={self}
                            title={self ? 'You cannot change your own role' : user.is_admin ? 'Revoke admin' : 'Grant admin'}
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors duration-120 max-sm:min-h-[30px] max-sm:px-2.5 ${
                              user.is_admin
                                ? 'border-primary/35 bg-primary/10 text-primary'
                                : 'border-line text-ink-3 hover:border-line-strong hover:text-ink-2'
                            } ${self ? 'opacity-60' : ''}`}
                          >
                            {user.is_admin ? <ShieldCheck className="size-3" /> : <Shield className="size-3" />}
                            {user.is_admin ? 'admin' : 'user'}
                          </button>
                        </td>
                        <td className={`${cell} text-right`}>
                          <button
                            onClick={() => openRecovery(user)}
                            title={`Password recovery for ${user.username}`}
                            aria-label={`Password recovery for ${user.username}`}
                            className="rounded p-1.5 text-ink-3 transition-colors duration-120 hover:bg-accent hover:text-primary max-sm:p-2.5"
                          >
                            <KeyRound className="size-4" />
                          </button>
                          <button
                            onClick={() => setModalState({ type: 'delete', username: user.username })}
                            title={`Delete ${user.username}`}
                            aria-label={`Delete ${user.username}`}
                            className="rounded p-1.5 text-ink-3 transition-colors duration-120 hover:bg-destructive/10 hover:text-destructive max-sm:p-2.5"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </Panel>
        )}

        {/* ── Access ─────────────────────────────────────────────────────── */}
        {tab === 'access' && (
          <>
            <Panel
              title="Waiting for a decision"
              note="Accounts created at /signup without an invite code. They cannot sign in until approved; denying deletes the account, so no name can sit on a mailbox nobody can read."
            >
              {pendingLoading ? (
                <Empty>Loading…</Empty>
              ) : pending.length === 0 ? (
                <Empty art={error ? undefined : 'queue'}>
                  {error
                    ? `The queue could not be read: ${error}.`
                    : 'Nobody is waiting. Requests appear here the moment someone signs up.'}
                </Empty>
              ) : (
                <ul>
                  {pending.map((entry) => (
                    <li key={entry.username} className="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-3 last:border-0">
                      <div className="min-w-0 flex-1">
                        <p className="mono text-[12.5px] text-ink-1">{entry.username}</p>
                        <p className="text-[11px] text-ink-3">
                          asked {when(entry.requested_at)}
                          {entry.ip ? ` · from ${entry.ip}` : ' · address unknown'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button size="sm" onClick={() => decidePending(entry.username, 'approve')} disabled={busy === entry.username}>
                          {busy === entry.username ? 'Working…' : 'Approve'}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => decidePending(entry.username, 'deny')}
                          disabled={busy === entry.username}
                          title="Deny and delete this request"
                        >
                          Deny
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel
              title="Invite requests"
              note="People who asked for access at /signup. Approving mints a single-use code; send it however they actually read messages."
            >
              {invitesLoading ? (
                <Empty>Loading…</Empty>
              ) : invites.length === 0 && error ? (
                <Empty>{`The request list could not be read${error ? `: ${error}` : ''}.`}</Empty>
              ) : invites.length === 0 ? (
                <Empty>
                  No requests yet. The link to share is{' '}
                  <a href="/signup" className="text-primary underline underline-offset-2">mail.slothlee.xyz/signup</a>.
                </Empty>
              ) : (
                <ul>
                  {invites.map((entry) => (
                    <li key={entry.email} className="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-3 last:border-0">
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px] text-ink-1">{entry.email}</p>
                        <p className="text-[11px] text-ink-3">
                          {when(entry.requested_at)} · {inviteStatus(entry.status)}
                        </p>
                      </div>
                      {entry.status === 'pending' ? (
                        <Button size="sm" onClick={() => approveInvite(entry.email)} disabled={busy === entry.email}>
                          {busy === entry.email ? 'Approving…' : 'Approve'}
                        </Button>
                      ) : entry.code ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="mono rounded bg-secondary px-2 py-1 text-[11px] text-ink-2">
                            {entry.code.slice(0, 8)}…
                          </code>
                          <Button size="sm" variant="outline" onClick={() => copyInvite(entry)}>
                            {copied === entry.email ? 'Copied' : 'Copy'}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => shareInvite(entry)}>
                            Send
                          </Button>
                        </div>
                      ) : (
                        <span className="text-[11px] text-ink-4">code already used</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </>
        )}

        {/* ── Deliverability ─────────────────────────────────────────────── */}
        {tab === 'deliverability' && (
          <Panel
            title="Addresses this server accepts"
            note="Postfix is rebuilt from this list every few seconds. If an address is missing here, mail to it is rejected at RCPT with 'user unknown' — this is the first thing to check when mail does not arrive."
            action={
              <a
                href="/signup"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] text-ink-2 transition-colors duration-120 hover:bg-accent hover:text-ink-1"
              >
                Public signup <ExternalLink className="size-3" />
              </a>
            }
          >
            {recipients === null ? (
              <Empty>{error ? `The recipient map could not be read: ${error}` : 'Loading…'}</Empty>
            ) : recipients.length === 0 ? (
              <Empty>No addresses are being accepted. That is a fault, not an empty state.</Empty>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2 border-b border-line px-4 py-3">
                  <div>
                    <p className="label">Accepted</p>
                    <p className="mono mt-1 text-[15px] text-ink-1">{recipients.length}</p>
                  </div>
                  <div>
                    <p className="label">Mailboxes</p>
                    <p className="mono mt-1 text-[15px] text-ink-1">{users.length}</p>
                  </div>
                  <div>
                    <p className="label">Aliases</p>
                    <p className="mono mt-1 text-[15px] text-ink-1">{aliasCount}</p>
                  </div>
                </div>
                <ul className="flex flex-wrap gap-1.5 p-4">
                  {recipients.map((name) => (
                    <li key={name} className="mono rounded-md bg-secondary px-2 py-1 text-[11.5px] text-ink-2">
                      {name}@slothlee.xyz
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Panel>
        )}

        {/* ── System ─────────────────────────────────────────────────────── */}
        {tab === 'system' && (
          <Panel title="Storage" note="Where the disk goes, per mailbox. Messages are counted from the mail index; sizes are what those messages occupy on disk.">
            {disk === null ? (
              <Empty>{error ? `Storage figures could not be read: ${error}` : 'Loading…'}</Empty>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 border-b border-line px-4 py-3 sm:grid-cols-3">
                  <div>
                    <p className="label">Messages</p>
                    <p className="mono mt-1 text-[15px] text-ink-1">{diskTotals.messages}</p>
                  </div>
                  <div>
                    <p className="label">On disk</p>
                    <p className="mono mt-1 text-[15px] text-ink-1">{bytes(diskTotals.bytesUsed)}</p>
                  </div>
                  <div>
                    <p className="label">Mailboxes</p>
                    <p className="mono mt-1 text-[15px] text-ink-1">{disk.length}</p>
                  </div>
                </div>
                {diskTotals.biggest.length === 0 ? (
                  <Empty>No mail stored yet.</Empty>
                ) : (
                  <>
                  <div className="flex items-baseline justify-between border-b border-line px-4 py-2">
                    <p className="label">Largest mailboxes</p>
                    <p className="mono text-[10.5px] text-ink-4">
                      {diskTotals.biggest.length} of {disk.length} · bar is share of total
                    </p>
                  </div>
                  <ul>
                    {diskTotals.biggest.map((row) => {
                      const share = diskTotals.bytesUsed ? (row.disk_usage_bytes ?? 0) / diskTotals.bytesUsed : 0
                      const width = Math.max(1.5, Math.round(share * 1000) / 10)
                      return (
                        <li key={row.username} className="border-b border-line/70 px-4 py-2.5 last:border-0">
                          <div className="flex items-baseline gap-3">
                            <span className="flex-1 truncate text-[12.5px] text-ink-1">{row.username}</span>
                            <span className="mono text-[11.5px] text-ink-3">{row.email_count} messages</span>
                            <span className="mono w-16 text-right text-[11.5px] text-ink-2">{bytes(row.disk_usage_bytes)}</span>
                          </div>
                          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-line/70">
                            <div className="h-full rounded-full bg-primary/70" style={{ width: `${width}%` }} />
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                  </>
                )}
              </>
            )}
          </Panel>
        )}
      </main>

      <InputModal
        isOpen={modalState.type === 'create'}
        onClose={() => setModalState({ type: null })}
        title="New mailbox"
        label="Username"
        placeholder="yourname"
        confirmText="Create"
        onConfirm={createUser}
      />

      <ConfirmModal
        isOpen={modalState.type === 'delete'}
        onClose={() => setModalState({ type: null })}
        title="Delete mailbox"
        description={`Delete "${modalState.username}"? Their mail, their key and every address are removed. This cannot be undone.`}
        confirmText="Delete"
        onConfirm={deleteUser}
      />

      {recovery && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-line bg-card p-5">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="display text-[16px] text-ink-1">Password recovery</h3>
                <p className="mono mt-0.5 text-[11.5px] text-ink-3">{recovery.username}@slothlee.xyz</p>
              </div>
              <button onClick={() => setRecovery(null)} aria-label="Close" className="rounded p-1 text-ink-3 hover:text-ink-1">
                <X className="size-4" />
              </button>
            </div>

            <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
              The link goes to a recovery address, not to the mailbox — someone who cannot sign in
              cannot read their own inbox.
            </p>

            <label htmlFor="rec-addr" className="mt-3 block text-[12px] font-medium text-ink-2">
              Recovery address
            </label>
            <div className="mt-1 flex gap-2">
              <Input
                id="rec-addr"
                type="email"
                value={recovery.email}
                onChange={(e) => setRecovery((r) => ({ ...r, email: e.target.value }))}
                placeholder="them@elsewhere.com"
              />
              <Button variant="outline" onClick={saveRecoveryAddress} disabled={recovery.saving}>
                {recovery.saving ? 'Saving…' : 'Save'}
              </Button>
            </div>

            <div className="mt-4 rounded-lg border border-line bg-background/40 p-3">
              <Button onClick={sendRecoveryEmail} disabled={recovery.sending || !recovery.email.trim()} className="w-full">
                {recovery.sending ? 'Sending…' : 'Send recovery email'}
              </Button>

              {recovery.result && (
                <div className="mt-3 space-y-2 text-[12px]">
                  <p className={recovery.result.emailed ? 'text-primary' : 'text-sand'}>
                    {recovery.result.emailed
                      ? `Sent to ${recovery.result.sent_to}`
                      : `Not mailed: ${recovery.result.mail_error || 'unknown error'}`}
                  </p>
                  <p className="text-ink-3">
                    Or hand this link over yourself — it works once and expires in{' '}
                    {recovery.result.expires_in_minutes} minutes:
                  </p>
                  <code className="mono block break-all rounded bg-field p-2 text-[11px] text-ink-2">
                    {`${window.location.origin}/reset?t=${recovery.result.token}`}
                  </code>
                  <Button
                    variant="outline"
                    className="w-full gap-2"
                    onClick={async () => {
                      const link = `${window.location.origin}/reset?t=${recovery.result.token}`
                      const message = `Reset your Sloth Lee Mail password (${recovery.username}) within ${recovery.result.expires_in_minutes} minutes:\n\n${link}\n\nSetting a new password creates a new key, so mail encrypted to the old key cannot be read afterwards.`
                      try {
                        await navigator.clipboard.writeText(message)
                        setRecovery((r) => ({ ...r, copied: true }))
                        setTimeout(() => setRecovery((r) => (r ? { ...r, copied: false } : r)), 2000)
                      } catch {
                        setRecovery((r) => ({ ...r, error: 'Clipboard unavailable — select the link and copy it by hand' }))
                      }
                    }}
                  >
                    <Copy className="size-3.5" /> {recovery.copied ? 'Copied' : 'Copy message'}
                  </Button>
                </div>
              )}

              {recovery.error && <p className="mt-2 text-[12px] text-destructive">{recovery.error}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Admin
