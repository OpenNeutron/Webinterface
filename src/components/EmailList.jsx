import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, Check, ChevronDown, ChevronRight, Minus, RefreshCw, Trash2 } from 'lucide-react'
import EmptyArt from '@/components/EmptyArt'
import { EmailListItem, EmailRowSkeleton, dayBucket, rowTime } from '@/components/email/EmailListItem'
import { buildThreads } from '@/lib/threads'
import { SenderAvatar } from '@/components/SenderAvatar'
import { SwipeRow } from '@/components/email/SwipeRow'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'

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
  // Selects (or clears) every message in a conversation at once.
  onCheckThread = null,
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
  // Pull down from the top of the list to refresh (touch screens).
  onRefresh = null,
}) => {
  const scroller = useRef(null)
  const { pull, busy, ready } = usePullToRefresh(scroller, onRefresh)

  // Reaching the end of the list loads the next older page, the way a phone mail app scrolls on
  // forever. Also when the end is on screen from the start: twenty alerts folded into one
  // conversation leave a nearly empty screen, and older mail should fill it without a press.
  const endMarker = useRef(null)
  const loadMoreRef = useRef(onLoadMore)
  useEffect(() => {
    loadMoreRef.current = onLoadMore
  }, [onLoadMore])
  useEffect(() => {
    const el = endMarker.current
    if (!el || !hasMore || loading || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMoreRef.current?.()
      },
      { root: scroller.current, rootMargin: '0px 0px 400px 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, loading, uids.length])
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

  // In Trash a delete is for good (and asks first); everywhere else it moves to Trash.
  const swipeLabel = selectedFolder === 'trash' ? 'Delete for good' : 'Delete'
  const toggleThread = (uids) => {
    if (onCheckThread) onCheckThread(uids)
    else uids.forEach((uid) => onCheck(uid))
  }

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
    <div className="relative flex h-full flex-col bg-background">
      {(pull > 0 || busy) && (
        <div
          data-testid="pull-indicator"
          aria-live="polite"
          className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center"
          style={{ transform: `translateY(${Math.max(0, pull - 40)}px)` }}
        >
          <span className="mt-2 flex items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1.5 text-[12px] text-ink-2 shadow-sm">
            {busy
              ? <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
              : <ArrowDown className={`size-3.5 transition-transform duration-120 ${ready ? 'rotate-180' : ''}`} aria-hidden="true" />}
            {busy ? 'Checking for mail…' : ready ? 'Release to refresh' : 'Pull to refresh'}
          </span>
        </div>
      )}
      {/* overscroll-contain: the browser's own pull-to-refresh reloads the whole app, which
          throws away the unlocked key and asks for the password again. */}
      <div
        ref={scroller}
        className="custom-scrollbar flex-1 overflow-y-auto overscroll-y-contain"
        style={pull ? { transform: `translateY(${pull * 0.5}px)` } : undefined}
      >
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
                  <SwipeRow
                    key={thread.latestUid}
                    className="border-b border-line/70"
                    label={swipeLabel}
                    onSwipe={() => onDeleteEmail(thread.latestUid)}
                    onLongPress={() => onCheck(thread.latestUid)}
                  >
                    <EmailListItem {...rowProps(thread.latestUid)} isFresh={fresh.has(thread.latestUid)} />
                  </SwipeRow>
                )
              }

              const open = expandedThreads.has(thread.key)
              const latest = previews[thread.latestUid] || {}
              const selectedInThread = thread.uids.includes(selectedUid)
              const participants = thread.participants.slice(0, 3).join(', ')
              const checkedCount = thread.uids.filter((uid) => checkedUids?.has(uid)).length
              const allChecked = checkedCount === thread.uids.length
              const toggleOpen = () => {
                setExpandedThreads((prev) => {
                  const next = new Set(prev)
                  if (next.has(thread.key)) next.delete(thread.key)
                  else next.add(thread.key)
                  return next
                })
                onSelect(thread.latestUid)
              }

              return (
                <div key={thread.key} data-testid="thread-group" className="group/thread relative border-b border-line/70">
                  <SwipeRow
                    label={swipeLabel}
                    onSwipe={onDeleteThread ? () => onDeleteThread(thread.uids) : null}
                    onLongPress={() => toggleThread(thread.uids)}
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      aria-expanded={open}
                      onClick={toggleOpen}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          toggleOpen()
                        }
                      }}
                      className={`relative flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors duration-120 ${
                        checkedCount ? 'bg-sand/10' : selectedInThread ? 'bg-primary/[0.07]' : 'hover:bg-accent'
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`absolute inset-y-0 left-0 w-[2px] ${
                          selectedInThread ? 'bg-primary' : 'bg-transparent'
                        }`}
                      />
                      {/* The same box, in the same column, as a single message: a conversation
                          could not be selected before, so it could not be deleted in bulk. */}
                      <div className="flex w-4 shrink-0 items-center justify-center self-stretch max-sm:w-11">
                        <button
                          type="button"
                          aria-label={allChecked
                            ? `Unselect conversation (${thread.count} messages)`
                            : `Select conversation (${thread.count} messages)`}
                          aria-pressed={allChecked}
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleThread(thread.uids)
                          }}
                          className="flex items-center justify-center max-sm:min-h-11 max-sm:min-w-11"
                        >
                          <span
                            className={`flex size-4 items-center justify-center rounded border transition-all duration-120 max-sm:size-5 ${
                              checkedCount ? 'border-primary bg-primary' : 'border-ink-4/60 hover:border-ink-2'
                            }`}
                          >
                            {allChecked && <Check className="size-2.5 text-primary-foreground" strokeWidth={3} />}
                            {checkedCount > 0 && !allChecked && <Minus className="size-2.5 text-primary-foreground" strokeWidth={3} />}
                          </span>
                        </button>
                      </div>
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
                          <span className="mono flex shrink-0 items-center gap-0.5 self-center rounded bg-secondary pl-1.5 pr-0.5 text-[10.5px] text-ink-2">
                            {thread.count}
                            {open ? <ChevronDown className="size-3" aria-hidden="true" /> : <ChevronRight className="size-3" aria-hidden="true" />}
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
                      {onDeleteThread && (
                        /* Over the time, like a single row's actions: hovering moves nothing. A
                           finger swipes instead, so there is no invisible button to hit. */
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            onDeleteThread(thread.uids)
                          }}
                          className="absolute right-3 top-3 rounded-md border border-line bg-card/95 p-1.5 text-ink-3 opacity-0 shadow-sm transition-opacity duration-120 hover:text-destructive focus-visible:opacity-100 group-hover/thread:opacity-100 pointer-coarse:hidden"
                          title={`Delete all ${thread.count} messages in this conversation`}
                          aria-label={`Delete conversation (${thread.count} messages)`}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </SwipeRow>

                  {open && (
                    <div className="ml-4 border-l border-line">
                      {thread.uids.map((uid) => (
                        <SwipeRow
                          key={uid}
                          label={swipeLabel}
                          onSwipe={() => onDeleteEmail(uid)}
                          onLongPress={() => onCheck(uid)}
                        >
                          <EmailListItem {...rowProps(uid)} isFresh={fresh.has(uid)} />
                        </SwipeRow>
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
          <div ref={endMarker} className="mx-auto w-full max-w-[1040px] px-4 py-3">
            <button
              type="button"
              onClick={onLoadMore}
              disabled={loading}
              className="w-full rounded-lg border border-line py-2.5 text-[12.5px] text-ink-2 transition-colors duration-120 hover:border-line-strong hover:text-ink-1 disabled:opacity-50 max-sm:min-h-11"
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
