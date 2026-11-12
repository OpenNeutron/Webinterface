import { describe, it, expect, beforeEach } from 'vitest'
import { generateIdentity, keyBackupDue, markKeyBackupTaken } from '@/pgp'

describe('backup prompt', () => {
  beforeEach(() => localStorage.clear())

  it('stays quiet before any key exists', () => {
    expect(keyBackupDue()).toBe(false)
  })

  it('asks once a key exists and no backup was taken', async () => {
    await generateIdentity({ name: 'T', email: 't@example.com', passphrase: 'passphrase123' })
    expect(keyBackupDue()).toBe(true)
  }, 60000)

  it('goes quiet after a backup is taken', async () => {
    await generateIdentity({ name: 'T', email: 't@example.com', passphrase: 'passphrase123' })
    markKeyBackupTaken()
    expect(keyBackupDue()).toBe(false)
  }, 60000)

  it('asks again once the backup is a week old', async () => {
    await generateIdentity({ name: 'T', email: 't@example.com', passphrase: 'passphrase123' })
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
    localStorage.setItem('sloth.pgp.backup.v1', JSON.stringify({ takenAt: eightDaysAgo }))
    expect(keyBackupDue()).toBe(true)
  }, 60000)
})
