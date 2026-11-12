import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EmailToolbar } from '@/components/EmailToolbar'

// The pager used to say "1–20 of 20" while five more messages sat behind "Load older mail" —
// 20 was the number loaded, not the number in the mailbox. A count that cannot be known must
// not be asserted.
const props = {
  pagedUids: Array.from({ length: 20 }, (_, i) => `u${i}`),
  checkedUids: new Set(),
  totalFiltered: 20,
  pageStart: 1,
  pageEnd: 20,
  safePage: 0,
  pageCount: 1,
  hasMore: false,
  groups: [],
  filterMode: 'all',
  onFilterModeChange: vi.fn(),
  onToggleSelectAll: vi.fn(),
  onDeleteSelected: vi.fn(),
  onMarkSelectedRead: vi.fn(),
  onMarkSelectedUnread: vi.fn(),
  onMoveSelectedToGroup: vi.fn(),
  onPrevPage: vi.fn(),
  onNextPage: vi.fn(),
  onRefresh: vi.fn(),
  refreshing: false,
}

describe('pager wording', () => {
  it('says how many of the total when the mailbox has been read to the end', () => {
    render(<EmailToolbar {...props} totalFiltered={40} pageCount={2} />)
    expect(screen.getByText('1–20 of 40')).toBeTruthy()
  })

  it('marks the range open-ended when more mail exists, instead of claiming a total', () => {
    render(<EmailToolbar {...props} hasMore pageCount={2} />)
    expect(screen.getByText('1–20+')).toBeTruthy()
    expect(screen.queryByText(/of 20/)).toBeNull()
  })

  it('shows no pager for a single page that ends the mailbox', () => {
    render(<EmailToolbar {...props} pagedUids={['a', 'b']} totalFiltered={2} pageEnd={2} />)
    expect(screen.queryByText(/1–2/)).toBeNull()
    expect(screen.getByRole('button', { name: /refresh/i })).toBeTruthy()
  })

  // Two ways to reach the same mail is not a feature. With one page loaded, Load older mail is
  // the only growth control; the chevrons reappear when there is genuinely a second page.
  it('leaves the chevrons out while only one page is loaded, even if more mail exists', () => {
    render(<EmailToolbar {...props} hasMore />)
    expect(screen.queryByRole('button', { name: /next page/i })).toBeNull()
  })
})
