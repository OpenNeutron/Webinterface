import { describe, it, expect, beforeEach } from 'vitest'
import { generateIdentity, hasIdentity, keyCoverage, encryptBody, exportPublicKey } from '@/pgp'

describe('OpenPGP end to end, through the real module', () => {
  beforeEach(() => localStorage.clear())

  it('creates an identity, sees it, and encrypts to itself', async () => {
    const id = await generateIdentity({ name: 'Tibs', email: 'tibs@slothlee.xyz', passphrase: 'passphrase123' })
    expect(id.fingerprint).toHaveLength(40)

    expect(hasIdentity()).toBe(true)
    expect(exportPublicKey()).toContain('BEGIN PGP PUBLIC KEY BLOCK')

    const coverage = keyCoverage(['tibs@slothlee.xyz'])
    expect(coverage.canEncrypt).toBe(true)

    const armored = await encryptBody({
      text: 'hello from the test',
      recipients: ['tibs@slothlee.xyz'],
      passphrase: 'passphrase123',
    })
    expect(armored).toContain('BEGIN PGP MESSAGE')
  }, 60000)

  it('survives a page reload (storage round trip)', async () => {
    await generateIdentity({ name: 'Tibs', email: 'tibs@slothlee.xyz', passphrase: 'passphrase123' })
    const raw = localStorage.getItem('sloth.pgp.keyring.v1')
    expect(raw).toBeTruthy()
    localStorage.setItem('sloth.pgp.keyring.v1', raw) // simulate re-read
    expect(hasIdentity()).toBe(true)
    expect(keyCoverage(['tibs@slothlee.xyz']).canEncrypt).toBe(true)
  }, 60000)

  it('reports a missing key instead of encrypting to nobody', async () => {
    await generateIdentity({ name: 'Tibs', email: 'tibs@slothlee.xyz', passphrase: 'passphrase123' })
    const coverage = keyCoverage(['stranger@example.com'])
    expect(coverage.canEncrypt).toBe(false)
    expect(coverage.missing).toEqual(['stranger@example.com'])
    await expect(encryptBody({ text: 'x', recipients: ['stranger@example.com'], passphrase: 'passphrase123' }))
      .rejects.toThrow(/No OpenPGP key for/)
  }, 60000)
})
