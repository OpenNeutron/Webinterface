import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// The row component is irrelevant here; this test is about the list's own
// threading render, which crashed the whole pane when a state hook was missing.
// Partial mock: EmailList also imports `dayBucket` from this module to group rows by
// day, and a mock that replaced the whole module made that import undefined — the list
// then failed at render with "No dayBucket export", which reads like a product crash.
vi.mock('@/components/email/EmailListItem', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    EmailListItem: ({ uid, preview }) => <div data-testid="mail-row">{uid}:{preview?.subject}</div>,
  }
})

import EmailList from '@/components/EmailList'

const base = new Date('2026-10-27T10:00:00Z').getTime()
const iso = (offsetMin) => new Date(base + offsetMin * 60000)

const previews = {
  a: { subject: 'Thread demo', from: { address: 'sender@example.com' }, date: iso(0), preview: 'first', messageId: '<t1@x>' },
  b: { subject: 'Re: Thread demo', from: { address: 'sender@example.com' }, date: iso(5), preview: 'second', messageId: '<t2@x>', inReplyTo: '<t1@x>', references: '<t1@x>' },
  c: { subject: 'Unrelated', from: { address: 'other@example.com' }, date: iso(9), preview: 'solo', messageId: '<x@x>' },
}

const props = {
  uids: ['a', 'b', 'c'],
  previews,
  emailMeta: { a: { unread: false }, b: { unread: true }, c: { unread: false } },
  selectedUid: null,
  checkedUids: new Set(),
  onSelect: vi.fn(),
  onCheck: vi.fn(),
  onToggleSelectAll: vi.fn(),
  loading: false,
  hasMore: false,
  onLoadMore: vi.fn(),
  onMarkRead: vi.fn(),
  onMarkUnread: vi.fn(),
  onToggleStar: vi.fn(),
  onDeleteEmail: vi.fn(),
  onMoveToGroup: vi.fn(),
  onRemoveFromGroup: vi.fn(),
  groups: [],
  folderLabel: 'Inbox',
  selectedFolder: 'inbox',
}

describe('EmailList threading render', () => {
  it('renders a conversation row for a reply pair and a plain row for the rest', () => {
    render(<EmailList {...props} />)
    const groups = screen.getAllByTestId('thread-group')
    expect(groups).toHaveLength(1)
    // the conversation shows the count of messages it holds
    expect(groups[0].textContent).toContain('2')
    expect(groups[0].textContent).toContain('Thread demo')
    // the unrelated message is still a normal row
    expect(screen.getAllByTestId('mail-row')).toHaveLength(1)
    expect(screen.getByText(/c:Unrelated/)).toBeTruthy()
  })

  it('expands a conversation to show its messages', () => {
    render(<EmailList {...props} />)
    expect(screen.queryByText(/a:Thread demo/)).toBeNull()
    fireEvent.click(screen.getByTestId('thread-group').querySelector('[aria-expanded]'))
    expect(screen.getByText(/a:Thread demo/)).toBeTruthy()
    expect(screen.getByText(/b:Re: Thread demo/)).toBeTruthy()
  })

  it('does not blank the list when every message is threaded', () => {
    render(<EmailList {...props} uids={['a', 'b']} />)
    expect(screen.getByTestId('thread-group')).toBeTruthy()
  })

  it('deletes a whole conversation from its row', () => {
    const onDeleteThread = vi.fn()
    render(<EmailList {...props} onDeleteThread={onDeleteThread} />)
    fireEvent.click(screen.getByRole('button', { name: /Delete conversation \(2 messages\)/ }))
    expect(onDeleteThread).toHaveBeenCalledWith(expect.arrayContaining(['a', 'b']))
    expect(onDeleteThread.mock.calls[0][0]).toHaveLength(2)
  })

  it('offers no conversation delete where the folder cannot delete', () => {
    render(<EmailList {...props} />)
    expect(screen.queryByRole('button', { name: /Delete conversation/ })).toBeNull()
  })
})

describe('a conversation can be selected and deleted from the list', () => {
  it('its box selects every message in it, without opening it', () => {
    const onCheckThread = vi.fn()
    const onSelect = vi.fn()
    render(<EmailList {...props} onSelect={onSelect} onCheckThread={onCheckThread} onDeleteThread={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Select conversation \(2 messages\)/ }))
    expect(onCheckThread).toHaveBeenCalledWith(['a', 'b'])
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('shows as selected when all of it is checked', () => {
    render(<EmailList {...props} checkedUids={new Set(['a', 'b'])} onCheckThread={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Unselect conversation/ }).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('older mail', () => {
  it('loads by itself when the end of the list comes into view', () => {
    const observers = []
    const original = globalThis.IntersectionObserver
    globalThis.IntersectionObserver = class {
      constructor(callback) { this.callback = callback; observers.push(this) }
      observe(el) { this.el = el }
      disconnect() {}
    }
    try {
      const onLoadMore = vi.fn()
      render(<EmailList {...props} hasMore onLoadMore={onLoadMore} />)
      expect(observers).toHaveLength(1)
      observers[0].callback([{ isIntersecting: true, target: observers[0].el }])
      expect(onLoadMore).toHaveBeenCalledTimes(1)
      // The button is still there for a browser that cannot watch.
      expect(screen.getByRole('button', { name: 'Load older mail' })).toBeTruthy()
    } finally {
      globalThis.IntersectionObserver = original
    }
  })

  it('does not watch while loading or when there is nothing older', () => {
    const observe = vi.fn()
    const original = globalThis.IntersectionObserver
    globalThis.IntersectionObserver = class { observe = observe; disconnect() {} }
    try {
      render(<EmailList {...props} hasMore={false} onLoadMore={vi.fn()} />)
      render(<EmailList {...props} hasMore loading onLoadMore={vi.fn()} />)
      expect(observe).not.toHaveBeenCalled()
    } finally {
      globalThis.IntersectionObserver = original
    }
  })
})
