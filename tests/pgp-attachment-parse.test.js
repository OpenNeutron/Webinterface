import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseEmail } from '@/emailParser'
import { isPgpAttachment } from '@/components/email/PgpAttachment'

// The exact shape the compose path now emits: an armored body plus one
// application/pgp-encrypted part carrying the encrypted file.
const MIME = [
  'From: tibs@slothlee.xyz',
  'To: tibs@slothlee.xyz',
  'Subject: PGP attachment transport check',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="BOUND1"',
  '',
  '--BOUND1',
  'Content-Type: text/plain; charset=utf-8',
  '',
  '-----BEGIN PGP MESSAGE-----',
  '',
  'body-ciphertext',
  '-----END PGP MESSAGE-----',
  '--BOUND1',
  'Content-Type: application/pgp-encrypted; name="report.pdf.asc"',
  'Content-Transfer-Encoding: base64',
  'Content-Disposition: attachment; filename="report.pdf.asc"',
  '',
  'LS0tLS1CRUdJTiBQR1AgTUVTU0FHRQotLS0tLQo=',
  '--BOUND1--',
  '',
].join('\r\n')

describe('parsing an OpenPGP mail with an encrypted attachment', () => {
  it('keeps the attachment with its name and type', () => {
    const parsed = parseEmail(MIME)
    expect(parsed.attachments).toHaveLength(1)
    expect(parsed.attachments[0].name).toBe('report.pdf.asc')
    expect(parsed.attachments[0].contentType).toBe('application/pgp-encrypted')
    // the parser decodes the transfer encoding, so data is armored text already
    expect(parsed.attachments[0].data).toContain('BEGIN PGP MESSAGE')
  })

  it('is recognised as an encrypted attachment by the reader', () => {
    const parsed = parseEmail(MIME)
    expect(isPgpAttachment(parsed.attachments[0])).toBe(true)
    expect(isPgpAttachment({ name: 'photo.png', contentType: 'image/png' })).toBe(false)
  })

  it('still shows the armored body so the message can be decrypted', () => {
    const parsed = parseEmail(MIME)
    expect(parsed.textBody).toContain('BEGIN PGP MESSAGE')
  })
})
