import { describe, it, expect } from 'vitest'
import { generatePqKeyPair, pqEncapsulate, pqDecapsulate, pqKeyLengths, PQ_KEM } from '@/lib/pq'

describe('post-quantum key material', () => {
  it('produces ML-KEM-768 sized keys', () => {
    const lens = pqKeyLengths()
    expect(lens.publicKey).toBe(1184)
    expect(lens.secretKey).toBe(2400)
  })

  it('agree on a shared secret both sides', () => {
    const kp = generatePqKeyPair()
    expect(kp.kem).toBe(PQ_KEM)
    const { cipherText, sharedSecret } = pqEncapsulate(kp.publicKey)
    const recovered = pqDecapsulate(cipherText, kp.secretKey)
    expect(Buffer.from(recovered).toString('hex')).toBe(Buffer.from(sharedSecret).toString('hex'))
  })

  it('fails to decapsulate with a different key', () => {
    const a = generatePqKeyPair()
    const b = generatePqKeyPair()
    const { cipherText, sharedSecret } = pqEncapsulate(a.publicKey)
    let recovered = null
    try { recovered = pqDecapsulate(cipherText, b.secretKey) } catch { recovered = null }
    if (recovered) {
      expect(Buffer.from(recovered).toString('hex')).not.toBe(Buffer.from(sharedSecret).toString('hex'))
    } else {
      expect(recovered).toBeNull()
    }
  })
})
