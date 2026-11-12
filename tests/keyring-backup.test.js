import { describe, it, expect, beforeEach } from 'vitest'
import { generateIdentity, exportKeyRingBackup, importKeyRingBackup, keyCoverage } from '@/pgp'

describe('keyring backup', () => {
  beforeEach(() => localStorage.clear())

  it('round-trips an identity into a fresh browser', async () => {
    await generateIdentity({ name: 'Tibs', email: 'tibs@slothlee.xyz', passphrase: 'passphrase123' })
    const backup = exportKeyRingBackup()

    localStorage.clear() // a different device

    const result = await importKeyRingBackup(backup)
    expect(result.identityRestored).toBe(true)
    expect(keyCoverage(['tibs@slothlee.xyz']).canEncrypt).toBe(true)
  }, 60000)

  it('refuses a file that is not a backup', async () => {
    await expect(importKeyRingBackup('{"format":"something-else"}')).rejects.toThrow(/not a Sloth Lee key backup/)
  })

  it('does not overwrite a key already present', async () => {
    await generateIdentity({ name: 'Tibs', email: 'tibs@slothlee.xyz', passphrase: 'passphrase123' })
    const backup = exportKeyRingBackup()
    const result = await importKeyRingBackup(backup)
    expect(result.contactsAdded).toBe(0)
    expect(result.contactsSkipped).toBeGreaterThan(0)
    expect(result.identityRestored).toBe(false)
  }, 60000)
})
