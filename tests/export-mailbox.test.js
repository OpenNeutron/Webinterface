import { describe, it, expect, vi } from 'vitest'
import { toMbox, exportMailbox } from '@/lib/exportMailbox'

describe('toMbox', () => {
  it('separates messages with a From line', () => {
    const out = toMbox([{ raw: 'Subject: a\n\nhi', from: 'a@b.c', date: 'Mon Jan 1' }, { raw: 'Subject: b\n\nho' }])
    expect(out.startsWith('From a@b.c Mon Jan 1\n')).toBe(true)
    expect(out.match(/^From /gm).length).toBe(2)
  })

  it('escapes "From " at the start of body lines', () => {
    const out = toMbox([{ raw: 'Subject: a\n\nFrom the desk of X' }])
    expect(out).toContain('>From the desk of X')
  })

  it('does not add a separator for a mid-line "From"', () => {
    const out = toMbox([{ raw: 'Subject: a\n\nsent From here' }])
    expect(out).toContain('sent From here')
  })
})

describe('exportMailbox', () => {
  it('collects everything and reports failures without aborting', async () => {
    const list = vi.fn(async () => [1, 2, 3])
    const get = vi.fn(async (uid) => ({ data: `ct${uid}`, message_key: `k${uid}` }))
    const decrypt = vi.fn(async (data) => {
      if (data === 'ct2') throw new Error('cannot decrypt')
      return `Subject: m${data}\n\nbody`
    })
    const res = await exportMailbox({ list, get, decrypt, privateKey: 'pk' })
    expect(res.total).toBe(2)
    expect(res.failed).toEqual([2])
    expect(res.mbox).toContain('Subject: mct1')
    expect(res.mbox).toContain('Subject: mct3')
  })
})
