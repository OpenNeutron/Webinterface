import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { Trash2, MailOpen, Mail, Folder, ChevronLeft, ChevronRight, RefreshCw, Check, Undo2 } from 'lucide-react'

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'read', label: 'Read' },
]

/**
 * One toolbar for the list.
 *
 * Bulk actions only exist while something is selected — an always-present row of
 * disabled icons reads as broken furniture. The pager only exists when there is a
 * second page, because "1–6 of 6" with two dead chevrons is furniture too.
 */
export function EmailToolbar({
  pagedUids,
  checkedUids,
  totalFiltered,
  pageStart,
  pageEnd,
  safePage,
  pageCount,
  hasMore,
  groups,
  filterMode = 'all',
  onFilterModeChange,
  onToggleSelectAll,
  allChecked = false,
  onDeleteSelected,
  // Trash: Restore appears, and Delete says it is for good.
  onRestoreSelected = null,
  onMarkSelectedRead,
  onMarkSelectedUnread,
  onMoveSelectedToGroup,
  onPrevPage,
  onNextPage,
  onRefresh,
  refreshing,
}) {
  const selected = checkedUids.size
  const showPager = pageCount > 1 || hasMore

  const action = 'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] transition-colors duration-120'

  return (
    <div className="border-b border-line">
      <div className="mx-auto flex w-full max-w-[1040px] items-center gap-3 px-4 py-1.5">
        <div className="flex w-full items-center gap-3">
      {/* Selecting is the way to every bulk action, so the control that starts it is always
          visible while there are rows — a checkbox that only appears on hover is a feature
          nobody finds, and on a phone there is no hover at all. */}
      {pagedUids.length > 0 && (
        <button
          type="button"
          onClick={onToggleSelectAll}
          aria-pressed={allChecked}
          aria-label={allChecked
            ? `Clear the selection of ${pagedUids.length} message${pagedUids.length !== 1 ? 's' : ''}`
            : `Select all ${pagedUids.length} message${pagedUids.length !== 1 ? 's' : ''} on this page`}
          title={allChecked ? 'Clear the selection' : `Select the ${pagedUids.length} messages on this page`}
          className="flex shrink-0 items-center gap-1.5 rounded-md py-1 pl-1 pr-1.5 text-[11.5px] text-ink-3 transition-colors duration-120 hover:bg-accent hover:text-ink-1 max-sm:min-h-11 max-sm:min-w-11 max-sm:justify-center max-sm:px-2"
        >
          <span
            className={`flex size-4 shrink-0 items-center justify-center rounded border transition-colors duration-120 max-sm:size-5 ${
              allChecked ? 'border-primary bg-primary' : 'border-ink-4/70 bg-transparent'
            }`}
          >
            {allChecked && <Check className="size-2.5 text-primary-foreground" strokeWidth={3} />}
          </span>
          <span className="hidden sm:inline">{allChecked ? 'Clear' : 'Select all'}</span>
          {!allChecked && <span className="mono text-ink-4 max-sm:hidden">{pagedUids.length}</span>}
        </button>
      )}
      {selected === 0 ? (
        <div className="flex items-center gap-1" role="tablist" aria-label="Filter messages">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filterMode === f.id}
              onClick={() => onFilterModeChange?.(f.id)}
              className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors duration-120 max-sm:min-h-11 max-sm:min-w-11 max-sm:px-3 ${
                filterMode === f.id
                  ? 'bg-secondary text-ink-1'
                  : 'text-ink-3 hover:bg-accent hover:text-ink-2'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <span className="mr-1 mono whitespace-nowrap text-[11.5px] text-ink-2">{selected} selected</span>
          <button
            type="button"
            onClick={onMarkSelectedRead}
            className={`${action} text-ink-2 hover:bg-accent hover:text-ink-1`}
            title="Mark as read"
            aria-label="Mark selected as read"
          >
            <MailOpen className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onMarkSelectedUnread}
            className={`${action} text-ink-2 hover:bg-accent hover:text-ink-1`}
            title="Mark as unread"
            aria-label="Mark selected as unread"
          >
            <Mail className="size-3.5" />
          </button>
          {groups.length > 0 && (
            <DropdownMenuRoot>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={`${action} text-ink-2 hover:bg-accent hover:text-ink-1`}
                  title="Move to group"
                  aria-label="Move selected to a group"
                >
                  <Folder className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {groups.map((g) => (
                  <DropdownMenuItem key={g.uid} onClick={() => onMoveSelectedToGroup(g.uid)}>
                    <Folder className="size-4" /> {g.title}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenuRoot>
          )}
          {onRestoreSelected && (
            <button
              type="button"
              onClick={onRestoreSelected}
              className={`${action} text-ink-2 hover:bg-accent hover:text-ink-1`}
              title={`Restore ${selected} selected message${selected !== 1 ? 's' : ''}`}
              aria-label={`Restore ${selected} selected message${selected !== 1 ? 's' : ''}`}
            >
              <Undo2 className="size-3.5" />
              <span className="hidden font-medium sm:inline">Restore {selected}</span>
            </button>
          )}
          {/* Destructive: colour, never size or fill. The count rides the label, because
              "delete" alone does not say how much. */}
          <button
            type="button"
            onClick={onDeleteSelected}
            className={`${action} text-destructive hover:bg-destructive/10`}
            title={`${onRestoreSelected ? 'Delete for good' : 'Delete'} ${selected} selected message${selected !== 1 ? 's' : ''}`}
            aria-label={`${onRestoreSelected ? 'Delete for good' : 'Delete'} ${selected} selected message${selected !== 1 ? 's' : ''}`}
          >
            <Trash2 className="size-3.5" />
            <span className="hidden font-medium sm:inline">{onRestoreSelected ? 'Delete for good' : 'Delete'} {selected}</span>
          </button>
        </div>
      )}

      <div className="ml-auto flex items-center gap-2">
        {showPager && (
          <>
            <span className="mono text-[11.5px] text-ink-3">
              {pageStart}–{pageEnd} of {totalFiltered}
            </span>
            <div className="flex items-center">
              <button
                type="button"
                aria-label="Previous page"
                className="rounded p-1 text-ink-3 transition-colors duration-120 hover:bg-accent hover:text-ink-1 disabled:opacity-30"
                disabled={safePage === 0}
                onClick={onPrevPage}
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Next page"
                className="rounded p-1 text-ink-3 transition-colors duration-120 hover:bg-accent hover:text-ink-1 disabled:opacity-30"
                disabled={safePage >= pageCount - 1 && !hasMore}
                onClick={onNextPage}
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          </>
        )}
        {!showPager && totalFiltered > 0 && (
          <span className="mono shrink-0 whitespace-nowrap text-[11.5px] text-ink-3 max-sm:hidden">
            {totalFiltered} {totalFiltered === 1 ? 'message' : 'messages'}
          </span>
        )}
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Refresh"
          className="rounded p-1.5 text-ink-3 transition-colors duration-120 hover:bg-accent hover:text-ink-1 disabled:opacity-40 max-sm:p-2.5"
        >
          <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
        </div>
        </div>
      </div>
    </div>
  )
}
