import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import EmptyArt from '@/components/EmptyArt'
import { EmailListItem, EmailRowSkeleton, dayBucket, rowTime } from '@/components/email/EmailListItem'
import { buildThreads } from '@/lib/threads'
import { SenderAvatar } from '@/components/SenderAvatar'

const EmailList = ({
  searchQuery = '',
  filterMode = 'all',
  uids,
  previews,
  emailMeta,
  selectedUid,
  checkedUids,
  onSelect,
  onCheck,
  loading,
  hasMore,
  onLoadMore,
  onMarkRead,
  onMarkUnread,
  onToggleStar,
  onDeleteEmail,
  // Deletes every message in a conversation (to Trash, or for good inside Trash).
  onDeleteThread = null,
  // Told the order the rows are shown in, so J/K and "open the next one" follow the screen.
  onOrder = null,
  onMoveToGroup,
  onRemoveFromGroup,
  groups,
  folderLabel,
  selectedFolder,
}) => {
  // Which conversation rows are open. Keyed by thread key, not uid.
  const [expandedThreads, setExpandedThreads] = useState(() => new Set())

  // Conversations: header-linked messages first, with a conservative
  // subject+sender fallback for mail whose headers were not preserved.
  const threads = useMemo(
    () =>
      buildThreads(
        uids.map((uid) => ({
          uid,
          ...(previews[uid] || {}),
          unread: emailMeta[uid]?.unread !== false,
        })),
        { unreadByUid: Object.fromEntries(uids.map((uid) => [uid, emailMeta[uid]?.unread !== false])) },
      ),
    [uids, previews, emailMeta],
  )

  // Days as structure, so recency is read instead of parsed out of a column.
  const grouped = useMemo(() => {
    const out = []
    for (const thread of threads) {
      const bucket = dayBucket(previews[thread.latestUid]?.date)
      const last = out[out.length - 1]
      if (last && last.bucket === bucket) last.items.push(thread)
      else out.push({ bucket, items: [thread] })
    }
    return out
  }, [threads, previews])

  // The list as the eye reads it: day groups, conversations kept together. The order the
  // server gave is not it — threads pull older replies up to their newest message.
  const displayOrder = useMemo(() => grouped.flatMap((group) => group.items.flatMap((thread) => thread.uids)), [grouped])
  useEffect(() => {
    onOrder?.(displayOrder)
  }, [displayOrder, onOrder])

  const rowProps = (uid) => ({
    uid,
    compactTime: true,
    preview: previews[uid],
    isSelected: selectedUid === uid,
    isChecked: !!checkedUids?.has(uid),
    isUnread: emailMeta[uid]?.unread !== false,
    isStarred: !!emailMeta[uid]?.starred,
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
  })

  const showSkeleton = loading && threads.length === 0
  const showEmpty = !loading && threads.length === 0

  // Arrival is an event, not a derivation: a memo that answers "which rows are
  // new *right now*" loses the answer on the next render, because the id is
  // already known by then. So the set is held for a moment instead.
  const seen = useRef(null)
  const [fresh, setFresh] = useState(() => new Set())
  useEffect(() => {
    if (loading || threads.length === 0) return
    const ids = new Set(threads.map((t) => t.latestUid))
    if (seen.current === null) {
      seen.current = ids
      return
    }
    const added = [...ids].filter((id) => !seen.current.has(id))
    // No overlap at all means the folder changed, not that mail arrived.
    const replaced = [...ids].every((id) => !seen.current.has(id))
    // "Load older mail" appends rows that are genuinely new to this view but
    // arrived long ago. Only a new row at the top of the list is an arrival.
    const newest = threads[0]?.latestUid
    seen.current = ids
    if (!added.length || replaced || !added.includes(newest)) return
    setFresh(new Set([newest]))
    const timer = setTimeout(() => setFresh(new Set()), 1400)
    return () => clearTimeout(timer)
  }, [threads, loading])

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="custom-scrollbar flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1040px]">
        {showSkeleton && (
          <div>
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="border-b border-line/70">
                <EmailRowSkeleton />
              </div>
            ))}
          </div>
        )}

        {grouped.map((group) => (
          <div key={group.bucket}>
            <div className="sticky top-0 z-10 flex items-center gap-3 bg-background/95 px-4 pb-1.5 pt-3 backdrop-blur-sm">
              <span className="label">{group.bucket}</span>
              <span className="h-px flex-1 bg-line" />
            </div>

            {group.items.map((thread) => {
              if (thread.count === 1) {
                return (
                  <div key={thread.latestUid} className="border-b border-line/70">
                    <EmailListItem {...rowProps(thread.latestUid)} isFresh={fresh.has(thread.latestUid)} />
                  </div>
                )
              }

              const open = expandedThreads.has(thread.key)
              const latest = previews[thread.latestUid] || {}
              const selectedInThread = thread.uids.includes(selectedUid)
              const participants = thread.participants.slice(0, 3).join(', ')

              return (
                <div key={thread.key} data-testid="thread-group" className="group/thread relative border-b border-line/70">
                  <button
                    type="button"
                    onClick={() => {
                      setExpandedThreads((prev) => {
                        const next = new Set(prev)
                        if (next.has(thread.key)) next.delete(thread.key)
                        else next.add(thread.key)
                        return next
                      })
                      onSelect(thread.latestUid)
                    }}
                    className={`relative flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-120 ${
                      selectedInThread ? 'bg-primary/[0.07]' : 'hover:bg-accent'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`absolute inset-y-0 left-0 w-[2px] ${
                        selectedInThread ? 'bg-primary' : 'bg-transparent'
                      }`}
                    />
                    <span className="w-4 shrink-0 text-ink-3">
                      {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    </span>
                    <SenderAvatar from={latest.from} isSelected={selectedInThread} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span
                          className={`truncate text-[13.5px] ${
                            thread.unreadCount > 0 ? 'font-semibold text-ink-1' : 'text-ink-2'
                          }`}
                        >
                          {thread.participants.length > 1
                            ? participants
                            : thread.participants[0] || 'Unknown sender'}
                        </span>
                        <span className="mono shrink-0 rounded bg-secondary px-1.5 text-[10.5px] text-ink-2">
                          {thread.count}
                        </span>
                        <span className="mono ml-auto shrink-0 pl-2 text-[11.5px] text-ink-3">
                          {rowTime(latest.date)}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-[13px] text-ink-2">
                        {thread.subject}
                      </span>
                      {latest.preview && (
                        <span className="mt-0.5 block truncate text-[12.5px] text-ink-3">
                          {latest.preview}
                        </span>
                      )}
                    </span>
                  </button>
                  {onDeleteThread && (
                    /* Over the time, like a single row's actions: hovering moves nothing. */
                    <button
                      type="button"
                      onClick={() => onDeleteThread(thread.uids)}
                      className="absolute right-3 top-3 rounded-md border border-line bg-card/95 p-1.5 text-ink-3 opacity-0 shadow-sm transition-opacity duration-120 hover:text-destructive focus-visible:opacity-100 group-hover/thread:opacity-100 max-sm:hidden"
                      title={`Delete all ${thread.count} messages in this conversation`}
                      aria-label={`Delete conversation (${thread.count} messages)`}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}

                  {open && (
                    <div className="ml-4 border-l border-line">
                      {thread.uids.map((uid) => (
                        <EmailListItem key={uid} {...rowProps(uid)} isFresh={fresh.has(uid)} />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}

        {showEmpty && (() => {
          // Three different emptinesses, three different sentences: a folder
          // you have not used, a filter that hides everything, and a search
          // that found nothing are not the same event.
          const searching = searchQuery.trim().length > 0
          const filtered = filterMode !== 'all'
          const art = searching ? 'search' : selectedFolder === 'groups' ? 'groups' : 'inbox'
          const heading = searching
            ? `Nothing matches “${searchQuery.trim().slice(0, 40)}”`
            : filtered
              ? `No ${filterMode} mail in ${folderLabel || 'this folder'}`
              : selectedFolder === 'trash'
                ? 'Trash is empty'
                : `Nothing in ${folderLabel || 'this folder'} yet`
          const note = searching
            ? 'Search runs over sender, subject and the beginning of each message. Try fewer words.'
            : filtered
              ? 'Every message here is the other way round. Clear the filter to see them.'
              : selectedFolder === 'inbox'
                ? 'Mail addressed to you lands here the moment it arrives. Nothing has arrived yet.'
                : selectedFolder === 'trash'
                  ? 'What you delete from any folder waits here, so a slip can be taken back.'
                  : 'Messages appear here once there are some. Nothing has been filed here yet.'
          return (
            <div className="flex flex-col items-center px-8 py-14 text-center">
              <EmptyArt kind={art} className="h-14 w-[74px] text-ink-4" />
              <p className="display mt-4 text-[17px] text-ink-1">{heading}</p>
              <p className="mt-1.5 max-w-[36ch] text-[12.5px] leading-relaxed text-ink-3">{note}</p>
            </div>
          )
        })()}

        </div>

        {hasMore && (
          <div className="mx-auto w-full max-w-[1040px] px-4 py-3">
            <button
              type="button"
              onClick={onLoadMore}
              disabled={loading}
              className="w-full rounded-lg border border-line py-2.5 text-[12.5px] text-ink-2 transition-colors duration-120 hover:border-line-strong hover:text-ink-1 disabled:opacity-50"
            >
              {loading ? 'Loading…' : 'Load older mail'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default EmailList
