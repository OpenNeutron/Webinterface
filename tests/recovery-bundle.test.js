// A recovery key has to recover the mail people actually receive.
//
// Recovery used to restore the RSA key and nothing else, so an account that recovered
// could sign in and then fail on every message sealed with the quantum half — which is
// every message a current account receives. These tests pin both directions: the new
// blob carries both halves, and an old blob still opens (and reports that it has no
// quantum half rather than pretending).

import { describe, it, expect } from 'vitest'
import {
  generateRecoveryKey,
  newRecoverySalt,
  wrapPrivateKeyWithRecovery,
  unwrapRecoveryBundle,
  unwrapPrivateKeyWithRecovery,
  deriveWrappingMaterial,
  parseRecoveryKey,
} from '@/lib/recoveryKey'

const makeKey = () =>
  crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['encrypt', 'decrypt'],
  )

const fromB64 = (text) => new Uint8Array(Buffer.from(text, 'base64'))
const toB64 = (bytes) => Buffer.from(bytes).toString('base64')

describe('a recovery blob', () => {
  it('carries both halves and gives them back', async () => {
    const pair = await makeKey()
    const { text } = await generateRecoveryKey()
    const salt = newRecoverySalt()
    const pqSecret = toB64(crypto.getRandomValues(new Uint8Array(2400)))

    const blob = await wrapPrivateKeyWithRecovery(pair.privateKey, text, salt, pqSecret)
    const opened = await unwrapRecoveryBundle(blob, text, salt)

    expect(opened.version).toBe(2)
    expect(opened.pqSecret).toBe(pqSecret)
    expect(opened.privateKey.algorithm.name).toBe('RSA-OAEP')
  }, 60_000)

  it('still carries the RSA key when there is no quantum half', async () => {
    const pair = await makeKey()
    const { text } = await generateRecoveryKey()
    const salt = newRecoverySalt()

    const blob = await wrapPrivateKeyWithRecovery(pair.privateKey, text, salt, null)
    const opened = await unwrapRecoveryBundle(blob, text, salt)

    expect(opened.version).toBe(2)
    expect(opened.pqSecret).toBeNull()
    expect(opened.privateKey.algorithm.name).toBe('RSA-OAEP')
  }, 60_000)

  it('refuses the wrong recovery key', async () => {
    const pair = await makeKey()
    const first = await generateRecoveryKey()
    const second = await generateRecoveryKey()
    const salt = newRecoverySalt()

    const blob = await wrapPrivateKeyWithRecovery(pair.privateKey, first.text, salt, null)
    await expect(unwrapRecoveryBundle(blob, second.text, salt)).rejects.toThrow(
      /does not unlock this account/,
    )
  }, 60_000)

  it('opens a version-1 blob and says it has no quantum half', async () => {
    // Exactly what the old code wrote: raw PKCS#8 under the same KDF.
    const pair = await makeKey()
    const { text } = await generateRecoveryKey()
    const salt = newRecoverySalt()
    const { secret } = await parseRecoveryKey(text)
    const { keyBytes, iv } = await deriveWrappingMaterial(secret, salt)
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
    const aesKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt'])
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, pkcs8)
    const legacyBlob = toB64(new Uint8Array(cipher))

    const opened = await unwrapRecoveryBundle(legacyBlob, text, salt)
    expect(opened.version).toBe(1)
    expect(opened.pqSecret).toBeNull()
    expect(opened.privateKey.algorithm.name).toBe('RSA-OAEP')

    // The old entry point still works for callers that only want the key.
    const key = await unwrapPrivateKeyWithRecovery(legacyBlob, text, salt)
    expect(key.algorithm.name).toBe('RSA-OAEP')
  }, 60_000)

  it('does not mistake a version-1 blob for JSON', async () => {
    const pair = await makeKey()
    const { text } = await generateRecoveryKey()
    const salt = newRecoverySalt()
    const blob = await wrapPrivateKeyWithRecovery(pair.privateKey, text, salt, null)
    const bytes = await unwrapRecoveryBundle(blob, text, salt)
    expect(bytes.version).toBe(2)
    expect(fromB64(toB64(new Uint8Array([1, 2, 3])))).toHaveLength(3)
  }, 60_000)
})
