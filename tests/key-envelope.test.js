import { describe, it, expect } from 'vitest'
import { encryptEmail, decryptEmail } from '@/crypto'

// The AES key blob now carries a version tag. Two properties matter:
// new messages round-trip, and messages written before the tag still open.
describe('key envelope versioning', () => {
  it('round-trips a message through the versioned envelope', async () => {
    const pair = await crypto.subtle.generateKey(
      { name: 'RSA-OAEP', modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true, ['encrypt', 'decrypt'],
    )
    const { aes_encrypted, data_encrypted } = await encryptEmail('hello', pair.publicKey)
    const marker = atob(aes_encrypted.startsWith('U0xL') ? aes_encrypted : aes_encrypted)
    expect(atob(aes_encrypted).slice(0, 3)).toBe('SLK')
    const plain = await decryptEmail(data_encrypted, aes_encrypted, pair.privateKey)
    expect(plain).toBe('hello')
  }, 60000)

  it('still opens a legacy blob with no version tag', async () => {
    const pair = await crypto.subtle.generateKey(
      { name: 'RSA-OAEP', modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true, ['encrypt', 'decrypt'],
    )
    // Build a pre-versioning message exactly as the old writer did.
    const rawKey = crypto.getRandomValues(new Uint8Array(32))
    const aesKey = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt'])
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, new TextEncoder().encode('legacy'))
    const body = new Uint8Array(iv.length + ct.byteLength)
    body.set(iv, 0); body.set(new Uint8Array(ct), iv.length)
    const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pair.publicKey, rawKey)
    const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))

    const plain = await decryptEmail(b64(body.buffer), b64(wrapped), pair.privateKey)
    expect(plain).toBe('legacy')
  }, 60000)
})
