import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import SlothMark from '@/components/SlothMark'
import { storage } from '@/storage'
import { useEffect, useState } from 'react'
import {
  Inbox,
  Star,
  SendHorizontal,
  FileEdit,
  MoreVertical,
  Plus,
  FolderPlus,
  Settings,
  Trash2,
} from 'lucide-react'

const DEFAULT_FOLDERS = [
  { id: 'inbox', icon: Inbox, label: 'Inbox' },
  { id: 'starred', icon: Star, label: 'Starred' },
  { id: 'sent', icon: SendHorizontal, label: 'Sent' },
  { id: 'drafts', icon: FileEdit, label: 'Drafts' },
  { id: 'trash', icon: Trash2, label: 'Trash' },
]

// 44px rows on the phone drawer; the desktop rail keeps its denser 36px rhythm.
const row =
  'group/row relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors duration-120 max-md:min-h-11'
const rowIdle = 'text-ink-2 hover:bg-accent hover:text-ink-1'
const rowActive = 'bg-secondary text-ink-1 before:absolute before:inset-y-1.5 before:left-0 before:w-[2px] before:rounded-full before:bg-primary'

/**
 * Folders, groups, and the way out.
 *
 * The list ends on purpose: a footer with settings stops the column from reading
 * as a panel that ran out of content.
 */
const Sidebar = ({
  selectedFolder,
  onSelectFolder,
  groups,
  onRequestCreateGroup,
  onRequestRenameGroup,
  onRequestDeleteGroup,
  emailMeta,
  uids,
  sentCount = 0,
  draftsCount = 0,
  trashCount = 0,
  onCompose,
  onOpenSettings,
}) => {
  // The viewport, live: a screenshot then carries both halves of every argument we have
  // had about "nothing is changing" — the build, and the space the page was given.
  const [viewport, setViewport] = useState('')
  useEffect(() => {
    const read = () => setViewport(`${window.innerWidth}×${window.innerHeight}`)
    read()
    window.addEventListener('resize', read)
    window.addEventListener('orientationchange', read)
    return () => {
      window.removeEventListener('resize', read)
      window.removeEventListener('orientationchange', read)
    }
  }, [])

  // Read once: the flag cannot change without a fresh session, and re-reading it on every
  // render would put localStorage in the render path.
  const [showBuildStamp] = useState(() => {
    try {
      return storage.getIsAdmin() === true
    } catch {
      return false
    }
  })

  const inboxUnread = uids.filter((uid) => emailMeta[uid]?.unread !== false).length
  const starredCount = uids.filter((uid) => emailMeta[uid]?.starred).length

  const getBadge = (id) => {
    if (id === 'inbox') return inboxUnread
    if (id === 'starred') return starredCount
    if (id === 'sent') return sentCount
    if (id === 'drafts') return draftsCount
    if (id === 'trash') return trashCount
    return 0
  }

  return (
    <div className="flex h-full flex-col border-r border-line bg-background">
      <div className="flex h-14 shrink-0 items-center px-4">
        <a
          href="https://slothlee.xyz"
          className="flex items-center gap-2 rounded-md transition-opacity duration-120 hover:opacity-80"
          title="Sloth Lee — all products"
        >
          <SlothMark className="size-6 shrink-0" />
          <span className="display text-[17px] text-ink-1">
            Sloth <span className="text-sand">Lee</span>
          </span>
        </a>
      </div>

      {/* One house, two rooms. Mail is this app; the bot lives in its own dashboard,
          and both are the same account. The row is the whole of the cross-product
          navigation — a switcher, not a menu. */}
      <div className="flex gap-1 px-2.5 pb-2.5" role="tablist" aria-label="Products">
        <span
          role="tab"
          aria-selected="true"
          className="flex h-6 items-center rounded-md bg-secondary px-2.5 text-[11px] font-medium text-ink-1 max-md:h-11 max-md:px-3"
        >
          Mail
        </span>
        <a
          role="tab"
          aria-selected="false"
          href="https://app.slothlee.xyz/"
          className="flex h-6 items-center rounded-md px-2.5 text-[11px] text-ink-3 transition-colors duration-120 hover:bg-secondary/60 hover:text-ink-1 max-md:h-11 max-md:px-3"
        >
          Bot
        </a>
      </div>

      <div className="px-2.5 pb-2">
        <button
          onClick={onCompose}
          className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary text-[13px] font-semibold text-primary-foreground transition-colors duration-120 hover:bg-primary/90 active:scale-[0.995] max-md:h-11"
        >
          New message
        </button>
      </div>

      <nav className="space-y-0.5 px-2.5" aria-label="Folders">
        {DEFAULT_FOLDERS.map(({ id, icon: Icon, label }) => {
          const badge = getBadge(id)
          const isActive = selectedFolder === id
          return (
            <button
              key={id}
              onClick={() => onSelectFolder(id)}
              aria-current={isActive ? 'page' : undefined}
              className={`${row} w-full ${isActive ? rowActive : rowIdle}`}
            >
              <Icon className={`size-4 shrink-0 ${isActive ? 'text-primary' : 'text-ink-3'}`} />
              <span className={isActive ? 'font-medium' : ''}>{label}</span>
              {badge > 0 && (
                <span
                  className={`mono ml-auto text-[11px] ${
                    isActive ? 'text-ink-2' : id === 'inbox' ? 'text-ink-2' : 'text-ink-3'
                  }`}
                >
                  {badge}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      <div className="my-2.5 mx-2.5 border-t border-line" />

      <div className="flex items-center justify-between px-4 pb-1">
        <span className="label">Groups</span>
        <button
          onClick={onRequestCreateGroup}
          className="flex items-center justify-center rounded p-0.5 text-ink-3 transition-colors duration-120 hover:text-ink-1 max-md:min-h-11 max-md:min-w-11"
          title="New group"
          aria-label="New group"
        >
          <Plus className="size-3.5" />
        </button>
      </div>

      <div className="custom-scrollbar flex-1 space-y-0.5 overflow-y-auto px-2.5">
        {groups.map((group) => {
          const isActive = selectedFolder === group.uid
          const count = group.email_uids.filter((uid) => uids.includes(uid)).length
          return (
            <div key={group.uid} className="group/item relative">
              <button
                onClick={() => onSelectFolder(group.uid)}
                aria-current={isActive ? 'page' : undefined}
                className={`${row} w-full pr-7 ${isActive ? rowActive : rowIdle}`}
              >
                <span
                  className={`size-1.5 shrink-0 rounded-full ${isActive ? 'bg-sand' : 'bg-ink-4'}`}
                  aria-hidden="true"
                />
                <span className="truncate text-left">{group.title}</span>
                {count > 0 && <span className="mono ml-auto text-[11px] text-ink-3">{count}</span>}
              </button>

              <div className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 transition-opacity duration-120 group-hover/item:opacity-100 focus-within:opacity-100">
                <DropdownMenuRoot>
                  <DropdownMenuTrigger asChild>
                    <button
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Actions for ${group.title}`}
                      className="rounded p-1 text-ink-3 transition-colors duration-120 hover:text-ink-1"
                    >
                      <MoreVertical className="size-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => onRequestRenameGroup(group.uid, group.title)}>
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      destructive
                      onClick={() => onRequestDeleteGroup(group.uid, group.title)}
                    >
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenuRoot>
              </div>
            </div>
          )
        })}

        {groups.length === 0 && (
          <div className="px-1.5 py-3">
            <p className="text-[12px] leading-relaxed text-ink-3">
              No groups yet.
            </p>
            <button
              onClick={onRequestCreateGroup}
              className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-ink-2 transition-colors duration-120 hover:text-ink-1"
            >
              <FolderPlus className="size-3.5" /> New group
            </button>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line p-2.5">
        <button
          onClick={onOpenSettings}
          className={`${row} w-full ${rowIdle}`}
        >
          <Settings className="size-4 shrink-0 text-ink-3" />
          <span>Settings</span>
        </button>
        {/* The build this screen is running, and the viewport the browser gave it:
            both questions cost a round of "nothing has changed" to answer. Staff only —
            a customer paying for a mailbox should not read a commit hash under Settings. */}
        {showBuildStamp && (
          <p className="mono mt-1.5 px-1.5 text-[10px] leading-tight text-ink-3/70">
            {__BUILD_ID__} · {viewport}
          </p>
        )}
      </div>
    </div>
  )
}

// __BUILD_ID__ is declared by the build (see vite.config.js): a string, never a runtime import.

export default Sidebar
