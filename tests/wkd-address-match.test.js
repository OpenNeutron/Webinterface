import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as openpgp from 'openpgp'
import { lookupKey } from '@/lib/wkd'

describe('lookup refuses a key for a different mailbox', () => {
  let otherKey
  beforeEach(async () => {
    const { publicKey } = await openpgp.generateKey({
      type: 'ecc', curve: 'curve25519Legacy',
      userIDs: [{ name: 'Test', email: 'slothtest@mastertibbles.co.uk' }],
      format: 'armored',
    })
    otherKey = publicKey
  }, 60000)
  afterEach(() => vi.restoreAllMocks())

  it('returns nothing when the published key belongs to another address on the domain', async () => {
    const bin = (await openpgp.readKey({ armoredKey: otherKey })).write()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => bin.buffer,
      text: async () => otherKey,
    })))
    expect(await lookupKey('samsmith@mastertibbles.co.uk')).toBeNull()
  }, 60000)

  it('accepts the key when the address matches', async () => {
    const bin = (await openpgp.readKey({ armoredKey: otherKey })).write()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => bin.buffer,
      text: async () => otherKey,
    })))
    const hit = await lookupKey('slothtest@mastertibbles.co.uk')
    expect(hit?.source).toBeTruthy()
  }, 60000)
})
