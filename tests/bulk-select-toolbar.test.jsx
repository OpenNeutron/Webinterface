import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EmailToolbar } from '@/components/EmailToolbar'

// Two controls that were unreachable before: selecting every row on the page, and a delete that
// says how much it will delete. The per-row checkbox existed but was invisible without hover and
// hidden entirely on a phone, and the select-all handler was written but never passed to the bar.
const baseProps = {
  pagedUids: ['a', 'b', 'c'],
  checkedUids: new Set(),
  totalFiltered: 3,
  pageStart: 1,
  pageEnd: 3,
  safePage: 0,
  pageCount: 1,
  hasMore: false,
  groups: [],
  filterMode: 'all',
  onFilterModeChange: vi.fn(),
  onToggleSelectAll: vi.fn(),
  allChecked: false,
  onDeleteSelected: vi.fn(),
  onMarkSelectedRead: vi.fn(),
  onMarkSelectedUnread: vi.fn(),
  onMoveSelectedToGroup: vi.fn(),
  onPrevPage: vi.fn(),
  onNextPage: vi.fn(),
  onRefresh: vi.fn(),
  refreshing: false,
}

describe('bulk selection toolbar', () => {
  it('offers select-all with the page count while nothing is selected', () => {
    render(<EmailToolbar {...baseProps} />)
    const button = screen.getByRole('button', { name: /select all 3 messages on this page/i })
    expect(button).toBeTruthy()
    expect(button.textContent).toContain('Select all')
    expect(button.textContent).toContain('3')
  })

  it('calls the select-all handler when pressed', () => {
    const onToggleSelectAll = vi.fn()
    render(<EmailToolbar {...baseProps} onToggleSelectAll={onToggleSelectAll} />)
    fireEvent.click(screen.getByRole('button', { name: /select all 3 messages/i }))
    expect(onToggleSelectAll).toHaveBeenCalledTimes(1)
  })

  it('says Clear when everything on the page is checked', () => {
    render(<EmailToolbar {...baseProps} checkedUids={new Set(['a', 'b', 'c'])} allChecked />)
    const button = screen.getByRole('button', { name: /clear the selection of 3 messages/i })
    expect(button.textContent).toContain('Clear')
  })

  it('labels the delete button with the number it will delete', () => {
    const onDeleteSelected = vi.fn()
    render(<EmailToolbar {...baseProps} checkedUids={new Set(['a', 'b'])} onDeleteSelected={onDeleteSelected} />)
    const del = screen.getByRole('button', { name: /delete 2 selected messages/i })
    expect(del.textContent).toContain('Delete 2')
    fireEvent.click(del)
    expect(onDeleteSelected).toHaveBeenCalledTimes(1)
  })

  it('keeps the bulk actions out of the way until something is checked', () => {
    render(<EmailToolbar {...baseProps} />)
    expect(screen.queryByRole('button', { name: /delete 0/i })).toBeNull()
  })

  it('has no select-all when the list is empty', () => {
    render(<EmailToolbar {...baseProps} pagedUids={[]} totalFiltered={0} />)
    expect(screen.queryByRole('button', { name: /select all/i })).toBeNull()
  })
})
