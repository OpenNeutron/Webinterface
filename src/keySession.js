import forge from 'node-forge'
import { hasSubtleCrypto } from './crypto'

const SESSION_KEY = 'openneutron.private_key'
const SALT_KEY = 'openneutron.salt'
const PQ_KEY = 'openneutron.pq_key'

let privateKeyCache = null
let pqSecretCache = null

// ─── Binary helpers (duplicated locally to avoid circular imports) ────────────
function toForgeBin(u8) { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return s }
function fromForgeBin(s) { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u }
function toB64(u8) { let b = ''; for (let i = 0; i < u8.length; i++) b += String.fromCharCode(u8[i]); return btoa(b) }
function fromB64(b64) { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u }

// Serialize either a WebCrypto CryptoKey or a forge key handle to PKCS#8 DER base64
async function serializeKey(key) {
  if (key && key._forge) {
    const inner   = forge.pki.privateKeyToAsn1(key.key)
    const wrapped = forge.pki.wrapRsaPrivateKey(inner)
    const der     = fromForgeBin(forge.asn1.toDer(wrapped).getBytes())
    return { format: 'pkcs8b64', data: toB64(der) }
  }
  const jwk = await crypto.subtle.exportKey('jwk', key)
  return { format: 'jwk', data: jwk }
}

// Deserialize a stored key — always produces the right type for the current environment
async function deserializeKey(stored) {
  if (stored.format === 'pkcs8b64') {
    const bytes = fromB64(stored.data)
    if (hasSubtleCrypto) {
      return crypto.subtle.importKey('pkcs8', bytes, { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['decrypt'])
    }
    const asn1      = forge.asn1.fromDer(toForgeBin(bytes))
    const innerAsn1 = forge.asn1.fromDer(asn1.value[2].value)
    return { _forge: true, key: forge.pki.privateKeyFromAsn1(innerAsn1) }
  }
  // JWK (WebCrypto-generated key — only loadable when subtle is available)
  if (hasSubtleCrypto) {
    return crypto.subtle.importKey('jwk', stored.data, { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['decrypt'])
  }
  return null // JWK without subtle → cannot import; force re-login
}

export const keySession = {
  set: async (key) => {
    console.log('[keySession] set() — storing key in memory + sessionStorage')
    privateKeyCache = key
    try {
      const serialized = await serializeKey(key)
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(serialized))
      console.log('[keySession] ✅ Key persisted to sessionStorage (format:', serialized.format, ')')
    } catch (err) {
      sessionStorage.removeItem(SESSION_KEY)
      console.error('[keySession] ❌ Failed to persist key:', err)
      throw err
    }
  },

  get: async () => {
    if (privateKeyCache) {
      console.log('[keySession] get() — returning cached key')
      return privateKeyCache
    }
    const raw = sessionStorage.getItem(SESSION_KEY)
    console.log('[keySession] get() — cache miss, sessionStorage has key:', !!raw)
    if (!raw) {
      console.warn('[keySession] ⚠️ No key in sessionStorage — re-login required')
      return null
    }
    try {
      let stored
      try {
        stored = JSON.parse(raw)
      } catch {
        sessionStorage.removeItem(SESSION_KEY)
        return null
      }
      // Legacy: old sessions stored raw JWK object directly (no format wrapper)
      if (!stored.format) stored = { format: 'jwk', data: stored }
      const key = await deserializeKey(stored)
      if (!key) {
        console.warn('[keySession] ⚠️ Cannot restore key without Web Crypto API — re-login required')
        sessionStorage.removeItem(SESSION_KEY)
        return null
      }
      privateKeyCache = key
      console.log('[keySession] ✅ Key restored from sessionStorage')
      return privateKeyCache
    } catch (err) {
      console.error('[keySession] ❌ Failed to restore key:', err)
      sessionStorage.removeItem(SESSION_KEY)
      return null
    }
  },

  clear: () => {
    console.log('[keySession] clear() — wiping memory + sessionStorage')
    privateKeyCache = null
    pqSecretCache = null
    sessionStorage.removeItem(SESSION_KEY)
    sessionStorage.removeItem(SALT_KEY)
    sessionStorage.removeItem(PQ_KEY)
  },

  // The post-quantum secret key, base64 of the raw ML-KEM-768 bytes. Kept in
  // sessionStorage beside the RSA key so a reload does not force a re-login,
  // and wiped with it on sign-out.
  setPq: (base64Secret) => {
    if (!base64Secret) return
    pqSecretCache = base64Secret
    try { sessionStorage.setItem(PQ_KEY, base64Secret) } catch (err) { console.warn('[keySession] pq key not persisted:', err) }
  },
  getPq: () => pqSecretCache || sessionStorage.getItem(PQ_KEY),

  setSalt: (salt) => {
    console.log('[keySession] setSalt():', salt)
    sessionStorage.setItem(SALT_KEY, salt)
  },
  getSalt: () => sessionStorage.getItem(SALT_KEY),
}

