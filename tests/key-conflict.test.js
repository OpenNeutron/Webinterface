import { describe, it, expect, beforeEach } from 'vitest'
import * as openpgp from 'openpgp'
import { importAutocryptKey, importPublicKey, listKeyConflicts, resolveKeyConflict, listContacts } from '@/pgp'

async function senderKey(email) {
  const { publicKey } = await openpgp.generateKey({
    type: 'ecc', curve: 'curve25519Legacy', userIDs: [{ name: 'X', email }], format: 'armored',
  })
  return publicKey
}

async function autocryptHeader(addr, armored) {
  const key = await openpgp.readKey({ armoredKey: armored })
  const b64 = Buffer.from(key.write()).toString('base64')
  return `addr=${addr}; keydata=\n ${b64.match(/.{1,64}/g).join('\n ')}`
}

describe('key conflicts', () => {
  beforeEach(() => localStorage.clear())

  it('records a conflict when the sender key differs from the pinned one', async () => {
    const oldKey = await senderKey('sam@example.com')
    const newKey = await senderKey('sam@example.com')
    await importPublicKey(oldKey)

    const res = await importAutocryptKey(await autocryptHeader('sam@example.com', newKey), 'sam@example.com')
    expect(res.status).toBe('different-key')
    expect(listKeyConflicts()).toHaveLength(1)

    const pinned = listContacts().find((c) => c.email === 'sam@example.com').fingerprint
    expect(pinned).toBe((await openpgp.readKey({ armoredKey: oldKey })).getFingerprint().toUpperCase())
  }, 90000)

  it('adopts the sender key when asked to', async () => {
    const oldKey = await senderKey('sam@example.com')
    const newKey = await senderKey('sam@example.com')
    await importPublicKey(oldKey)
    await importAutocryptKey(await autocryptHeader('sam@example.com', newKey), 'sam@example.com')

    const result = await resolveKeyConflict('sam@example.com')
    expect(result.fingerprint).toBe((await openpgp.readKey({ armoredKey: newKey })).getFingerprint().toUpperCase())
    expect(listKeyConflicts()).toHaveLength(0)
  }, 90000)
})
