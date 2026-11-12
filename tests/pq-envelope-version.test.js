// A sealed envelope carries its own version, and a version this build does not know
// must say so. The failure this guards against is the quiet one: an unknown version
// used to fall through to the RSA path, which reported "sealed for a different key
// than this account holds" about a message that was intact, addressed to this
// account, and simply written by a newer build.

import { describe, it, expect } from 'vitest'
import { isPqEnvelope, pqEnvelopeVersion, PQ_ENVELOPE_VERSION } from '@/crypto'

const envelope = (version, rsa = 16, mlkem = 8) => {
  const bytes = new Uint8Array(6 + rsa + mlkem)
  bytes.set([0x53, 0x4c, 0x51, version], 0) // "SLQ" + version
  bytes[4] = (rsa >> 8) & 0xff
  bytes[5] = rsa & 0xff
  return bytes
}

describe('the sealed envelope says which version sealed it', () => {
  it('recognises this build’s version', () => {
    const bytes = envelope(PQ_ENVELOPE_VERSION)
    expect(isPqEnvelope(bytes)).toBe(true)
    expect(pqEnvelopeVersion(bytes)).toBe(PQ_ENVELOPE_VERSION)
  })

  it('recognises a newer version as a sealed envelope, not as a legacy key', () => {
    const bytes = envelope(0x03)
    expect(isPqEnvelope(bytes)).toBe(true)
    expect(pqEnvelopeVersion(bytes)).toBe(0x03)
  })

  it('treats a bare RSA ciphertext as the legacy envelope, as it must forever', () => {
    const legacy = new Uint8Array(256).fill(0x41)
    expect(isPqEnvelope(legacy)).toBe(false)
    expect(pqEnvelopeVersion(legacy)).toBeNull()
  })

  it('does not mistake a short blob for a sealed envelope', () => {
    expect(isPqEnvelope(new Uint8Array([0x53, 0x4c, 0x51, 0x01]))).toBe(false)
  })
})

describe('an unknown version fails by name, not as a key mismatch', () => {
  const toB64 = (bytes) => Buffer.from(bytes).toString('base64')
  const newer = (() => {
    const bytes = new Uint8Array(6 + 16 + 8)
    bytes.set([0x53, 0x4c, 0x51, 0x03], 0) // "SLQ" + version 3: not known to this build
    bytes[4] = 0
    bytes[5] = 16
    return toB64(bytes)
  })()
  const body = toB64(new Uint8Array(12 + 16).fill(7))

  it('names the newer format for a quantum envelope', async () => {
    const { decryptEmailBytes } = await import('@/crypto')
    await expect(decryptEmailBytes(body, newer, null, null, 'someone'))
      .rejects.toMatchObject({ code: 'pq_newer_version' })
  })

  it('names the newer format for a key envelope too', async () => {
    const { decryptEmailBytes } = await import('@/crypto')
    const keyEnvelope = new Uint8Array(4 + 256)
    keyEnvelope.set([0x53, 0x4c, 0x4b, 0x03], 0) // "SLK" + version 3
    await expect(decryptEmailBytes(body, toB64(keyEnvelope), null, null, 'someone'))
      .rejects.toMatchObject({ code: 'key_envelope_newer_version' })
  })

  it('still opens nothing extra: the legacy path is unchanged', async () => {
    const { decryptEmailBytes } = await import('@/crypto')
    // A bare RSA ciphertext with no key must fail as it always did — no new error name.
    await expect(decryptEmailBytes(body, toB64(new Uint8Array(256).fill(0x41)), null, null, 'someone'))
      .rejects.not.toMatchObject({ code: 'pq_newer_version' })
  })
})
