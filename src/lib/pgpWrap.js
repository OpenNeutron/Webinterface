/**
 * Wrapping the OpenPGP private key with the account password.
 *
 * Pure crypto, no imports and no app state, so the same code runs in the browser and in
 * the proof script. PBKDF2-SHA256 (310k) → AES-256-GCM. The salt and IV travel with the
 * ciphertext; losing either makes the key unrecoverable.
 */
export const KDF = 'pbkdf2-sha256:310000:aes-256-gcm'
export const ITERATIONS = 310000

function subtle() {
  const c = globalThis.crypto
  if (!c?.subtle) {
    const err = new Error('This browser cannot encrypt here (no WebCrypto). Use a current browser over HTTPS.')
    err.code = 'crypto_unavailable'
    throw err
  }
  return c.subtle
}

const b64 = (bytes) => {
  let s = ''
  const view = new Uint8Array(bytes)
  for (let i = 0; i < view.length; i += 1) s += String.fromCharCode(view[i])
  return btoa(s)
}
const unb64 = (text) => {
  const s = atob(text)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i)
  return out
}

async function deriveKey(password, saltBytes, iterations = ITERATIONS) {
  const base = await subtle().importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  return subtle().deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Wrap an armoured private key with the account password. */
export async function wrapPrivateKey(armored, password) {
  if (!armored) throw new Error('There is no private key to save')
  if (!password) throw new Error('The account password is needed to wrap the key')
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16))
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt)
  const sealed = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(armored)))
  // iv || ciphertext, base64 — one field, so a caller cannot store half of it.
  const packed = new Uint8Array(iv.length + sealed.length)
  packed.set(iv, 0)
  packed.set(sealed, iv.length)
  return { blob: b64(packed), salt: b64(salt), kdf: KDF }
}

/** Recover an armoured private key. Throws if the password is wrong — that is the check. */
export async function unwrapPrivateKey({ blob, salt, kdf }, password) {
  if (!blob || !salt) throw new Error('The stored key is incomplete')
  const iterations = Number(String(kdf || KDF).split(':')[1]) || ITERATIONS
  const packed = unb64(blob)
  const iv = packed.slice(0, 12)
  const body = packed.slice(12)
  const key = await deriveKey(password, unb64(salt), iterations)
  try {
    const opened = await subtle().decrypt({ name: 'AES-GCM', iv }, key, body)
    return new TextDecoder().decode(opened)
  } catch {
    const err = new Error('That password does not unwrap the saved key')
    err.code = 'unwrap_failed'
    throw err
  }
}

