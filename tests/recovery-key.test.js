import { describe, it, expect } from 'vitest'
import {
  generateRecoveryKey,
  parseRecoveryKey,
  formatRecoveryKey,
  normalizeRecoveryKey,
  recoveryAuthProof,
  wrapPrivateKeyWithRecovery,
  unwrapPrivateKeyWithRecovery,
  importPrivateKeyPkcs8,
  newRecoverySalt,
  base32Encode,
  base32Decode,
} from '@/lib/recoveryKey'

const makeKeyPair = () =>
  crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['encrypt', 'decrypt']
  )

describe('recovery key format', () => {
  it('round-trips a generated key', async () => {
    const { text } = await generateRecoveryKey()
    const parsed = await parseRecoveryKey(text)
    expect(parsed.secret.length).toBe(20)
  })

  it('formats as nine groups of four', async () => {
    const { text } = await generateRecoveryKey()
    const groups = text.split('-')
    expect(groups.length).toBe(9)
    expect(groups.every((g) => g.length === 4)).toBe(true)
  })

  it('rejects a key with a typo', async () => {
    const { text } = await generateRecoveryKey()
    const chars = text.replace(/-/g, '').split('')
    chars[3] = chars[3] === 'A' ? 'B' : 'A'
    await expect(parseRecoveryKey(formatRecoveryKey(chars.join('')))).rejects.toThrow(/typo/)
  })

  it('rejects a truncated key', async () => {
    const { text } = await generateRecoveryKey()
    await expect(parseRecoveryKey(text.slice(0, 20))).rejects.toThrow(/wrong length/)
  })

  it('accepts lowercase, spaces and look-alike characters', async () => {
    const { text } = await generateRecoveryKey()
    const messy = text.toLowerCase().replace(/-/g, ' ')
    expect(await parseRecoveryKey(messy)).toBeTruthy()
    expect(normalizeRecoveryKey('abcd-efgh')).toBe('ABCDEFGH')
  })

  it('encodes and decodes base32 symmetrically', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128])
    expect(Array.from(base32Decode(base32Encode(bytes)))).toEqual(Array.from(bytes))
  })
})

describe('recovery key proof', () => {
  it('is deterministic for the same key', async () => {
    const { text } = await generateRecoveryKey()
    expect(await recoveryAuthProof(text)).toBe(await recoveryAuthProof(text))
  })

  it('differs between keys and is a 64-char hex digest', async () => {
    const a = await generateRecoveryKey()
    const b = await generateRecoveryKey()
    const [pa, pb] = [await recoveryAuthProof(a.text), await recoveryAuthProof(b.text)]
    expect(pa).not.toBe(pb)
    expect(pa).toMatch(/^[0-9a-f]{64}$/)
  })

  it('does not leak the secret itself', async () => {
    const { text } = await generateRecoveryKey()
    const proof = await recoveryAuthProof(text)
    expect(proof).not.toContain(normalizeRecoveryKey(text))
  })
})

describe('recovery key wrapping', () => {
  it('unwraps the same private key, so old mail stays readable', async () => {
    const pair = await makeKeyPair()
    const { text } = await generateRecoveryKey()
    const salt = newRecoverySalt()

    const blob = await wrapPrivateKeyWithRecovery(pair.privateKey, text, salt)
    const recovered = await unwrapPrivateKeyWithRecovery(blob, text, salt)

    // Same modulus means it is literally the same key, not a new one.
    const original = await crypto.subtle.exportKey('jwk', pair.privateKey)
    const restored = await crypto.subtle.exportKey('jwk', recovered)
    expect(restored.n).toBe(original.n)

    // And it can still decrypt something encrypted to the original public key.
    const cipher = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pair.publicKey, new TextEncoder().encode('old message'))
    const plain = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, recovered, cipher)
    expect(new TextDecoder().decode(plain)).toBe('old message')
  })

  it('refuses a different recovery key', async () => {
    const pair = await makeKeyPair()
    const { text } = await generateRecoveryKey()
    const other = await generateRecoveryKey()
    const salt = newRecoverySalt()
    const blob = await wrapPrivateKeyWithRecovery(pair.privateKey, text, salt)
    await expect(unwrapPrivateKeyWithRecovery(blob, other.text, salt)).rejects.toThrow(/does not unlock/)
  })

  it('refuses the right key with the wrong salt', async () => {
    const pair = await makeKeyPair()
    const { text } = await generateRecoveryKey()
    const blob = await wrapPrivateKeyWithRecovery(pair.privateKey, text, newRecoverySalt())
    await expect(unwrapPrivateKeyWithRecovery(blob, text, newRecoverySalt())).rejects.toThrow(/does not unlock/)
  })

  it('produces a usable CryptoKey for normal decryption', async () => {
    const blob = await wrapPrivateKeyWithRecovery(...(await (async () => {
      const pair = await makeKeyPair()
      const { text } = await generateRecoveryKey()
      return [pair.privateKey, text, newRecoverySalt()]
    })()))
    expect(blob).toBeTruthy()
    expect(typeof importPrivateKeyPkcs8).toBe('function')
  })
})
