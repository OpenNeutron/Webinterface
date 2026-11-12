import { describe, it, expect, beforeEach } from 'vitest'
import * as openpgp from 'openpgp'
import { importPublicKey, listContacts, markContactVerified } from '@/pgp'

async function key(email) {
  const { publicKey } = await openpgp.generateKey({
    type: 'ecc', curve: 'curve25519Legacy', userIDs: [{ name: 'X', email }], format: 'armored',
  })
  return publicKey
}

describe('contact verification state', () => {
  beforeEach(() => localStorage.clear())

  it('an imported key starts unverified', async () => {
    await importPublicKey(await key('a@example.com'))
    expect(listContacts().find((c) => c.email === 'a@example.com').verified).toBe(false)
  }, 60000)

  it('survives being marked verified', async () => {
    await importPublicKey(await key('a@example.com'))
    markContactVerified('a@example.com')
    expect(listContacts().find((c) => c.email === 'a@example.com').verified).toBe(true)
  }, 60000)

  it('can be un-verified again', async () => {
    await importPublicKey(await key('a@example.com'))
    markContactVerified('a@example.com')
    markContactVerified('a@example.com', false)
    expect(listContacts().find((c) => c.email === 'a@example.com').verified).toBe(false)
  }, 60000)
})
