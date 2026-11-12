import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EmailListItem } from '@/components/email/EmailListItem'

// Seen on a wide inbox (1440px): every row before today prints no time inside its day
// group, and those rows dropped the 16px column gap with it — so their subjects started
// left of the subjects above them. On a wide row the subject is its own column, and the
// gap has to stay whether or not a time is printed. On a phone the subject is a second
// line, and an empty time cell still costs the sender nothing.

const handlers = {
  onSelect: vi.fn(), onCheck: vi.fn(), onMarkRead: vi.fn(), onMarkUnread: vi.fn(), onToggleStar: vi.fn(),
  onDeleteEmail: vi.fn(), onMoveToGroup: vi.fn(), onRemoveFromGroup: vi.fn(),
}

function row(date) {
  render(
    <EmailListItem
      compactTime
      uid="u1"
      preview={{ subject: 'Invoice 2026-11', from: { name: 'Hetzner Online', address: 'billing@hetzner.example' }, date, preview: 'Amount due' }}
      isSelected={false}
      isChecked={false}
      isUnread
      isStarred={false}
      groups={[]}
      selectedFolder="inbox"
      {...handlers}
    />,
  )
  return screen.getByText('Invoice 2026-11').closest('.grid')
}

describe('mail row columns', () => {
  it('a row from yesterday keeps the wide-row gap, so its subject lines up with today’s', () => {
    const grid = row(new Date(Date.now() - 36 * 3600 * 1000))
    expect(grid.className).toContain('gap-x-0')
    expect(grid.className).toContain('@[520px]:gap-x-4')
  })

  it('a row from today prints its time and keeps the gap everywhere', () => {
    const grid = row(new Date())
    expect(grid.className).toContain('gap-x-4')
    expect(grid.className).not.toContain('gap-x-0')
  })
})
