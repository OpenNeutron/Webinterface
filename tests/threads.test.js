import { describe, it, expect } from 'vitest'
import { buildThreads, normalizeSubject } from '@/lib/threads'

const day = 24 * 60 * 60 * 1000
const base = new Date('2026-10-01T10:00:00Z').getTime()
const at = (offsetDays) => new Date(base + offsetDays * day)

const msg = (over) => ({
  uid: `u${Math.random().toString(36).slice(2, 8)}`,
  messageId: null,
  inReplyTo: '',
  references: '',
  subject: '',
  date: at(0),
  from: { address: 'a@example.com' },
  ...over,
})

describe('normalizeSubject', () => {
  it('strips reply and forward prefixes, repeatedly', () => {
    expect(normalizeSubject('Re: Hello')).toBe('hello')
    expect(normalizeSubject('RE: Re: Fwd: Hello')).toBe('hello')
    expect(normalizeSubject('AW:   Hello  ')).toBe('hello')
    expect(normalizeSubject('Re[2]: Hello')).toBe('hello')
    expect(normalizeSubject('Hello')).toBe('hello')
  })

  it('leaves subjects that merely start with those letters alone', () => {
    expect(normalizeSubject('Review notes')).toBe('review notes')
    expect(normalizeSubject('Awesome news')).toBe('awesome news')
  })
})

describe('buildThreads', () => {
  it('links a reply to its parent through References', () => {
    const a = msg({ uid: 'a', messageId: '<1@x>', subject: 'Plan', date: at(0) })
    const b = msg({ uid: 'b', messageId: '<2@x>', inReplyTo: '<1@x>', references: '<1@x>', subject: 'Re: Plan', date: at(1) })
    const threads = buildThreads([b, a])
    expect(threads).toHaveLength(1)
    expect(threads[0].uids).toEqual(['a', 'b']) // oldest first
    expect(threads[0].latestUid).toBe('b')
    expect(threads[0].count).toBe(2)
  })

  it('joins a whole chain even when only the deepest reference matches', () => {
    const a = msg({ uid: 'a', messageId: '<1@x>', subject: 'Plan' })
    const b = msg({ uid: 'b', messageId: '<2@x>', references: '<1@x>', subject: 'Re: Plan', date: at(1) })
    const c = msg({ uid: 'c', messageId: '<3@x>', references: '<1@x> <2@x>', subject: 'Re: Plan', date: at(2) })
    const threads = buildThreads([c, a, b])
    expect(threads).toHaveLength(1)
    expect(threads[0].uids).toEqual(['a', 'b', 'c'])
  })

  it('does not merge unrelated conversations that share a subject across months', () => {
    const a = msg({ uid: 'a', subject: 'Invoice', date: at(0) })
    const b = msg({ uid: 'b', subject: 'Re: Invoice', date: at(120) })
    const threads = buildThreads([a, b])
    expect(threads).toHaveLength(2)
  })

  it('does not merge the same subject from different senders', () => {
    const a = msg({ uid: 'a', subject: 'Hello', from: { address: 'a@x.com' } })
    const b = msg({ uid: 'b', subject: 'Re: Hello', from: { address: 'b@y.com' }, date: at(1) })
    expect(buildThreads([a, b])).toHaveLength(2)
  })

  it('falls back to subject + sender when headers are missing entirely', () => {
    const a = msg({ uid: 'a', subject: 'Lunch', date: at(0) })
    const b = msg({ uid: 'b', subject: 'RE: Lunch', date: at(1) })
    const threads = buildThreads([a, b])
    expect(threads).toHaveLength(1)
    expect(threads[0].count).toBe(2)
  })

  it('orders conversations by their newest message', () => {
    const old = msg({ uid: 'old', subject: 'Old', date: at(0) })
    const newA = msg({ uid: 'n1', messageId: '<9@x>', subject: 'New', date: at(10) })
    const newB = msg({ uid: 'n2', messageId: '<10@x>', references: '<9@x>', subject: 'Re: New', date: at(11) })
    const threads = buildThreads([old, newA, newB])
    expect(threads).toHaveLength(2)
    expect(threads[0].latestUid).toBe('n2')
    expect(threads[1].latestUid).toBe('old')
  })

  it('counts unread messages per conversation', () => {
    const a = msg({ uid: 'a', messageId: '<1@x>', subject: 'Plan' })
    const b = msg({ uid: 'b', messageId: '<2@x>', references: '<1@x>', subject: 'Re: Plan', date: at(1) })
    const threads = buildThreads([a, b], { unreadByUid: { b: true } })
    expect(threads[0].unreadCount).toBe(1)
  })

  it('keeps a single message as a one-item thread with a stable key', () => {
    const a = msg({ uid: 'only', messageId: '<solo@x>', subject: 'Solo' })
    const threads = buildThreads([a])
    expect(threads).toHaveLength(1)
    expect(threads[0].count).toBe(1)
    expect(threads[0].key).toBe('solo@x')
  })

  it('survives messages with no headers and no date', () => {
    const a = msg({ uid: 'a', subject: 'x', date: undefined })
    const threads = buildThreads([a])
    expect(threads).toHaveLength(1)
  })

  it('returns nothing for an empty list', () => {
    expect(buildThreads([])).toEqual([])
  })
})
