/**
 * Recovery keys.
 *
 * A recovery key is a high-entropy secret the user saves offline. It wraps the
 * mailbox private key a *second* time, independently of the password, so a
 * forgotten password can be recovered without losing old mail:
 *
 *   recovery secret --argon2id--> AES-GCM key --wraps--> existing private key
 *
 * The server stores the wrapping (ciphertext) and a one-way proof derived from
 * the secret. It never sees the secret and can never open the archive.
 */
import { argon2id } from 'hash-wasm'

// Crockford base32: no I, L, O or U, so nothing is ambiguous when read off paper.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const SECRET_BYTES = 20 // 160 bits of OS entropy
const CHECK_BYTES = 2
const GROUP = 4
const DOMAIN = '|slothmail-recovery-auth:v1'

const toB64 = (bytes) => {
  let s = ''
  const arr = new Uint8Array(bytes)
  for (let i = 0; i < arr.length; i += 1) s += String.fromCharCode(arr[i])
  return btoa(s)
}

const fromB64 = (b64) => {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i)
  return out
}

const toHex = (bytes) => Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
const hexToBytes = (hex) => {
  const clean = hex.trim()
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(clean.substr(i * 2, 2), 16)
  return out
}

export function base32Encode(bytes) {
  const out = []
  let bits = 0
  let value = 0
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out.push(ALPHABET[(value >>> (bits - 5)) & 31])
      bits -= 5
    }
  }
  if (bits > 0) out.push(ALPHABET[(value << (5 - bits)) & 31])
  return out.join('')
}

export function base32Decode(text) {
  const bytes = []
  let bits = 0
  let value = 0
  for (const ch of text) {
    const idx = ALPHABET.indexOf(ch)
    if (idx < 0) throw new Error('That is not a valid recovery key (unexpected character)')
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(bytes)
}

/** Strip the formatting people add when copying from paper; map look-alikes. */
export function normalizeRecoveryKey(input) {
  return String(input || '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/U/g, 'V')
}

export function formatRecoveryKey(encoded) {
  const groups = []
  for (let i = 0; i < encoded.length; i += GROUP) groups.push(encoded.slice(i, i + GROUP))
  return groups.join('-')
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return new Uint8Array(digest)
}

/**
 * Create a new recovery key.
 * The last two bytes of the encoding are a checksum over the secret, so a
 * mistyped key is rejected locally instead of failing later with a confusing
 * "wrong key" from the decrypt step.
 */
export async function generateRecoveryKey() {
  const secret = crypto.getRandomValues(new Uint8Array(SECRET_BYTES))
  const check = (await sha256(secret)).slice(0, CHECK_BYTES)
  const joined = new Uint8Array(secret.length + check.length)
  joined.set(secret, 0)
  joined.set(check, secret.length)
  const encoded = base32Encode(joined)
  return {
    text: formatRecoveryKey(encoded),
    encoded,
  }
}

/** Parse what the user typed; throws with a readable reason on any problem. */
export async function parseRecoveryKey(input) {
  const normalized = normalizeRecoveryKey(input)
  if (!normalized) throw new Error('Enter your recovery key')

  let decoded
  try {
    decoded = base32Decode(normalized)
  } catch {
    throw new Error('That is not a valid recovery key (unexpected character)')
  }

  if (decoded.length !== SECRET_BYTES + CHECK_BYTES) {
    throw new Error('That recovery key is the wrong length')
  }

  const secret = decoded.slice(0, SECRET_BYTES)
  const check = decoded.slice(SECRET_BYTES)
  const expected = (await sha256(secret)).slice(0, CHECK_BYTES)
  if (check.some((b, i) => b !== expected[i])) {
    throw new Error('That recovery key has a typo in it')
  }
  return { secret, encoded: normalized }
}

/**
 * Proof of possession, sent to the server in place of the secret.
 * One-way and domain-separated: it cannot be turned back into the wrapping key.
 */
export async function recoveryAuthProof(input) {
  const { encoded } = await parseRecoveryKey(input)
  const digest = await sha256(new TextEncoder().encode(encoded + DOMAIN))
  return toHex(digest)
}

export async function deriveWrappingMaterial(secret, saltHex) {
  const saltBytes = hexToBytes(saltHex)
  const material = await argon2id({
    password: secret,
    salt: saltBytes,
    iterations: 3,
    memorySize: 65536,
    hashLength: 44,
    parallelism: 1,
    outputType: 'binary',
  })
  return { keyBytes: material.slice(0, 32), iv: material.slice(32, 44) }
}

export function newRecoverySalt() {
  return toHex(crypto.getRandomValues(new Uint8Array(16)))
}

async function exportPkcs8(privateKey) {
  if (privateKey && privateKey._forge) {
    throw new Error('Recovery keys need a browser with WebCrypto support')
  }
  return new Uint8Array(await crypto.subtle.exportKey('pkcs8', privateKey))
}

export async function importPrivateKeyPkcs8(pkcs8Bytes) {
  return crypto.subtle.importKey('pkcs8', pkcs8Bytes, { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['decrypt'])
}

/**
 * Wrap an existing private key under a recovery key.
 *
 * Version 2 carries the ML-KEM secret as well. Recovery used to restore the RSA key
 * alone, which meant a recovered account could sign in, read plaintext-era mail, and
 * fail on every message sealed with the quantum half — the exact mail a new account
 * receives. The secret travels in the same blob, under the same recovery key.
 */
export async function wrapPrivateKeyWithRecovery(privateKey, recoveryKeyText, saltHex, pqSecretB64 = null) {
  const { secret } = await parseRecoveryKey(recoveryKeyText)
  const { keyBytes, iv } = await deriveWrappingMaterial(secret, saltHex)
  const pkcs8 = await exportPkcs8(privateKey)
  const payload = JSON.stringify({
    v: 2,
    rsa: toB64(pkcs8),
    pq: pqSecretB64 || null,
  })
  const aesKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt'])
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, new TextEncoder().encode(payload))
  return toB64(new Uint8Array(cipher))
}

/**
 * Unwrap a recovery blob into both halves.
 *
 * A version-1 blob is the raw PKCS#8 key from before this change: it opens, and it has
 * no quantum half. The caller is expected to say so instead of pretending otherwise.
 */
export async function unwrapRecoveryBundle(blobB64, recoveryKeyText, saltHex) {
  const { secret } = await parseRecoveryKey(recoveryKeyText)
  const { keyBytes, iv } = await deriveWrappingMaterial(secret, saltHex)
  const aesKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt'])
  let plain
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, fromB64(blobB64))
  } catch {
    // The checksum catches typos, so reaching here means the key is valid but
    // does not belong to this account.
    throw new Error('That recovery key does not unlock this account')
  }
  const bytes = new Uint8Array(plain)

  let payload = null
  try {
    const maybe = JSON.parse(new TextDecoder().decode(bytes))
    if (maybe && maybe.v === 2 && typeof maybe.rsa === 'string') payload = maybe
  } catch {
    /* not JSON: a version-1 blob, handled below */
  }

  if (!payload) {
    return { privateKey: await importPrivateKeyPkcs8(bytes), pqSecret: null, version: 1 }
  }
  return {
    privateKey: await importPrivateKeyPkcs8(fromB64(payload.rsa)),
    pqSecret: payload.pq || null,
    version: 2,
  }
}

/** Kept for callers that only need the RSA key. */
export async function unwrapPrivateKeyWithRecovery(blobB64, recoveryKeyText, saltHex) {
  const bundle = await unwrapRecoveryBundle(blobB64, recoveryKeyText, saltHex)
  return bundle.privateKey
}

export const _internals = { sha256, toHex, fromB64, toB64, SECRET_BYTES, CHECK_BYTES }
