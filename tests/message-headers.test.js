import { describe, it, expect } from 'vitest'
import { buildEmail } from '@/lib/emailBuilder'

describe('outgoing headers', () => {
  it('builds a valid Message-ID from a formatted From address', () => {
    const msg = buildEmail({
      from: '"Tibs" <tibs@slothlee.xyz>',
      to: ['a@example.com'],
      subject: 'x',
      body: '<p>hi</p>',
    })
    const id = msg.split('\r\n').find((l) => l.startsWith('Message-ID:'))
    expect(id).toMatch(/^Message-ID: <[^<>]+@slothlee\.xyz>$/)
    expect(id).not.toContain('>>')
  })

  it('wraps a bare fragment in a document', () => {
    const msg = buildEmail({ from: 't@x.com', to: ['a@b.c'], subject: 'x', body: '<p>hi</p>' })
    expect(msg).toMatch(/<html>/i)
    expect(msg).toMatch(/<body><p>hi<\/p><\/body>/i)
  })

  it('leaves a full document alone', () => {
    const msg = buildEmail({ from: 't@x.com', to: ['a@b.c'], subject: 'x', body: '<html><body>hi</body></html>' })
    expect(msg.match(/<html>/gi).length).toBe(1)
  })
})
