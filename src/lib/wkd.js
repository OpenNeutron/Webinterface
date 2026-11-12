import * as openpgp from 'openpgp'

/**
 * Key discovery: Web Key Directory (WKD) first, then keys.openpgp.org.
 *
 * WKD is the authoritative source for a domain — it is the domain owner's own
 * published key — but most domains do not run it and many do not send CORS
 * headers, so the keyserver is the realistic fallback.
 */

const ZBASE32 = 'ybndrfg8ejkmcpqxot1uwisza345h769'

/**
 * RFC 6189 z-base-32: the z-base-32 *alphabet* with standard base32 bit order,
 * i.e. five bits per character taken most-significant first. Packing the other
 * way round produces plausible-looking but wrong hashes that no client asks for
 * — verified against GnuPG's own WKD lookup, which is the authority here.
 */
export function zbase32(bytes) {
  let out = ''
  let value = 0
  let bits = 0
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ZBASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ZBASE32[(value << (5 - bits)) & 31]
  return out
}

/** zbase32(sha1(lowercased local part)) — the WKD identifier for an address. */
export async function wkdHash(address) {
  const local = String(address).split('@')[0].toLowerCase()
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(local))
  return zbase32(new Uint8Array(digest))
}

export async function wkdUrl(address) {
  const [local, domain] = String(address).split('@')
  if (!domain) throw new Error('Not an email address')
  const hash = await wkdHash(address)
  // Advanced method, per the WKD spec: the key lives under
  // /.well-known/openpgpkey/<domain>/hu/<hash> and the address's local part
  // travels as ?l=. Omitting either yields a 404 on every real WKD host -- this
  // server's catch-all served the key anyway, which hid the fault internally
  // while breaking lookups for addresses on other domains.
  return `https://openpgpkey.${domain}/.well-known/openpgpkey/${domain}/hu/${hash}?l=${encodeURIComponent(local.toLowerCase())}`
}


/**
 * Does this key actually belong to the address we asked about?
 *
 * One domain can host many mailboxes, and both a WKD vhost with a catch-all and
 * a keyserver entry can hand back a key for a different person on that domain.
 * Encrypting to the wrong mailbox's key produces mail that its intended
 * recipient can never open, so a lookup only counts when a user ID carries the
 * exact address.
 */
function keyBelongsTo(key, email) {
  const wanted = String(email).trim().toLowerCase()
  const uids = key.getUserIDs().map((u) => String(u).toLowerCase())
  return uids.some((uid) => uid.includes(`<${wanted}>`) || uid.trim() === wanted)
}

async function fetchWkd(address) {
  const url = await wkdUrl(address)
  // A missing or unreachable WKD host is "no key published here", not an error: this is
  // the normal state for most domains, and a bare "NetworkError" tells the reader nothing.
  let res
  try {
    res = await fetch(url, { redirect: 'follow' })
  } catch {
    return null
  }
  if (!res.ok) return null
  const buffer = new Uint8Array(await res.arrayBuffer())
  if (buffer.length < 64) return null
  const key = await openpgp.readKey({ binaryKey: buffer })
  if (!keyBelongsTo(key, address)) return null
  return { armored: key.toPublic().armor(), source: 'wkd', url }
}

async function fetchKeyserver(address) {
  const url = `https://keys.openpgp.org/vks/v1/by-email/${encodeURIComponent(address)}`
  let res
  try {
    res = await fetch(url)
  } catch {
    return null
  }
  if (!res.ok) return null
  const text = await res.text()
  if (!text.includes('BEGIN PGP PUBLIC KEY BLOCK')) return null
  const key = await openpgp.readKey({ armoredKey: text })
  if (!keyBelongsTo(key, address)) return null
  return { armored: key.toPublic().armor(), source: 'keys.openpgp.org', url }
}

/**
 * Find a usable public key for an address.
 *
 * Nothing here decides trust: the caller pins the fingerprint, and the UI is
 * expected to show where the key came from.
 */
export async function lookupKey(address) {
  const email = String(address).trim().toLowerCase()
  if (!email.includes('@')) return null

  for (const finder of [fetchWkd, fetchKeyserver]) {
    try {
      const found = await finder(email)
      if (found) return { ...found, email }
    } catch {
      // a CORS refusal or a broken WKD must not stop the fallback
    }
  }
  return null
}

export async function lookupMany(addresses) {
  const results = []
  for (const address of addresses) {
    results.push({ address, found: await lookupKey(address) })
  }
  return results
}

/**
 * Offer the public key to keys.openpgp.org, following their real VKS contract:
 * upload (JSON, returns a token) then request-verify for the address, which is
 * what actually sends the confirmation mail. Uploading alone publishes nothing.
 *
 * Their rate limit is one email lookup per minute and uploads cap at 1 MiB.
 */
export async function publishToKeyserver(armored, addresses) {
  let upload
  try {
    upload = await fetch('https://keys.openpgp.org/vks/v1/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keytext: armored }),
    })
  } catch {
    // Firefox's raw "NetworkError when attempting to fetch resource" reads like a bug in
    // this app. It means the browser could not reach the keyserver at all.
    throw new Error('Could not reach keys.openpgp.org from this browser. Check the connection and try again.')
  }
  const uploadText = (await upload.text()).trim()
  if (!upload.ok) throw new Error(explainKeyserverError(uploadText, upload.status))

  let payload
  try {
    payload = JSON.parse(uploadText)
  } catch {
    throw new Error('The keyserver replied with something unexpected')
  }

  const list = (addresses ?? Object.keys(payload.status ?? {})).map((a) => String(a).toLowerCase())
  if (!payload.token) {
    // Already published and verified: nothing further is required.
    return { fingerprint: payload.key_fpr ?? null, status: payload.status ?? {}, verificationSent: false }
  }

  let verify
  try {
    verify = await fetch('https://keys.openpgp.org/vks/v1/request-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: payload.token, addresses: list }),
    })
  } catch {
    throw new Error('The key was uploaded, but the browser could not reach the keyserver to send the verification mail. Try again in a minute.')
  }
  const verifyText = (await verify.text()).trim()
  if (!verify.ok) throw new Error(explainKeyserverError(verifyText, verify.status))

  return {
    fingerprint: payload.key_fpr ?? null,
    status: payload.status ?? {},
    verificationSent: true,
    addresses: list,
  }
}

function explainKeyserverError(text, status) {
  try {
    const parsed = JSON.parse(text)
    return parsed.error_description || parsed.error || `The keyserver refused the key (${status})`
  } catch {
    return text || `The keyserver refused the key (${status})`
  }
}
