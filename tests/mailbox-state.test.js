import { describe, it, expect } from 'vitest'
import { mergeServerFlags, folderCounts } from '@/lib/mailboxState'

describe('adopting read/starred state from the server', () => {
  it('a fresh browser with no local meta shows the server truth, not "everything unread"', () => {
    const merged = mergeServerFlags({}, [
      { uid: '111', read: true, starred: true },
      { uid: '222', read: false, starred: false },
    ])
    expect(merged['111']).toMatchObject({ unread: false, starred: true })
    expect(merged['222']).toMatchObject({ unread: true, starred: false })
  })

  it('server flags win over a stale local cache', () => {
    const local = { '111': { unread: true, starred: false, subject: 'cached' } }
    const merged = mergeServerFlags(local, [{ uid: 111, read: true, starred: true }])
    expect(merged['111'].unread).toBe(false)
    expect(merged['111'].starred).toBe(true)
    // unrelated cached fields survive
    expect(merged['111'].subject).toBe('cached')
  })

  it('keeps messages the server did not mention', () => {
    const merged = mergeServerFlags({ '999': { unread: true } }, [{ uid: '111', read: true, starred: false }])
    expect(merged['999']).toEqual({ unread: true })
    expect(merged['111'].unread).toBe(false)
  })

  it('never mutates the input', () => {
    const local = { '111': { unread: true } }
    mergeServerFlags(local, [{ uid: '111', read: true, starred: true }])
    expect(local['111']).toEqual({ unread: true })
  })

  it('tolerates an empty or missing response', () => {
    expect(mergeServerFlags({}, [])).toEqual({})
    expect(mergeServerFlags(undefined, undefined)).toEqual({})
    expect(mergeServerFlags({ a: 1 }, [{ uid: null, read: true }])).toEqual({ a: 1 })
  })

  it('counts unread and starred from the merged state', () => {
    const meta = {
      '1': { unread: false, starred: true },
      '2': { unread: true, starred: false },
      '3': {},
    }
    expect(folderCounts(meta, ['1', '2', '3'])).toEqual({ unread: 2, starred: 1 })
  })
})
