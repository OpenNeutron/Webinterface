import { describe, it, expect, beforeEach } from 'vitest'
import { parseEmail } from '@/emailParser'
import { importAutocryptKey, generateIdentity, keyCoverage, exportPublicKey } from '@/pgp'
import * as openpgp from 'openpgp'

async function makeSenderKey(email) {
  const { publicKey } = await openpgp.generateKey({
    type: 'ecc', curve: 'curve25519Legacy',
    userIDs: [{ name: 'Sender', email }], format: 'armored',
  })
  return publicKey
}

describe('Autocrypt import', () => {
  beforeEach(() => localStorage.clear())

  it('parseEmail keeps the Autocrypt header', async () => {
    const raw = 'From: Sam <sam@example.com>\nSubject: hi\nAutocrypt: addr=sam@example.com; keydata=\n AAA\n\nbody'
    expect(parseEmail(raw).autocrypt).toContain('addr=sam@example.com')
  })

  it('imports the sender key so replies can be encrypted', async () => {
    const pub = await makeSenderKey('sam@example.com')
    const bin = await openpgp.readKey({ armoredKey: pub })
    const b64 = Buffer.from(bin.write()).toString('base64')
    const header = `addr=sam@example.com; keydata=\n ${b64.match(/.{1,64}/g).join('\n ')}`

    const res = await importAutocryptKey(header, 'sam@example.com')
    expect(res.status).toBe('imported')
    expect(keyCoverage(['sam@example.com']).canEncrypt).toBe(true)
  }, 60000)

  it('refuses a header claiming a different sender', async () => {
    const pub = await makeSenderKey('attacker@example.com')
    const bin = await openpgp.readKey({ armoredKey: pub })
    const b64 = Buffer.from(bin.write()).toString('base64')
    const header = `addr=attacker@example.com; keydata=\n ${b64}`
    const res = await importAutocryptKey(header, 'sam@example.com')
    expect(res.status).toBe('address-mismatch')
    expect(keyCoverage(['attacker@example.com']).canEncrypt).toBe(false)
  }, 60000)
})
