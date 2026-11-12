// A copy sealed for a recipient who has a quantum key must be openable only with
// *both* halves, and must still be an ordinary enveloped message the reader knows.
import { describe, it, expect, beforeAll } from 'vitest'
import { webcrypto } from 'node:crypto'
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js'
import { sealForRecipient, decryptEmailBytes, PQ_ENVELOPE_VERSION } from '@/crypto'

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
    expect(Buffer.from(sealed.aes_encrypted, 'base64').subarray(0, 3).toString('latin1')).toBe('SLQ')
    expect(Buffer.from(sealed.aes_encrypted, 'base64')[3]).toBe(PQ_ENVELOPE_VERSION)

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


  it('still opens a version-1 envelope, which derived its key without the transcript', async () => {
    // Version 1 mail exists in the mailbox and can never be re-created. Its key came
    // from the two secrets and the username alone, so this test builds one by hand
    // exactly the way the old code did, and requires the reader to keep opening it.
    const { ml_kem768: kem } = await import('@noble/post-quantum/ml-kem.js')
    const seed = crypto.getRandomValues(new Uint8Array(32))
    const rsaCiphertext = new Uint8Array(await subtle.encrypt({ name: 'RSA-OAEP' }, rsaPair.publicKey, seed))
    const { cipherText, sharedSecret } = kem.encapsulate(mlkem.publicKey)

    const ikm = new Uint8Array(seed.length + sharedSecret.length)
    ikm.set(seed, 0)
    ikm.set(sharedSecret, seed.length)
    const base = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
    const keyBits = new Uint8Array(await subtle.deriveBits({
      name: 'HKDF', hash: 'SHA-256',
      salt: new TextEncoder().encode('sloth-mail/atrest/v1'),
      info: new TextEncoder().encode('bob'),
    }, base, 256))

    const aesKey = await subtle.importKey('raw', keyBits, { name: 'AES-GCM' }, false, ['encrypt'])
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const sealedBody = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, raw('old message')))
    const body = new Uint8Array(12 + sealedBody.length)
    body.set(iv, 0)
    body.set(sealedBody, 12)

    const envelope = new Uint8Array(6 + rsaCiphertext.length + cipherText.length)
    envelope.set([0x53, 0x4c, 0x51, 0x01], 0)
    envelope[4] = (rsaCiphertext.length >> 8) & 0xff
    envelope[5] = rsaCiphertext.length & 0xff
    envelope.set(rsaCiphertext, 6)
    envelope.set(cipherText, 6 + rsaCiphertext.length)

    const opened = await decryptEmailBytes(
      Buffer.from(body).toString('base64'),
      Buffer.from(envelope).toString('base64'),
      rsaPair.privateKey,
      mlkem.secretKey,
      'bob',
    )
    expect(new TextDecoder().decode(opened)).toBe('old message')
  })

  it('refuses to seal to a recipient that published nothing', async () => {
    await expect(sealForRecipient(raw('x'), { publicKeyBase64: null }, 'bob'))
      .rejects.toThrow(/published no key/)
  })
})
