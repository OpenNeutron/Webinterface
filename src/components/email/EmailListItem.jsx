import { useState } from 'react'
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from '@/components/ui/dropdown-menu'
import { Star, Folder, MailOpen, Mail, Trash2, MoreHorizontal, Check, Paperclip, Lock } from 'lucide-react'
import { SenderAvatar } from '@/components/SenderAvatar'

/**
 * A clock for the eye, not a date library: the row is inside a day group, so the
 * only thing worth printing is the time — or the day, for anything older.
 */
export function rowTime(date, omitDate = false) {
  if (!date) return ''
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const sameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  }
  // Inside a day group the header already says which day it is; printing the date on every
  // row repeats it six times and squeezes the name that the row exists to show.
  if (omitDate) return ''
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleDateString([], sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: '2-digit' })
}

/** Which day a message belongs to, for the list's day headings. */
export function dayBucket(date) {
  if (!date) return 'Earlier'
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return 'Earlier'
  const now = new Date()
  const midnight = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((midnight(now) - midnight(d)) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return 'Earlier this week'
  return 'Earlier'
}

const rowBase =
  '@container mail-row group/item relative flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-120 cursor-pointer'

export function EmailListItem({
  compactTime = false,
  uid,
  preview,
  isSelected,
  isChecked,
  isUnread,
  isFresh = false,
  isStarred,
  onSelect,
  onCheck,
  onMarkRead,
  onMarkUnread,
  onToggleStar,
  onDeleteEmail,
  onMoveToGroup,
  onRemoveFromGroup,
  groups,
  selectedFolder,
}) {
  const [menuOpen, setMenuOpen] = useState(false)

  // A message whose body will not open is not "empty" — say why, in sand, so it
  // is not mistaken for an ordinary unread message.
  const undecryptable = !!preview?.decryptFailed
  const isInGroup = selectedFolder && selectedFolder !== 'inbox' && selectedFolder !== 'starred'

  const senderLabel = preview?.from?.name || preview?.from?.email || uid

  const snippet = undecryptable
    ? 'Cannot be decrypted with the key on this device'
    : preview?.preview || ''

  const ground = isSelected
    ? 'bg-[color-mix(in_srgb,var(--color-primary)_9%,transparent)]'
    : 'hover:bg-accent'
  const unreadWeight = isUnread ? 'font-semibold' : 'font-normal'
  // Empty when the day group above already names the day: the row should spend its
  // width on the name, not on a date the reader just read.
  const stamped = rowTime(preview?.date, compactTime)

  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={isSelected ? 'true' : undefined}
      onClick={() => onSelect(uid)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(uid)
        }
      }}
      className={`${rowBase} ${ground} ${isChecked ? 'bg-sand/10' : ''} ${isFresh ? 'row-in' : ''}`}
    >
      {/* The open row is marked by a rule at its edge, not by a colour block
          behind the text. */}
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 w-[2px] transition-opacity duration-120 ${
          isSelected ? 'bg-primary opacity-100' : 'opacity-0'
        }`}
      />

      <div className="flex w-4 shrink-0 items-center justify-center self-stretch max-sm:w-11">
        <button
          type="button"
          aria-label={isChecked ? 'Unselect message' : 'Select message'}
          onClick={(e) => {
            e.stopPropagation()
            onCheck(uid)
          }}
          // The box is 16px; the button around it is thumb-sized on a phone.
          className="flex items-center justify-center max-sm:min-h-11 max-sm:min-w-11"
        >
          <span
            className={`flex size-4 items-center justify-center rounded border transition-all duration-120 max-sm:size-5 ${
              isChecked
                ? 'border-primary bg-primary'
                : 'border-ink-4/60 hover:border-ink-2'
            }`}
          >
            {isChecked && <Check className="size-2.5 text-primary-foreground" strokeWidth={3} />}
          </span>
        </button>
      </div>

      <SenderAvatar from={preview?.from} isSelected={isSelected} />

      {/* Two columns of information on a wide screen, two lines on a phone —
          both aligned to the same gutters as the toolbar above. */}
      <div
        /* The gap is only worth having when something sits in the second column: an
           empty time cell still cost 16px of the sender's line. On a wide row the
           subject is a column of its own, so the gap stays: without it, every row with
           no time printed (anything before today) started its subject 16px left of the
           rows above it. */
        className={`grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-y-0.5 @[520px]:grid-cols-[minmax(0,180px)_minmax(0,1fr)_auto] ${
          stamped ? 'gap-x-4' : 'gap-x-0 @[520px]:gap-x-4'
        }`}
      >
        <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-1.5">
          {/* The unread mark belongs to the sender line, not to a column of its own:
              keep it inline and the avatar can sit on the page gutter instead of being
              pushed right by a slot that exists for one 6px dot. */}
          <span className="flex w-1.5 shrink-0 justify-center" aria-hidden={!isUnread}>
            <span
              className={`size-1.5 rounded-full bg-primary transition-opacity duration-200 ${isUnread ? 'opacity-100' : 'opacity-0'}`}
            />
            {isUnread && <span className="sr-only">Unread</span>}
          </span>
          <span className={`truncate text-[13.5px] ${unreadWeight} ${undecryptable ? 'text-sand' : 'text-ink-1'}`}>
            {undecryptable ? 'Encrypted message' : senderLabel}
          </span>
          {preview?.e2ee && <Lock className="size-3 shrink-0 text-ink-3" aria-label="End-to-end encrypted" />}
          {preview?.attachments?.length > 0 && (
            <Paperclip className="size-3 shrink-0 text-ink-3" aria-label="Has attachments" />
          )}
        </div>

        {/* One width for the column, not three: "14:34" is 36px, "Oct 17" 43, and
            "Sep 24, 25" 72, so an auto column moved the sender's truncation point row
            to row and left the dates ragged on the left edge. */}
        <span
          className={`col-start-2 row-start-1 shrink-0 justify-self-end whitespace-nowrap text-right mono tabular-nums text-[12px] text-ink-3 @[520px]:col-start-3 ${
            stamped ? 'w-[52px]' : 'hidden'
          }`}
        >
          {stamped}
        </span>

        <div className="col-span-2 row-start-2 min-w-0 @[520px]:col-span-1 @[520px]:col-start-2 @[520px]:row-start-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <p className={`truncate text-[13px] ${isUnread ? 'text-ink-1' : 'text-ink-2'}`}>
              {preview?.subject || '(no subject)'}
            </p>
            {isStarred && <Star className="size-3 shrink-0 self-center fill-sand text-sand" aria-label="Starred" />}
          </div>
          {snippet && (
            <p className="mail-row-snippet mt-0.5 truncate text-[12.5px] leading-snug text-ink-3">{snippet}</p>
          )}
        </div>
      </div>

      {/* Actions occupy the space the timestamp already holds, so hovering moves
          nothing. */}
      <div
        className={`absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded-md border border-line bg-card/95 px-1 py-0.5 shadow-sm transition-opacity duration-120 ${
          menuOpen ? 'opacity-100' : 'opacity-0 group-hover/item:opacity-100'
        }`}
      >
        <button
          type="button"
          aria-label={isStarred ? 'Remove star' : 'Star message'}
          onClick={(e) => {
            e.stopPropagation()
            onToggleStar(uid)
          }}
          className={`rounded p-1.5 transition-colors duration-120 hover:bg-accent max-sm:p-2.5 ${
            isStarred ? 'text-sand' : 'text-ink-3 hover:text-sand'
          }`}
        >
          <Star className={`size-3.5 ${isStarred ? 'fill-sand' : ''}`} />
        </button>

        <DropdownMenuRoot onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="More actions"
              onClick={(e) => e.stopPropagation()}
              className="rounded p-1.5 text-ink-3 transition-colors duration-120 hover:bg-accent hover:text-ink-1 max-sm:p-2.5"
            >
              <MoreHorizontal className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {isUnread ? (
              <DropdownMenuItem onClick={() => onMarkRead(uid)}>
                <MailOpen className="size-4" /> Mark as read
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => onMarkUnread(uid)}>
                <Mail className="size-4" /> Mark as unread
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Folder className="size-4" /> Move to group
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  {groups.length > 0 ? (
                    groups.map((g) => (
                      <DropdownMenuItem key={g.uid} onClick={() => onMoveToGroup(uid, g.uid)}>
                        <Folder className="size-4" /> {g.title}
                      </DropdownMenuItem>
                    ))
                  ) : (
                    <DropdownMenuItem disabled>
                      <span className="text-ink-3">No groups yet</span>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
            {isInGroup && (
              <DropdownMenuItem onClick={() => onRemoveFromGroup(uid)}>Remove from group</DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onClick={() => onDeleteEmail(uid)}>
              <Trash2 className="size-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuRoot>
      </div>
    </div>
  )
}

/**
 * The loading shape, matched to the loaded row: same height, same column widths,
 * so the swap costs no layout. A component that renders nothing while fetching
 * is a layout shift, not a loading state.
 */
export function EmailRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3" aria-hidden="true">
      <div className="size-4 shrink-0" />
      <div className="size-8 shrink-0 animate-breathe rounded-lg bg-white/[0.045]" />
      <div className="min-w-0 flex-1">
        <div className="h-[11px] w-32 animate-breathe rounded bg-white/[0.05]" />
        <div className="mt-2 h-[10px] w-3/5 animate-breathe rounded bg-white/[0.04]" />
        <div className="mt-1.5 h-[9px] w-4/5 animate-breathe rounded bg-white/[0.03]" />
      </div>
    </div>
  )
}
