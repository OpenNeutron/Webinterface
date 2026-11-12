import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/pgp', () => ({
  looksEncrypted: (t) => typeof t === 'string' && t.includes('-----BEGIN PGP MESSAGE-----'),
  decryptBody: vi.fn(),
  hasIdentity: () => true,
}))

import { EmailBody } from '@/components/email/EmailBody'

const ARMOR = '-----BEGIN PGP MESSAGE-----\n\nhQEMA...\n-----END PGP MESSAGE-----'

describe('EmailBody with encrypted mail', () => {
  it('routes armour to the PGP reader even when an htmlBody exists', async () => {
    render(<EmailBody textBody={ARMOR} htmlBody={`<div>${ARMOR}</div>`} senderHint="tibs@slothlee.xyz" />)
    // The reader loads with the OpenPGP library; until then it says so, never the ciphertext.
    expect(screen.getByText(/Opening the encrypted message/)).toBeTruthy()
    // The PGP reader asks for the passphrase rather than showing ciphertext.
    expect(await screen.findByText(/PGP passphrase/i)).toBeTruthy()
    // PgpBody also shows the original armour beneath the prompt, deliberately:
    // it lets someone verify what was actually received.
    expect(screen.getByText(/BEGIN PGP MESSAGE/)).toBeTruthy()
  })

  it('still renders ordinary mail normally', () => {
    render(<EmailBody textBody="just a normal message" htmlBody={null} senderHint="x@y.z" />)
    expect(screen.getByText('just a normal message')).toBeTruthy()
  })
})
