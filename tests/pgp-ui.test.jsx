import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import KeysSection from '@/components/KeysSection'
import { PgpBody } from '@/components/email/PgpBody'
import { generateIdentity, encryptBody, loadRing } from '@/pgp'

const PASS = 'test passphrase 123'

beforeEach(() => {
  localStorage.clear()
})

// Key creation moved out of a modal and into Settings → OpenPGP (`KeysSection`) when
// Settings became a page. The section opens straight into the create form when this
// browser has no key, so the same three fields are still the ones a person types.
describe('OpenPGP key management', () => {
  it('creates a key from settings and lists it', async () => {
    const user = userEvent.setup()
    render(<KeysSection accountEmail="tibs@slothlee.xyz" />)

    // The address is prefilled from the account, the rest is typed.
    await user.type(screen.getByPlaceholderText('Sam Smith'), 'Tibs')
    await user.type(screen.getByPlaceholderText('At least 8 characters'), PASS)
    await user.type(screen.getByPlaceholderText('Repeat passphrase'), PASS)

    await user.click(screen.getByRole('button', { name: /create key/i }))

    await waitFor(
      () => expect(screen.getAllByText(/tibs@slothlee\.xyz/).length).toBeGreaterThan(0),
      { timeout: 25000 },
    )
    expect(loadRing().identity.fingerprint).toMatch(/^[0-9A-F]{40}$/)
    expect(screen.getAllByText(/tibs@slothlee\.xyz/).length).toBeGreaterThan(0)
  }, 30000)

  it('refuses a passphrase that is too short', async () => {
    const user = userEvent.setup()
    render(<KeysSection accountEmail="tibs@slothlee.xyz" />)

    await user.type(screen.getByPlaceholderText('Sam Smith'), 'Tibs')
    await user.type(screen.getByPlaceholderText('At least 8 characters'), 'short')
    await user.type(screen.getByPlaceholderText('Repeat passphrase'), 'short')
    await user.click(screen.getByRole('button', { name: /create key/i }))

    await waitFor(() => expect(screen.getAllByText(/at least 8 characters/i).length).toBeGreaterThan(0))
    expect(loadRing().identity).toBe(null)
  }, 20000)
})

describe('OpenPGP reader', () => {
  it('decrypts an armored message with the passphrase', async () => {
    await generateIdentity({ name: 'Tibs', email: 'tibs@slothlee.xyz', passphrase: PASS })
    const armored = await encryptBody({
      text: 'Decrypted body text',
      recipients: ['tibs@slothlee.xyz'],
      passphrase: PASS,
    })

    const user = userEvent.setup()
    render(<PgpBody armored={armored} senderHint="Tibs <tibs@slothlee.xyz>" />)

    expect(screen.getByText(/OpenPGP-encrypted message/i)).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('PGP passphrase'), PASS)
    await user.click(screen.getByRole('button', { name: /decrypt/i }))

    await waitFor(() => expect(screen.getByText('Decrypted body text')).toBeInTheDocument(), {
      timeout: 15000,
    })
    // Own key is pinned for this address, so this is a full verification;
    // the wording now names the anchor instead of a bare "verified".
    expect(screen.getByText(/signed by the key saved for this sender/i)).toBeInTheDocument()
    expect(screen.getByText(/[0-9A-F]{4} [0-9A-F]{4}/)).toBeInTheDocument()
  }, 30000)

  it('reports a wrong passphrase instead of showing the body', async () => {
    await generateIdentity({ name: 'Tibs', email: 'tibs@slothlee.xyz', passphrase: PASS })
    const armored = await encryptBody({
      text: 'Secret',
      recipients: ['tibs@slothlee.xyz'],
      passphrase: PASS,
    })

    const user = userEvent.setup()
    render(<PgpBody armored={armored} />)

    await user.type(screen.getByPlaceholderText('PGP passphrase'), 'not-the-passphrase')
    await user.click(screen.getByRole('button', { name: /decrypt/i }))

    await waitFor(() => expect(screen.getByText(/wrong passphrase/i)).toBeInTheDocument(), {
      timeout: 15000,
    })
    expect(screen.queryByText(/Decrypted ·/)).toBe(null)
  }, 30000)
})

describe('OpenPGP .asc file import', () => {
  it('imports a private key file and can then decrypt with it', async () => {
    const { importKeyFile, encryptBody, loadRing } = await import('@/pgp')
    // Export the identity produced above as a file body, then import it fresh.
    const id = await generateIdentity({ name: 'Tibs', email: 'tibs@slothlee.xyz', passphrase: PASS })
    const exported = id.privateKey
    localStorage.clear()

    const result = await importKeyFile(exported)
    expect(result.kind).toBe('private')
    expect(loadRing().identity.email).toBe('tibs@slothlee.xyz')
    expect(loadRing().identity.fingerprint).toBe(id.fingerprint)

    const armored = await encryptBody({ text: 'reading with an imported key', recipients: ['tibs@slothlee.xyz'], passphrase: PASS })
    const user = userEvent.setup()
    render(<PgpBody armored={armored} />)
    await user.type(screen.getByPlaceholderText('PGP passphrase'), PASS)
    await user.click(screen.getByRole('button', { name: /decrypt/i }))
    await waitFor(() => expect(screen.getByText('reading with an imported key')).toBeInTheDocument(), { timeout: 15000 })
  }, 40000)

  it('imports a public key file as a contact', async () => {
    const { importKeyFile, listContacts } = await import('@/pgp')
    const friend = await generateIdentity({ name: 'Friend', email: 'friend@example.org', passphrase: 'another passphrase' })
    const pub = friend.publicKey
    localStorage.clear()

    const result = await importKeyFile(pub)
    expect(result).toEqual({ kind: 'public', email: 'friend@example.org' })
    expect(listContacts().map(c => c.email)).toContain('friend@example.org')
  }, 30000)

  it('rejects a random file', async () => {
    const { importKeyFile } = await import('@/pgp')
    await expect(importKeyFile('hello world')).rejects.toThrow(/not a PGP key/i)
  })

  it('rejects a passphrase-less private key', async () => {
    const { importKeyFile } = await import('@/pgp')
    const openpgp = await import('openpgp')
    const { privateKey } = await openpgp.generateKey({
      type: 'ecc', curve: 'curve25519Legacy',
      userIDs: [{ name: 'No Pass', email: 'nopass@example.org' }],
      format: 'armored',
    })
    await expect(importKeyFile(privateKey)).rejects.toThrow(/passphrase/i)
  }, 30000)
})

describe('OpenPGP file picker', () => {
  it('imports a key chosen through the file input', async () => {
    const { generateIdentity, loadRing } = await import('@/pgp')
    const id = await generateIdentity({ name: 'Tibs', email: 'tibs@slothlee.xyz', passphrase: PASS })
    const armoredPublic = id.publicKey
    localStorage.clear()

    const user = userEvent.setup()
    const { container } = render(<KeysSection accountEmail="tibs@slothlee.xyz" />)
    const input = container.querySelector('input[type="file"]')
    expect(input).toBeTruthy()

    const file = new File([armoredPublic], 'tibs-public.asc', { type: 'application/pgp-keys' })
    await user.upload(input, file)

    await waitFor(
      () => expect(screen.getByText(/imported a public key for tibs@slothlee\.xyz/i)).toBeInTheDocument(),
      { timeout: 15000 },
    )
    expect(loadRing().contacts['tibs@slothlee.xyz'].armored).toContain('BEGIN PGP PUBLIC KEY BLOCK')
    expect(loadRing().contacts['tibs@slothlee.xyz'].fingerprint).toMatch(/^[0-9A-F]{40}$/)
  }, 30000)
})

describe('OpenPGP attachments', () => {
  it('round-trips arbitrary bytes through encrypt then decrypt', async () => {
    const { encryptAttachment, decryptAttachment } = await import('@/pgp')
    await generateIdentity({ name: 'Tibs', email: 'tibs@slothlee.xyz', passphrase: PASS })
    const bytes = new Uint8Array([0, 1, 2, 3, 250, 251, 255, 0, 65, 66, 10, 13])
    const armored = await encryptAttachment({ bytes, recipients: ['tibs@slothlee.xyz'], passphrase: PASS })
    expect(armored).toContain('BEGIN PGP MESSAGE')
    const back = await decryptAttachment({ armored, passphrase: PASS })
    expect(Array.from(back)).toEqual(Array.from(bytes))
  }, 30000)

  it('shows an encrypted attachment and downloads the decrypted file', async () => {
    const { encryptAttachment } = await import('@/pgp')
    const { PgpAttachment } = await import('@/components/email/PgpAttachment')
    await generateIdentity({ name: 'Tibs', email: 'tibs@slothlee.xyz', passphrase: PASS })
    const armored = await encryptAttachment({
      bytes: new Uint8Array([80, 68, 70]),
      recipients: ['tibs@slothlee.xyz'],
      passphrase: PASS,
    })
    const data = btoa(unescape(encodeURIComponent(armored)))

    let downloaded = null
    const origClick = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function () { downloaded = this.download }
    URL.createObjectURL = () => 'blob:test'
    URL.revokeObjectURL = () => {}

    const user = userEvent.setup()
    render(<PgpAttachment att={{ name: 'report.pdf.asc', contentType: 'application/pgp-encrypted', data }} />)

    // The .asc suffix is hidden from the user; they see the original filename.
    expect(screen.getByText('report.pdf')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /decrypt/i }))
    await user.type(screen.getByPlaceholderText('PGP passphrase'), PASS)
    await user.click(screen.getByTitle('Decrypt and download'))

    await waitFor(() => expect(downloaded).toBe('report.pdf'), { timeout: 15000 })
    expect(screen.queryByText(/wrong passphrase/i)).toBe(null)
    HTMLAnchorElement.prototype.click = origClick
  }, 30000)

  it('reports a wrong passphrase on an attachment', async () => {
    const { encryptAttachment } = await import('@/pgp')
    const { PgpAttachment } = await import('@/components/email/PgpAttachment')
    await generateIdentity({ name: 'Tibs', email: 'tibs@slothlee.xyz', passphrase: PASS })
    const armored = await encryptAttachment({
      bytes: new Uint8Array([1, 2, 3]),
      recipients: ['tibs@slothlee.xyz'],
      passphrase: PASS,
    })
    const data = btoa(unescape(encodeURIComponent(armored)))

    const user = userEvent.setup()
    render(<PgpAttachment att={{ name: 'notes.txt.asc', contentType: 'application/pgp-encrypted', data }} />)
    await user.click(screen.getByRole('button', { name: /decrypt/i }))
    await user.type(screen.getByPlaceholderText('PGP passphrase'), 'wrong one')
    await user.click(screen.getByTitle('Decrypt and download'))
    await waitFor(() => expect(screen.getByText(/wrong passphrase/i)).toBeInTheDocument(), { timeout: 15000 })
  }, 30000)
})
