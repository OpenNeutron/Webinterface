
import { argon2id as argon2idRaw, bcrypt as bcryptRaw } from 'hash-wasm'

// Argon2 and bcrypt from hash-wasm are WebAssembly. If the browser refuses to compile
// wasm — a content blocker, an extension, or a Content-Security-Policy without
// 'wasm-unsafe-eval' — the call throws something opaque and every caller can only say
// "failed", which points at the user's password for what is really a policy decision.
// Tagging the failure lets the screens say what actually happened.
//
// This is not hypothetical: a tightened CSP took sign-in down for an hour, and the app
// reported "Login failed" the whole time.
function wasmStep(name, fn) {
  return async (...args) => {
    try {
      return await fn(...args)
    } catch (err) {
      const message = String(err?.message || err || '')
      if (/webassembly|wasm|refused to compile|unsupported|not a function/i.test(message)) {
        const wrapped = new Error(
          `${name} could not run in this browser (WebAssembly is blocked).`,
        )
        wrapped.code = 'crypto_unavailable'
        wrapped.cause = err
        throw wrapped
      }
      throw err
    }
  }
}

const bcrypt = wasmStep('bcrypt', bcryptRaw)
const argon2id = wasmStep('argon2id', argon2idRaw)
import forge from 'node-forge'
const KeygenWorker = null
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js'

// true when the Web Crypto API is available (requires a secure context / HTTPS)
export const hasSubtleCrypto = typeof crypto !== 'undefined' && !!crypto.subtle

// ─── Binary helpers ───────────────────────────────────────────────────────────

function toB64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function fromB64(b64) {
  const bin = atob(b64)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return buf
}

function toForgeBin(u8) {
  let s = ''
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i])
  return s
}

function fromForgeBin(s) {
  const u8 = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i)
  return u8
}

function hexToBytes(hex) {
  const arr = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2)
    arr[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  return arr
}

// RSA-OAEP params for forge — must match WebCrypto (SHA-256 hash + SHA-256 MGF1)
function forgeOaepParams() {
  return { md: forge.md.sha256.create(), mgf1: { md: forge.md.sha256.create() } }
}

// ─── Forge key helpers ────────────────────────────────────────────────────────

// Pack a forge private key as PKCS#8 DER bytes (same wire format as WebCrypto exportKey('pkcs8'))
function forgePrivToPkcs8Bytes(forgePrivKey) {
  const inner   = forge.pki.privateKeyToAsn1(forgePrivKey)
  const wrapped = forge.pki.wrapRsaPrivateKey(inner)
  return fromForgeBin(forge.asn1.toDer(wrapped).getBytes())
}

// Unpack PKCS#8 DER bytes into a forge private key
function pkcs8BytesToForgePriv(bytes) {
  const asn1     = forge.asn1.fromDer(toForgeBin(bytes))
  const innerDer = asn1.value[2].value          // OCTET STRING contents = RSAPrivateKey
  const innerAsn1 = forge.asn1.fromDer(innerDer)
  return forge.pki.privateKeyFromAsn1(innerAsn1)
}

// ─── Forge AES-GCM ────────────────────────────────────────────────────────────
// Both functions use the same layout as WebCrypto: output = ciphertext || tag(16 bytes)

function forgeAesGcmEncrypt(keyBytes, ivBytes, plainBytes) {
  const cipher = forge.cipher.createCipher('AES-GCM', forge.util.createBuffer(toForgeBin(keyBytes)))
  cipher.start({ iv: forge.util.createBuffer(toForgeBin(ivBytes)) })
  cipher.update(forge.util.createBuffer(toForgeBin(plainBytes)))
  cipher.finish()
  const ct  = fromForgeBin(cipher.output.getBytes())
  const tag = fromForgeBin(cipher.mode.tag.getBytes())
  const out = new Uint8Array(ct.length + tag.length)
  out.set(ct, 0)
  out.set(tag, ct.length)
  return out
}

function forgeAesGcmDecrypt(keyBytes, ivBytes, combinedBytes) {
  const tagLen = 16
  const ct  = combinedBytes.slice(0, combinedBytes.length - tagLen)
  const tag = combinedBytes.slice(combinedBytes.length - tagLen)
  const decipher = forge.cipher.createDecipher('AES-GCM', forge.util.createBuffer(toForgeBin(keyBytes)))
  decipher.start({ iv: forge.util.createBuffer(toForgeBin(ivBytes)), tag: forge.util.createBuffer(toForgeBin(tag)) })
  decipher.update(forge.util.createBuffer(toForgeBin(ct)))
  if (!decipher.finish()) throw new Error('AES-GCM decryption failed (bad tag)')
  return fromForgeBin(decipher.output.getBytes())
}

// ─── Password hashing ─────────────────────────────────────────────────────────

// Fixed 16-byte salt for auth hashing. ASCII: "OpenNeutronAuth1"
const AUTH_SALT = new Uint8Array([
  0x4f, 0x70, 0x65, 0x6e, 0x4e, 0x65, 0x75, 0x74,
  0x72, 0x6f, 0x6e, 0x41, 0x75, 0x74, 0x68, 0x31,
])

export async function hashPassword(password) {
  const enc = new TextEncoder()
  return bcrypt({ password: enc.encode(password), salt: AUTH_SALT, costFactor: 10, outputType: 'encoded' })
}

// Derives the 32-byte key that wraps a private key.
//
// The IV is NOT derived: deriving it meant every wrap of the same key reused
// the same nonce, which in AES-GCM leaks the XOR of the plaintexts and weakens
// authentication. Each wrap now draws a random IV (see wrapPrivateKey).
async function deriveWrapKey(password, serverSalt) {
  const enc       = new TextEncoder()
  const saltBytes = hexToBytes(serverSalt)
  const bcryptOut = await bcrypt({ password: enc.encode(password), salt: saltBytes, costFactor: 10, outputType: 'binary' })
  return argon2id({ password: bcryptOut, salt: saltBytes, iterations: 3, memorySize: 65536, hashLength: 32, parallelism: 1, outputType: 'binary' })
}

// Legacy derivation, kept only so blobs written before the fix still open.
async function deriveLegacyKeyMaterial(password, serverSalt) {
  const enc       = new TextEncoder()
  const saltBytes = hexToBytes(serverSalt)
  const bcryptOut = await bcrypt({ password: enc.encode(password), salt: saltBytes, costFactor: 10, outputType: 'binary' })
  return argon2id({ password: bcryptOut, salt: saltBytes, iterations: 3, memorySize: 65536, hashLength: 44, parallelism: 1, outputType: 'binary' })
}

// Envelope: "SLW1" | 12-byte IV | ciphertext, base64. The magic prefix lets the
// reader tell a v1 blob from a legacy one without guessing.
const WRAP_MAGIC = [0x53, 0x4c, 0x57, 0x31]

function randomBytes(n) {
  const out = new Uint8Array(n)
  crypto.getRandomValues(out)
  return out
}

function encodeWrap(iv, ciphertext) {
  const out = new Uint8Array(WRAP_MAGIC.length + iv.length + ciphertext.length)
  out.set(WRAP_MAGIC, 0)
  out.set(iv, WRAP_MAGIC.length)
  out.set(ciphertext, WRAP_MAGIC.length + iv.length)
  return toB64(out)
}

function decodeWrap(bytes) {
  const isV1 = WRAP_MAGIC.every((b, i) => bytes[i] === b)
  if (isV1 && bytes.length > WRAP_MAGIC.length + 12) {
    return {
      legacy: false,
      iv: bytes.slice(WRAP_MAGIC.length, WRAP_MAGIC.length + 12),
      ciphertext: bytes.slice(WRAP_MAGIC.length + 12),
    }
  }
  return { legacy: true, iv: null, ciphertext: bytes }
}

// ─── Key generation ───────────────────────────────────────────────────────────

export async function generateKeyPair() {
  if (hasSubtleCrypto) {
    return crypto.subtle.generateKey(
      { name: 'RSA-OAEP', modulusLength: 4096, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['encrypt', 'decrypt'],
    )
  }
  // Forge fallback in a Web Worker so the UI doesn't freeze
  return new Promise((resolve, reject) => {
    const worker = new KeygenWorker()
    worker.onmessage = ({ data }) => {
      worker.terminate()
      if (data.error) { reject(new Error(data.error)); return }
      resolve({
        publicKey:  { _forge: true, key: forge.pki.publicKeyFromPem(data.pubPem) },
        privateKey: { _forge: true, key: forge.pki.privateKeyFromPem(data.privPem) },
      })
    }
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'Worker failed')) }
    worker.postMessage('go')
  })
}

// ─── Key export / import ──────────────────────────────────────────────────────

export async function exportPublicKeyBase64(publicKey) {
  if (publicKey && publicKey._forge) {
    const der = forge.asn1.toDer(forge.pki.publicKeyToAsn1(publicKey.key)).getBytes()
    return btoa(der)
  }
  const spki = await crypto.subtle.exportKey('spki', publicKey)
  return toB64(spki)
}

export async function encryptPrivateKey(privateKey, password, serverSalt) {
  const keyBytes  = await deriveWrapKey(password, serverSalt)
  const iv        = randomBytes(12)
  const pkcs8Bytes = (privateKey && privateKey._forge)
    ? forgePrivToPkcs8Bytes(privateKey.key)
    : new Uint8Array(await crypto.subtle.exportKey('pkcs8', privateKey))

  if (hasSubtleCrypto && !(privateKey && privateKey._forge)) {
    const aesKey    = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt'])
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, pkcs8Bytes)
    return encodeWrap(iv, new Uint8Array(encrypted))
  }
  return encodeWrap(iv, forgeAesGcmEncrypt(keyBytes, iv, pkcs8Bytes))
}

export async function decryptPrivateKey(encryptedKey, password, serverSalt) {
  const wrapped  = decodeWrap(fromB64(typeof encryptedKey === 'string' ? encryptedKey : encryptedKey.data))
  const cipherData = wrapped.ciphertext

  let keyBytes
  let iv
  if (wrapped.legacy) {
    // Written before random IVs: the IV was derived from the password.
    const material = await deriveLegacyKeyMaterial(password, serverSalt)
    keyBytes = material.slice(0, 32)
    iv = material.slice(32, 44)
  } else {
    keyBytes = await deriveWrapKey(password, serverSalt)
    iv = wrapped.iv
  }

  let pkcs8Bytes
  if (hasSubtleCrypto) {
    const aesKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt'])
    const plain  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, cipherData)
    pkcs8Bytes   = new Uint8Array(plain)
    return crypto.subtle.importKey('pkcs8', pkcs8Bytes, { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['decrypt'])
  }
  pkcs8Bytes = forgeAesGcmDecrypt(keyBytes, iv, cipherData)
  return { _forge: true, key: pkcs8BytesToForgePriv(pkcs8Bytes) }
}

export async function getPublicCryptoKeyFromPrivate(privateKey) {
  if (privateKey && privateKey._forge) {
    const pub = forge.pki.setRsaPublicKey(privateKey.key.n, privateKey.key.e)
    return { _forge: true, key: pub }
  }
  const jwk    = await crypto.subtle.exportKey('jwk', privateKey)
  const pubJwk = { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: jwk.alg, ext: true, key_ops: ['encrypt'] }
  return crypto.subtle.importKey('jwk', pubJwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['encrypt'])
}

export async function importPublicKeyBase64(base64) {
  if (!hasSubtleCrypto) {
    const asn1 = forge.asn1.fromDer(atob(base64))
    return { _forge: true, key: forge.pki.publicKeyFromAsn1(asn1) }
  }
  return crypto.subtle.importKey('spki', fromB64(base64), { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['encrypt'])
}

export async function hashPublicKey(publicKeyBase64) {
  if (!hasSubtleCrypto) {
    const md = forge.md.sha256.create()
    md.update(atob(publicKeyBase64))
    return btoa(md.digest().getBytes())
  }
  const hash = await crypto.subtle.digest('SHA-256', fromB64(publicKeyBase64))
  return toB64(hash)
}

export async function exportPublicKeyFromPrivate(privateKey) {
  const pubKey = await getPublicCryptoKeyFromPrivate(privateKey)
  return exportPublicKeyBase64(pubKey)
}

// ─── Email encryption / decryption ───────────────────────────────────────────

export async function encryptEmail(plaintext, publicKey) {
  const useForge = !hasSubtleCrypto || (publicKey && publicKey._forge)

  // Prefer crypto.getRandomValues when available (works even on HTTP)
  const getRandomBytes = (n) => {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      return crypto.getRandomValues(new Uint8Array(n))
    }
    const b = new Uint8Array(n)
    for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256)
    return b
  }

  const iv     = getRandomBytes(12)
  const aesRaw = getRandomBytes(32)
  const enc    = new TextEncoder()

  if (useForge) {
    const fKey     = publicKey._forge ? publicKey.key : null
    if (!fKey) throw new Error('incompatible key type for forge enc path')
    const aesCipher = forgeAesGcmEncrypt(aesRaw, iv, enc.encode(plaintext))
    const rsaCipher = fKey.encrypt(toForgeBin(aesRaw), 'RSA-OAEP', forgeOaepParams())
    const dataOut   = new Uint8Array(12 + aesCipher.length)
    dataOut.set(iv, 0)
    dataOut.set(aesCipher, 12)
    return { aes_encrypted: toB64(wrapKeyEnvelope(new Uint8Array(rsaCipher)).buffer), data_encrypted: toB64(dataOut.buffer) }
  }

  const aesKey    = await crypto.subtle.importKey('raw', aesRaw, { name: 'AES-GCM' }, false, ['encrypt'])
  const aesCipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, enc.encode(plaintext))
  const rsaCipher = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, aesRaw)
  const dataOut   = new Uint8Array(12 + aesCipher.byteLength)
  dataOut.set(iv, 0)
  dataOut.set(new Uint8Array(aesCipher), 12)
  return { aes_encrypted: toB64(wrapKeyEnvelope(new Uint8Array(rsaCipher)).buffer), data_encrypted: toB64(dataOut.buffer) }
}


// --- Wire format versioning -------------------------------------------------
// The AES key for each message is stored wrapped to the recipient's public key.
// That blob is the thing a future algorithm change has to replace, so it now
// carries its own version. Old blobs have no prefix and stay readable forever.
const KEY_ENVELOPE_MAGIC = [0x53, 0x4c, 0x4b, 0x01] // "SLK" + version 1

function wrapKeyEnvelope(cipherBytes) {
  const out = new Uint8Array(cipherBytes.length + KEY_ENVELOPE_MAGIC.length)
  out.set(KEY_ENVELOPE_MAGIC, 0)
  out.set(cipherBytes, KEY_ENVELOPE_MAGIC.length)
  return out
}

function unwrapKeyEnvelope(bytes) {
  for (let i = 0; i < KEY_ENVELOPE_MAGIC.length; i++) {
    if (bytes[i] !== KEY_ENVELOPE_MAGIC[i]) return { version: 0, cipher: bytes }
  }
  return { version: 1, cipher: bytes.slice(KEY_ENVELOPE_MAGIC.length) }
}


// ─── Post-quantum at-rest protection ─────────────────────────────────────────
// Mail is stored under AES-256-GCM with the key wrapped to the account's RSA
// key. RSA is what a quantum computer breaks, and mail is the data someone
// harvests today to open later. The wrap is therefore hybrid: the data key comes
// from an RSA-OAEP seed *and* an ML-KEM-768 shared secret, combined through
// HKDF. Opening a message needs both halves.
//
// Envelope in the message_key slot:  "SLQ" | 0x01 | len(u16 BE) | rsa_ct | mlkem_ct
// No prefix at all still means "before this existed", which is why old mail keeps
// opening forever — it can never be re-created, only re-encrypted deliberately.

const PQ_MAGIC = [0x53, 0x4c, 0x51, 0x01]
const PQ_INFO_SALT = 'sloth-mail/atrest/v1'

export function isPqEnvelope(bytes) {
  return bytes.length > 6 && PQ_MAGIC.every((b, i) => bytes[i] === b)
}

function parsePqEnvelope(bytes) {
  const rsaLen = (bytes[4] << 8) | bytes[5]
  return {
    rsaCiphertext: bytes.slice(6, 6 + rsaLen),
    mlkemCiphertext: bytes.slice(6 + rsaLen),
  }
}

/** Generate an ML-KEM-768 keypair for this account. */
export function generatePqKeyPair() {
  const pair = ml_kem768.keygen()
  return { publicKey: pair.publicKey, secretKey: pair.secretKey }
}

/** Wrap the PQ secret key under the same password-derived key as the RSA key. */
export async function wrapSecretBytes(bytes, password, serverSalt) {
  const keyBytes = await deriveWrapKey(password, serverSalt)
  const iv = randomBytes(12)
  if (!hasSubtleCrypto) throw new Error('post-quantum keys need a secure connection')
  const aesKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt'])
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, bytes)
  return encodeWrap(iv, new Uint8Array(sealed))
}

export async function unwrapSecretBytes(b64, password, serverSalt) {
  const wrapped = decodeWrap(fromB64(b64))
  if (wrapped.legacy) throw new Error('post-quantum key was stored in an unknown format')
  const keyBytes = await deriveWrapKey(password, serverSalt)
  const aesKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt'])
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: wrapped.iv }, aesKey, wrapped.ciphertext)
  return new Uint8Array(plain)
}

/** HKDF-SHA256 over both shared secrets, bound to the account name. */
async function combineHybridKey(rsaSeed, mlkemSecret, username) {
  const ikm = new Uint8Array(rsaSeed.length + mlkemSecret.length)
  ikm.set(new Uint8Array(rsaSeed), 0)
  ikm.set(new Uint8Array(mlkemSecret), rsaSeed.length)
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(PQ_INFO_SALT),
      info: new TextEncoder().encode(username || ''),
    },
    base,
    256,
  )
  return new Uint8Array(bits)
}

export async function decryptEmailBytes(data, messageKey, privateKey, pqSecretKey = null, username = '') {
  // The secret arrives as base64 from sessionStorage and as raw bytes from callers
  // that already decoded it. Accepting both here means no call site has to know
  // which, which is how one of them ended up passing a string to decapsulate.
  if (typeof pqSecretKey === 'string' && pqSecretKey) pqSecretKey = fromB64(pqSecretKey)
  if (!messageKey) {
    // No per-recipient key means the message is either plain text from outside
    // or one we cannot open. Guessing "plain text" renders ciphertext as
    // gibberish, which looks like corruption and hides the real problem: say so
    // instead.
    const decoded = new TextDecoder().decode(fromB64(data))
    const looksLikeMessage = /^[\s\S]{0,2000}?\n[A-Za-z-]+:/.test(decoded.slice(0, 4000))
    if (!looksLikeMessage) {
      throw new Error('no message key for this recipient')
    }
    return fromB64(data)
  }

  const keyBytesRaw = fromB64(messageKey)
  if (isPqEnvelope(keyBytesRaw)) {
    if (!pqSecretKey) {
      // Not an error in the message: the session simply has no PQ key loaded,
      // which is what a cached bundle or a half-finished login looks like.
      const e = new Error('This message is quantum-protected. Sign out and back in to load this device\'s post-quantum key.')
      e.code = 'pq_key_missing'
      throw e
    }
    if (!hasSubtleCrypto) {
      const e = new Error('Quantum-protected messages need a secure HTTPS connection to open.')
      e.code = 'pq_needs_https'
      throw e
    }
    const { rsaCiphertext, mlkemCiphertext } = parsePqEnvelope(keyBytesRaw)
    let rsaSeed
    try {
      rsaSeed = new Uint8Array(await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, rsaCiphertext))
    } catch (err) {
      const e = new Error('message key could not be unwrapped: sealed for a different key than this account holds')
      e.code = 'key_mismatch'
      e.cause = err
      throw e
    }
    let mlkemSecret
    try {
      mlkemSecret = ml_kem768.decapsulate(mlkemCiphertext, pqSecretKey)
    } catch (err) {
      const e = new Error('the post-quantum half of this message could not be opened: it was sealed for a different key')
      e.code = 'pq_key_mismatch'
      e.cause = err
      throw e
    }
    const hybridKey = await combineHybridKey(rsaSeed, mlkemSecret, username)
    const aesKeyPq = await crypto.subtle.importKey('raw', hybridKey, { name: 'AES-GCM' }, false, ['decrypt'])
    const bodyBuf = fromB64(data)
    let plainPq
    try {
      plainPq = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bodyBuf.slice(0, 12) }, aesKeyPq, bodyBuf.slice(12))
    } catch (err) {
      const e = new Error('message body failed authentication: the stored data is damaged or truncated')
      e.code = 'body_corrupt'
      e.cause = err
      throw e
    }
    return new Uint8Array(plainPq)
  }

  const envelope = unwrapKeyEnvelope(fromB64(messageKey))
  messageKey = toB64(envelope.cipher.buffer ? envelope.cipher.buffer : envelope.cipher)

  const useForge = !hasSubtleCrypto || (privateKey && privateKey._forge)

  if (useForge) {
    const fKey      = privateKey._forge ? privateKey.key : null
    if (!fKey) throw new Error('incompatible key type for forge dec path')
    const aesRawBin = fKey.decrypt(atob(messageKey), 'RSA-OAEP', forgeOaepParams())
    const aesRaw    = fromForgeBin(aesRawBin)
    const dataBuf   = fromB64(data)
    const iv        = dataBuf.slice(0, 12)
    const ciphertext = dataBuf.slice(12)
    const plain = forgeAesGcmDecrypt(aesRaw, iv, ciphertext)
    return plain
  }

  let aesRaw
  try {
    aesRaw = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, fromB64(messageKey))
  } catch (err) {
    // Distinguish "this message was sealed for a different key" from "the
    // data is damaged": the fixes are completely different, and both used to
    // surface as a single opaque failure.
    const e = new Error('message key could not be unwrapped: sealed for a different key than this account holds')
    e.code = 'key_mismatch'
    e.cause = err
    throw e
  }
  const aesKey = await crypto.subtle.importKey('raw', aesRaw, { name: 'AES-GCM' }, false, ['decrypt'])
  const dataBuf    = fromB64(data)
  const iv         = dataBuf.slice(0, 12)
  const ciphertext = dataBuf.slice(12)
  let plain
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ciphertext)
  } catch (err) {
    const e = new Error('message body failed authentication: the stored data is damaged or truncated')
    e.code = 'body_corrupt'
    e.cause = err
    throw e
  }
  return plain
}

/** Reader-facing wrapper: bytes are for re-sealing, text is for display. */
export async function decryptEmail(data, messageKey, privateKey, pqSecretKey = null, username = '') {
  const bytes = await decryptEmailBytes(data, messageKey, privateKey, pqSecretKey, username)
  return new TextDecoder().decode(bytes)
}

/**
 * Seal bytes under both the RSA and the ML-KEM public key of an account.
 *
 * Used to move mail that was stored before post-quantum protection existed into
 * the hybrid envelope: the browser does the sealing because only it can open the
 * old message first, and the plaintext never leaves the machine.
 */
export async function sealHybridPayload(bytes, rsaPublicKeyBase64, pqPublicKeyBase64, username) {
  if (!hasSubtleCrypto) throw new Error('re-sealing needs a secure HTTPS connection')
  const rsaPublic = await crypto.subtle.importKey(
    'spki', fromB64(rsaPublicKeyBase64), { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['encrypt'],
  )
  const seed = randomBytes(32)
  const rsaCiphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, rsaPublic, seed))
  const { cipherText, sharedSecret } = ml_kem768.encapsulate(fromB64(pqPublicKeyBase64))
  const keyBytes = await combineHybridKey(seed, sharedSecret, username)

  const iv = randomBytes(12)
  const aesKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt'])
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, bytes))

  const body = new Uint8Array(12 + sealed.length)
  body.set(iv, 0)
  body.set(sealed, 12)

  const envelope = new Uint8Array(6 + rsaCiphertext.length + cipherText.length)
  envelope.set(PQ_MAGIC, 0)
  envelope[4] = (rsaCiphertext.length >> 8) & 0xff
  envelope[5] = rsaCiphertext.length & 0xff
  envelope.set(rsaCiphertext, 6)
  envelope.set(cipherText, 6 + rsaCiphertext.length)

  return { data: toB64(body.buffer), messageKey: toB64(envelope.buffer) }
}
