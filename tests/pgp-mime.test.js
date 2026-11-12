import { describe, it, expect } from 'vitest'
import { buildEmail } from '@/lib/emailBuilder'
import { parseEmail } from '@/emailParser'
import { looksEncrypted } from '@/pgp'

const ARMOR = [
  '-----BEGIN PGP MESSAGE-----',
  '',
  'hQEMA1234567890abcdef',
  '=abcd',
  '-----END PGP MESSAGE-----',
].join('\n')

describe('PGP/MIME', () => {
  it('wraps an armoured body in multipart/encrypted', () => {
    const msg = buildEmail({
      from: 'tibs@slothlee.xyz',
      to: ['sam@mastertibbles.co.uk'],
      subject: 'Test',
      body: ARMOR,
    })
    expect(msg).toContain('Content-Type: multipart/encrypted')
    expect(msg).toContain('protocol="application/pgp-encrypted"')
    expect(msg).toContain('Version: 1')
    expect(msg).toContain('application/octet-stream')
  })

  it('sends ordinary mail as text/html, not PGP/MIME', () => {
    const msg = buildEmail({ from: 'tibs@slothlee.xyz', to: ['a@b.c'], subject: 'Hi', body: '<p>hello</p>' })
    expect(msg).toContain('Content-Type: text/html')
    expect(msg).not.toContain('multipart/encrypted')
  })

  it('round-trips: a PGP/MIME message parses back to the armour', () => {
    const msg = buildEmail({ from: 'tibs@slothlee.xyz', to: ['sam@mastertibbles.co.uk'], subject: 'T', body: ARMOR })
    const parsed = parseEmail(msg)
    expect(parsed.textBody).toContain('BEGIN PGP MESSAGE')
    expect(looksEncrypted(parsed.textBody)).toBe(true)
  })

  it('does not mistake the Version part for the message body', () => {
    const msg = buildEmail({ from: 'tibs@slothlee.xyz', to: ['sam@mastertibbles.co.uk'], subject: 'T', body: ARMOR })
    const parsed = parseEmail(msg)
    expect(parsed.textBody.startsWith('-----BEGIN PGP MESSAGE-----')).toBe(true)
    expect(parsed.textBody).not.toContain('Version: 1')
  })
})
