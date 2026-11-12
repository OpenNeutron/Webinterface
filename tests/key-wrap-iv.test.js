import { describe, it, expect } from 'vitest'
import { encryptPrivateKey, decryptPrivateKey } from '@/crypto'

const SALT = 'ab'.repeat(16)

async function makeKey() {
  return crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['encrypt', 'decrypt'],
  )
}

describe('private key wrapping', () => {
  it('round-trips with a random IV', async () => {
    const { privateKey } = await makeKey()
    const wrapped = await encryptPrivateKey(privateKey, 'correct horse', SALT)
    const opened = await decryptPrivateKey(wrapped, 'correct horse', SALT)
    expect(opened.type).toBe('private')
  }, 60000)

  it('uses a fresh IV per wrap, so ciphertexts differ', async () => {
    const { privateKey } = await makeKey()
    const a = await encryptPrivateKey(privateKey, 'same password', SALT)
    const b = await encryptPrivateKey(privateKey, 'same password', SALT)
    expect(a).not.toBe(b)
  }, 60000)

  it('marks new blobs with the SLW1 magic', async () => {
    const { privateKey } = await makeKey()
    const wrapped = await encryptPrivateKey(privateKey, 'pw', SALT)
    expect(atob(wrapped).slice(0, 4)).toBe('SLW1')
  }, 60000)

  it('still opens a legacy blob written with the derived IV', async () => {
    // Reproduce the pre-fix format: argon2id(44) -> key = [0..32], iv = [32..44].
    const { argon2id, bcrypt } = await import('hash-wasm')
    const enc = new TextEncoder()
    const saltBytes = Uint8Array.from(SALT.match(/../g).map((h) => parseInt(h, 16)))
    const bcryptOut = await bcrypt({ password: enc.encode('old password'), salt: saltBytes, costFactor: 10, outputType: 'binary' })
    const material = await argon2id({ password: bcryptOut, salt: saltBytes, iterations: 3, memorySize: 65536, hashLength: 44, parallelism: 1, outputType: 'binary' })
    const keyBytes = material.slice(0, 32)
    const iv = material.slice(32, 44)

    const { privateKey } = await makeKey()
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', privateKey))
    const aesKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt'])
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, pkcs8))
    const legacyBlob = btoa(String.fromCharCode(...ct))

    const opened = await decryptPrivateKey(legacyBlob, 'old password', SALT)
    expect(opened.type).toBe('private')
  }, 60000)
})
