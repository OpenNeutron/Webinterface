// A copy sealed for a recipient who has a quantum key must be openable only with
// *both* halves, and must still be an ordinary enveloped message the reader knows.
import { describe, it, expect, beforeAll } from 'vitest'
import { webcrypto } from 'node:crypto'
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js'
import { sealForRecipient, decryptEmailBytes } from '@/crypto'

const subtle = webcrypto.subtle

function b64(bytes) {
  return Buffer.from(bytes).toString('base64')
}

function raw(text) {
  return new TextEncoder().encode(text)
}

describe('sealing a copy for a recipient', () => {
  let rsaPair
  let rsaPublicB64
  let mlkem

  beforeAll(async () => {
    globalThis.crypto ??= webcrypto
    if (!globalThis.crypto.subtle) Object.defineProperty(globalThis.crypto, 'subtle', { value: subtle })
    rsaPair = await subtle.generateKey(
      { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey'],
    )
    rsaPublicB64 = b64(await subtle.exportKey('spki', rsaPair.publicKey))
    mlkem = ml_kem768.keygen()
  })

  it('uses both halves when the recipient published an ML-KEM key', async () => {
    const body = 'Subject: hello\n\nthis is the body'
    const sealed = await sealForRecipient(raw(body), {
      publicKeyBase64: rsaPublicB64,
      pqPublicKey: b64(mlkem.publicKey),
    }, 'bob')

    expect(sealed.hybrid).toBe(true)
    // The envelope names itself, so the reader takes the hybrid path rather than
    // trying RSA and reporting a key mismatch.
    expect(Buffer.from(sealed.aes_encrypted, 'base64').subarray(0, 4).toString('latin1')).toBe('SLQ\x01')

    const opened = await decryptEmailBytes(
      sealed.data_encrypted, sealed.aes_encrypted, rsaPair.privateKey, mlkem.secretKey, 'bob',
    )
    expect(new TextDecoder().decode(opened)).toBe(body)
  })

  it('fails loudly rather than downgrading when the quantum half is wrong', async () => {
    const other = ml_kem768.keygen()
    const sealed = await sealForRecipient(raw('secret'), {
      publicKeyBase64: rsaPublicB64,
      pqPublicKey: b64(mlkem.publicKey),
    }, 'bob')

    // A recipient holding a different ML-KEM key must not be handed a plaintext.
    await expect(
      decryptEmailBytes(sealed.data_encrypted, sealed.aes_encrypted, rsaPair.privateKey, other.secretKey, 'bob'),
    ).rejects.toThrow(/different post-quantum key/)
  })

  it('stays RSA-only for a recipient with no quantum key, and says so', async () => {
    const body = 'Subject: classic\n\nplain path'
    const sealed = await sealForRecipient(raw(body), { publicKeyBase64: rsaPublicB64 }, 'bob')

    expect(sealed.hybrid).toBe(false)
    expect(Buffer.from(sealed.aes_encrypted, 'base64').subarray(0, 3).toString('latin1')).not.toBe('SLQ')

    const opened = await decryptEmailBytes(sealed.data_encrypted, sealed.aes_encrypted, rsaPair.privateKey, null, 'bob')
    expect(new TextDecoder().decode(opened)).toBe(body)
  })

  it('refuses to seal to a recipient that published nothing', async () => {
    await expect(sealForRecipient(raw('x'), { publicKeyBase64: null }, 'bob'))
      .rejects.toThrow(/published no key/)
  })
})
