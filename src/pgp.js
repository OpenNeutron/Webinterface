/**
 * A file, sealed to the same passphrase as the note body.
 *
 * The bytes go in as binary and come out as armour, so the recipient's browser
 * turns them straight back into a file without a base64 dance in between.
 */
export async function sealFileWithPassphrase({ bytes, passphrase }) {
  const phrase = (passphrase ?? '').trim()
  if (phrase.length < 12) {
    throw new Error('Use a longer passphrase — at least 12 characters')
  }
  return openpgp.encrypt({
    message: await openpgp.createMessage({ binary: bytes }),
    passwords: [phrase],
    format: 'armored',
  })
}

/**
 * OpenPGP support for Sloth Lee Mail.
 *
 * Two independent layers of protection exist here, and they are not the same
 * thing:
 *
 *   * the built-in E2EE (RSA key pair, key wrapped with the login password)
 *     protects mail *at rest on this server*
 *   * OpenPGP protects a message *in transit and at the recipient*, and works
 *     with people who do not use this server at all
 *
 * Keys live in the browser only. The private key is stored passphrase-encrypted
 * (OpenPGP does that itself); the passphrase is never persisted anywhere, so
 * decrypting always requires the user to type it.
 */

import * as openpgp from 'openpgp'

// Ring reading and the armour test live in lib/pgpRing.js so the page can use them without
// loading the OpenPGP library; they are re-exported here so nothing that imports them moves.
import { RING_KEY, emptyRing, loadRing, hasIdentity, looksEncrypted } from '@/lib/pgpRing'
export { loadRing, hasIdentity, looksEncrypted }

function contactArmor(contact) {
  return typeof contact === 'string' ? contact : contact?.armored ?? ''
}

function contactFingerprint(contact) {
  return typeof contact === 'string' ? null : contact?.fingerprint ?? null
}

function saveRing(ring) {
  localStorage.setItem(RING_KEY, JSON.stringify(ring))
  return ring
}

/** The account's own OpenPGP identity, or null when none has been created. */
export function getIdentity() {
  return loadRing().identity
}

/**
 * Create a new OpenPGP key pair for this account.
 *
 * curve25519 is used rather than RSA-4096: same practical strength for mail,
 * far smaller keys and much faster generation in a browser.
 */
export async function generateIdentity({ name, email, passphrase }) {
  if (!name?.trim()) throw new Error('A name is required')
  if (!email?.includes('@')) throw new Error('A valid email is required')
  if (!passphrase || passphrase.length < 8) {
    throw new Error('Use a passphrase of at least 8 characters')
  }

  const { publicKey, privateKey } = await openpgp.generateKey({
    type: 'ecc',
    curve: 'curve25519Legacy',
    userIDs: [{ name: name.trim(), email: email.trim().toLowerCase() }],
    passphrase,
    format: 'armored',
  })

  const publicKeyObj = await openpgp.readKey({ armoredKey: publicKey })
  const fingerprint = publicKeyObj.getFingerprint().toUpperCase()

  const ring = loadRing()
  ring.identity = {
    name: name.trim(),
    email: email.trim().toLowerCase(),
    publicKey,
    privateKey,
    fingerprint,
    createdAt: Date.now(),
  }
  // Your own key is also the key used when you mail yourself.
  ring.contacts[ring.identity.email] = { armored: publicKey, fingerprint }
  saveRing(ring)
  return ring.identity
}

export function exportPublicKey() {
  return loadRing().identity?.publicKey ?? null
}

/** Put an identity back after it was recovered from the account (new device). */
export function restoreIdentity(identity) {
  if (!identity?.privateKey || !identity?.publicKey) throw new Error('That key is incomplete')
  const ring = loadRing()
  ring.identity = {
    name: identity.name || '',
    email: (identity.email || '').toLowerCase(),
    publicKey: identity.publicKey,
    privateKey: identity.privateKey,
    fingerprint: (identity.fingerprint || '').toUpperCase(),
    createdAt: identity.createdAt || Date.now(),
    restoredFromAccount: true,
  }
  if (ring.identity.email) {
    ring.contacts[ring.identity.email] = {
      armored: identity.publicKey,
      fingerprint: ring.identity.fingerprint,
    }
  }
  saveRing(ring)
  return ring.identity
}

export function forgetIdentity() {
  const ring = loadRing()
  if (ring.identity) {
    delete ring.contacts[ring.identity.email]
  }
  ring.identity = null
  saveRing(ring)
}

/** Import somebody else's public key so mail to them can be encrypted. */
/**
 * Why an imported key cannot be used, or null when it is fine.
 *
 * Trust-on-first-use with the honest exception: a key that has expired or been
 * revoked must never silently replace a working one.
 */
async function keyProblem(key) {
  // isRevoked() is async in openpgp v6 — treating its Promise as a boolean makes
  // every key look revoked.
  if (typeof key.isRevoked === 'function') {
    const revoked = await key.isRevoked()
    if (revoked) return 'That key has been revoked'
  }
  // getExpirationTime() is async in openpgp v6 and hands back a Date, a
  // timestamp or Infinity; awaiting a non-Promise is harmless, so resolve first.
  let expiration = key.getExpirationTime?.()
  if (expiration && typeof expiration.then === 'function') expiration = await expiration
  let expiresAt = null
  if (expiration instanceof Date) expiresAt = expiration.getTime()
  else if (typeof expiration === 'number' && Number.isFinite(expiration)) {
    expiresAt = expiration < 1e12 ? expiration * 1000 : expiration
  }
  if (expiresAt !== null && expiresAt < Date.now()) return 'That key has expired'

  const algo = key.getAlgorithmInfo?.()
  if (algo?.algorithm === 'rsa' && algo.bits && algo.bits < 2048) {
    return `That RSA key is only ${algo.bits} bits — 2048 or more is required`
  }
  if (!key.getUserIDs?.()?.length) return 'That key has no user ID'
  return null
}

export async function importPublicKey(armored, { replace = false } = {}) {
  const key = await openpgp.readKey({ armoredKey: armored.trim() })
  const problem = await keyProblem(key)
  if (problem) throw new Error(problem)

  const userID = key.getUserIDs()?.[0] ?? ''
  const match = userID.match(/<([^>]+)>/)
  const email = (match ? match[1] : userID).trim().toLowerCase()
  if (!email.includes('@')) {
    throw new Error('That key has no email address attached')
  }

  const fingerprint = key.getFingerprint().toUpperCase()
  const ring = loadRing()
  const existing = ring.contacts[email]

  // Key change for an address you already trust is exactly how a MITM wins.
  if (existing && !replace) {
    const pinned = contactFingerprint(existing)
    if (pinned && pinned !== fingerprint) {
      const err = new Error(
        `A different key is already saved for ${email} (…${pinned.slice(-16)}). ` +
          `Accepting this one replaces that trust.`,
      )
      err.code = 'key_fingerprint_changed'
      err.pinned = pinned
      err.incoming = fingerprint
      throw err
    }
  }

  ring.contacts[email] = { armored: key.toPublic().armor(), fingerprint }
  saveRing(ring)
  return { email, fingerprint }
}

/**
 * Import an exported private key (.asc) so this browser can *read* mail sent to
 * that identity — the path for using one OpenPGP key on a phone and a desktop.
 *
 * The key stays passphrase-protected; the passphrase is asked for at send and
 * decrypt time, never stored.
 */
export async function importPrivateKeyFile(armored) {
  const text = (armored ?? '').trim()
  if (!text.includes('PRIVATE KEY BLOCK')) {
    throw new Error('That is not a private key file')
  }

  const key = await openpgp.readPrivateKey({ armoredKey: text })
  if (key.isDecrypted()) {
    throw new Error(
      'That key has no passphrase, which is unsafe to store in a browser. Export it again with a passphrase.',
    )
  }

  const userID = key.getUserIDs()?.[0] ?? ''
  const match = userID.match(/<([^>]+)>/)
  const email = (match ? match[1] : userID).trim().toLowerCase()
  if (!email.includes('@')) throw new Error('That key has no email address attached')
  const name = userID.replace(/<[^>]+>/g, '').replace(/\(.*\)/g, '').trim() || email

  const publicKey = key.toPublic().armor()
  const ring = loadRing()
  ring.identity = {
    name,
    email,
    publicKey,
    privateKey: key.armor(),
    fingerprint: key.getFingerprint().toUpperCase(),
    createdAt: Date.now(),
    imported: true,
  }
  ring.contacts[email] = { armored: publicKey, fingerprint: key.getFingerprint().toUpperCase() }
  saveRing(ring)
  return ring.identity
}

/** Import any .asc file: private keys become the identity, public keys a contact. */
export async function importKeyFile(armored) {
  const text = (armored ?? '').trim()
  if (text.includes('PRIVATE KEY BLOCK')) {
    const identity = await importPrivateKeyFile(text)
    return { kind: 'private', email: identity.email }
  }
  if (text.includes('PUBLIC KEY BLOCK')) {
    const { email } = await importPublicKey(text)
    return { kind: 'public', email }
  }
  throw new Error('That file is not a PGP key')
}

export function removeContact(email) {
  const ring = loadRing()
  delete ring.contacts[email.toLowerCase()]
  saveRing(ring)
}

/**
 * Forget a contact's key. Used when a key turns out to be wrong or stale: an
 * address with no key sends unencrypted and says so, which is safer than
 * encrypting to a key nobody can read.
 */
/**
 * Replace a contact's key on purpose.
 *
 * Normal import refuses to overwrite a pinned key, because a silently swapped
 * key is how interception wins. But a key can also simply be wrong — an old
 * keyserver entry for an address whose owner has since moved. This is the
 * deliberate path: the caller must have shown the user both fingerprints.
 */
export async function replaceContactKey(armored) {
  const { readKey } = await import('openpgp')
  const key = await readKey({ armoredKey: armored })
  const fingerprint = key.getFingerprint().toUpperCase()
  const email = (key.getUserIDs()[0] || '').replace(/^.*<|>.*$/g, '').toLowerCase() || null
  if (!email || !email.includes('@')) throw new Error('That key has no email address on it')

  const ring = loadRing()
  const previous = ring.contacts[email]?.fingerprint || null
  ring.contacts[email] = { armored: key.toPublic().armor(), fingerprint }
  saveRing(ring)
  return { email, fingerprint, previous }
}

export function removeContactKey(address) {
  const ring = loadRing()
  const key = String(address || '').toLowerCase().trim()
  if (!key || !ring.contacts[key]) return false
  if (ring.identity?.email?.toLowerCase() === key) return false
  delete ring.contacts[key]
  saveRing(ring)
  return true
}

/**
 * Mark a contact's key as verified: the user compared the fingerprint with the
 * person through some other channel. Until that happens a key is only
 * "arrived automatically", which is usable but not proof of who it belongs to.
 */
export function markContactVerified(address, verified = true) {
  const ring = loadRing()
  const key = String(address || '').toLowerCase().trim()
  if (!ring.contacts[key]) return false
  ring.contacts[key] = { ...ring.contacts[key], verified: Boolean(verified) }
  saveRing(ring)
  return true
}

export function listContacts() {
  return Object.entries(loadRing().contacts).map(([email, contact]) => ({
    email,
    armored: contactArmor(contact),
    fingerprint: contactFingerprint(contact),
    verified: Boolean(contact.verified),
  }))
}

/** Which of these addresses can receive OpenPGP mail from this browser. */
export function keyCoverage(addresses) {
  const ring = loadRing()
  const missing = addresses
    .map((a) => (a ?? '').toLowerCase().trim())
    .filter(Boolean)
    .filter((a) => !contactArmor(ring.contacts[a]) || !ring.contacts[a])
  return { canEncrypt: missing.length === 0 && addresses.length > 0, missing }
}

/**
 * Encrypt (and sign, when an identity exists) a message body for every
 * recipient. Returns armored PGP text suitable for an ordinary mail body.
 */

/** Recipients plus yourself — a message you cannot decrypt later is a lost message. */
function withSelf(recipients) {
  const ring = loadRing()
  const list = (recipients ?? []).map((a) => (a ?? '').toLowerCase().trim()).filter(Boolean)
  const own = ring.identity?.email
  if (own && !list.includes(own) && contactArmor(ring.contacts[own])) list.push(own)
  return list
}

export async function encryptBody({ text, recipients, passphrase }) {
  const ring = loadRing()
  const targets = withSelf(recipients)
  const coverage = keyCoverage(targets)
  if (!coverage.canEncrypt) {
    throw new Error(`No OpenPGP key for: ${coverage.missing.join(', ')}`)
  }

  const encryptionKeys = await Promise.all(
    targets.map((address) => openpgp.readKey({ armoredKey: contactArmor(ring.contacts[address]) })),
  )

  let signingKeys
  if (ring.identity) {
    signingKeys = await openpgp.decryptKey({
      privateKey: await openpgp.readPrivateKey({ armoredKey: ring.identity.privateKey }),
      passphrase,
    })
  }

  return openpgp.encrypt({
    message: await openpgp.createMessage({ text }),
    encryptionKeys,
    signingKeys,
    format: 'armored',
  })
}

/**
 * Seal a note to a set of recipients, and only them.
 *
 * Unlike encryptBody this does not add our own key and does not sign: the note
 * is stored on the server until the recipient opens the link, and a copy
 * encrypted to us would mean the server's operator could read a message the
 * sender was promised was sealed. Unsigned is the price of not needing the
 * private-key passphrase to write a note.
 */
export async function sealToRecipients({ text, recipients }) {
  const ring = loadRing()
  // Contacts are stored under the lower-case address. Looking one up with the
  // case the sender typed ("Samsmith@…") finds nothing, and openpgp's own error
  // for a missing armoredKey ("readKey: must pass options object…") names
  // neither the address nor the problem.
  const targets = (recipients ?? [])
    .map((address) => (address ?? '').toLowerCase().trim())
    .filter(Boolean)
  const coverage = keyCoverage(targets)
  if (!coverage.canEncrypt) {
    throw new Error(`No OpenPGP key for: ${coverage.missing.join(', ')}`)
  }
  const encryptionKeys = await Promise.all(
    targets.map(async (address) => {
      const armor = contactArmor(ring.contacts[address])
      if (!armor) throw new Error(`No OpenPGP key for: ${address}`)
      return openpgp.readKey({ armoredKey: armor })
    }),
  )
  return openpgp.encrypt({
    message: await openpgp.createMessage({ text }),
    encryptionKeys,
    format: 'armored',
  })
}

/**
 * Seal a note with a passphrase instead of a key.
 *
 * A recipient on another provider often has no OpenPGP key at all, and asking
 * a stranger to install one is not a design. Symmetric armour lets them read
 * the note on any device with the phrase the sender passes on separately; the
 * server holds the ciphertext and never sees either.
 */
export async function sealWithPassphrase({ text, passphrase }) {
  const phrase = (passphrase ?? '').trim()
  if (phrase.length < 12) {
    throw new Error('Use a longer passphrase — at least 12 characters')
  }
  return openpgp.encrypt({
    message: await openpgp.createMessage({ text }),
    passwords: [phrase],
    format: 'armored',
  })
}

/**
 * Encrypt a file's bytes for a set of recipients.
 *
 * Inline PGP can only protect a body, so attachments travel as their own
 * encrypted file: the recipient downloads an .asc and decrypts it with the same
 * passphrase. That keeps attachments inside the existing send pipeline instead
 * of needing PGP/MIME support from the server.
 */
export async function encryptAttachment({ bytes, recipients, passphrase }) {
  const ring = loadRing()
  const targets = withSelf(recipients)
  const coverage = keyCoverage(targets)
  if (!coverage.canEncrypt) {
    throw new Error(`No OpenPGP key for: ${coverage.missing.join(', ')}`)
  }

  const encryptionKeys = await Promise.all(
    targets.map((address) => openpgp.readKey({ armoredKey: contactArmor(ring.contacts[address]) })),
  )

  let signingKeys
  if (ring.identity) {
    signingKeys = await openpgp.decryptKey({
      privateKey: await openpgp.readPrivateKey({ armoredKey: ring.identity.privateKey }),
      passphrase,
    })
  }

  return openpgp.encrypt({
    message: await openpgp.createMessage({ binary: bytes }),
    encryptionKeys,
    signingKeys,
    format: 'armored',
  })
}

/** Decrypt an .asc attachment back into raw bytes. */
export async function decryptAttachment({ armored, passphrase }) {
  const ring = loadRing()
  if (!ring.identity) throw new Error('This browser has no OpenPGP key to decrypt with')

  const privateKey = await openpgp.decryptKey({
    privateKey: await openpgp.readPrivateKey({ armoredKey: ring.identity.privateKey }),
    passphrase,
  })

  const message = await openpgp.readMessage({ armoredMessage: (armored ?? '').trim() })
  const { data } = await openpgp.decrypt({ message, decryptionKeys: privateKey, format: 'binary' })
  return data
}

/**
 * Decrypt an armored message and report the signature state.
 *
 * `signature` is 'none' when the message is unsigned, 'good' when a signature
 * verifies against a key we hold, and 'unverified' when signed by an unknown key
 * (which is not a failure — it just means we cannot confirm who sent it).
 */
/**
 * Which saved key produced this signature, if any. Matching on key ID covers
 * subkeys, which is what actually signs in most real keys.
 */
function fingerprintForKeyId(keys, keyId) {
  if (!keyId) return null
  const wanted = keyId.toHex().toUpperCase()
  for (const key of keys) {
    const own = key.getFingerprint().toUpperCase()
    if (key.getKeyIDs().some((k) => k.toHex().toUpperCase() === wanted)) return own
    const subkeys = key.getSubkeys?.() ?? []
    for (const sub of subkeys) {
      if (sub.getKeyID().toHex().toUpperCase() === wanted) return own
    }
  }
  return null
}

export function addressOf(header) {
  const match = String(header ?? '').match(/<([^>]+)>/)
  return (match ? match[1] : String(header ?? '')).trim().toLowerCase()
}

/**
 * Decrypt and classify the signature against the key pinned for the *sender*.
 *
 * Verifying against every key we happen to hold is a classic mistake: it proves
 * "someone we know signed this", not "the person it claims to be from signed it".
 * States: none | good | wrong-signer | unknown-signer | bad-signature.
 */
export async function decryptBody({ armored, passphrase, sender }) {
  const ring = loadRing()
  if (!ring.identity) throw new Error('This browser has no OpenPGP key to decrypt with')

  const privateKey = await openpgp.decryptKey({
    privateKey: await openpgp.readPrivateKey({ armoredKey: ring.identity.privateKey }),
    passphrase,
  })

  const message = await openpgp.readMessage({ armoredMessage: armored.trim() })

  const knownKeys = []
  const fingerprintByEmail = {}
  for (const [email, contact] of Object.entries(ring.contacts)) {
    const armor = contactArmor(contact)
    if (!armor) continue
    try {
      const key = await openpgp.readKey({ armoredKey: armor })
      knownKeys.push(key)
      fingerprintByEmail[email] = key.getFingerprint().toUpperCase()
    } catch {
      // a corrupt pinned key must not stop decryption
    }
  }

  const { data, signatures } = await openpgp.decrypt({
    message,
    decryptionKeys: privateKey,
    verificationKeys: knownKeys.length ? knownKeys : undefined,
    format: 'utf8',
  })

  let signature = 'none'
  let signerFingerprint = null
  let signerEmail = null

  if (signatures?.length) {
    const senderEmail = addressOf(sender)
    const pinned = senderEmail ? fingerprintByEmail[senderEmail] ?? null : null

    let verified = false
    for (const sig of signatures) {
      signerFingerprint = fingerprintForKeyId(knownKeys, sig.keyID) ?? signerFingerprint
      try {
        await sig.verified
        verified = true
        break
      } catch {
        // try the next signature
      }
    }

    for (const [email, fp] of Object.entries(fingerprintByEmail)) {
      if (fp && fp === signerFingerprint) { signerEmail = email; break }
    }

    if (!verified) signature = 'bad-signature'
    else if (!pinned) signature = 'unknown-signer'
    else if (pinned === signerFingerprint) signature = 'good'
    else signature = 'wrong-signer'
  }

  return { text: data, signature, signerFingerprint, signerEmail }
}

/** The identity's public key dearmored and base64'd, as WKD publishing needs. */
export async function publishableKey() {
  const ring = loadRing()
  if (!ring.identity) throw new Error('This browser has no OpenPGP key yet')
  const key = await openpgp.readKey({ armoredKey: ring.identity.publicKey })
  const bytes = key.write()
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  return {
    keyB64: btoa(binary),
    fingerprint: key.getFingerprint().toUpperCase(),
    email: ring.identity.email,
  }
}

/** Armored private key for backup. Still protected by the passphrase. */
export function exportPrivateKey() {
  return loadRing().identity?.privateKey ?? null
}

/**
 * Export the whole keyring as one file.
 *
 * OpenPGP keys here live in a single browser. Clearing site data, switching
 * phones, or losing a laptop takes the ability to read old mail with it, so the
 * ring has to be portable. The private key inside stays passphrase-protected:
 * this file is a move, not a master key.
 */
export function exportKeyRingBackup() {
  const ring = loadRing()
  return JSON.stringify(
    {
      format: 'sloth-lee.keyring',
      version: 1,
      exportedAt: new Date().toISOString(),
      identity: ring.identity ?? null,
      contacts: ring.contacts ?? {},
    },
    null,
    2,
  )
}

/**
 * Merge a backup into this browser.
 *
 * Never overwrites a key that is already pinned: an import that silently
 * replaces trust is worse than an import that refuses. Existing entries are
 * kept and counted, so the caller can say what actually happened.
 */
export async function importKeyRingBackup(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('That file is not a Sloth Lee key backup')
  }
  if (parsed?.format !== 'sloth-lee.keyring') {
    throw new Error('That file is not a Sloth Lee key backup')
  }

  const ring = loadRing()
  let added = 0
  let skipped = 0

  const contacts = parsed.contacts ?? {}
  for (const [address, entry] of Object.entries(contacts)) {
    const key = String(address).toLowerCase()
    if (!key.includes('@')) continue
    if (ring.contacts[key]) {
      skipped += 1
      continue
    }
    ring.contacts[key] = entry
    added += 1
  }

  let identityRestored = false
  if (parsed.identity && !ring.identity) {
    ring.identity = parsed.identity
    if (ring.identity.email && !ring.contacts[ring.identity.email]) {
      ring.contacts[ring.identity.email] = {
        armored: parsed.identity.publicKey,
        fingerprint: parsed.identity.fingerprint,
      }
    }
    identityRestored = true
  }

  saveRing(ring)
  return { contactsAdded: added, contactsSkipped: skipped, identityRestored }
}

/**
 * Import the key a sender attached to their own message (Autocrypt).
 *
 * This is how the other side tells us "here is the key to use for me". It is
 * not proof of identity: the key came from whoever sent the mail. So it only
 * fills a gap — an address with no key yet — and never replaces one already
 * pinned. A changed key is reported, not applied.
 */
export async function importAutocryptKey(headerValue, fromAddress) {
  if (!headerValue || typeof headerValue !== 'string') return { status: 'none' }

  const addrMatch = headerValue.match(/addr=([^;]+);/)
  const keyMatch = headerValue.match(/keydata=\s*([A-Za-z0-9+/=\s]+)/)
  if (!keyMatch) return { status: 'none' }

  const declared = (addrMatch ? addrMatch[1] : fromAddress || '').trim().toLowerCase()
  if (!declared.includes('@')) return { status: 'none' }

  // Refuse a header that claims a different address than the message sender:
  // otherwise anyone could plant a key for someone else.
  if (fromAddress && declared !== String(fromAddress).toLowerCase().trim()) {
    return { status: 'address-mismatch', declared }
  }

  let armor
  try {
    const { readKey } = await import('openpgp')
    const bytes = Uint8Array.from(atob(keyMatch[1].replace(/\s+/g, '')), (c) => c.charCodeAt(0))
    const key = await readKey({ binaryKey: bytes })
    armor = key.toPublic().armor()
  } catch {
    return { status: 'unreadable' }
  }

  const ring = loadRing()
  const existing = ring.contacts[declared]
  if (existing) {
    let pinned = ''
    try {
      pinned = contactFingerprint(existing) || ''
    } catch {
      pinned = ''
    }
    const incoming = await (async () => {
      const { readKey } = await import('openpgp')
      return (await readKey({ armoredKey: armor })).getFingerprint().toUpperCase()
    })()
    if (pinned && pinned !== incoming) {
      recordKeyConflict({ address: declared, pinned, incoming, armored: armor })
      return { status: 'different-key', address: declared, pinned, incoming }
    }
    return { status: 'present', address: declared }
  }

  const imported = await importPublicKey(armor)
  return { status: 'imported', address: imported.email, fingerprint: imported.fingerprint }
}

const CONFLICT_KEY = 'sloth.pgp.conflicts.v1'

function loadConflicts() {
  try {
    return JSON.parse(localStorage.getItem(CONFLICT_KEY) || '{}') || {}
  } catch {
    return {}
  }
}

function saveConflicts(next) {
  try {
    localStorage.setItem(CONFLICT_KEY, JSON.stringify(next))
  } catch {
    /* storage full or blocked: a lost conflict is not worth breaking a send */
  }
}

/**
 * Record that two different keys exist for one address.
 *
 * A key published on a keyserver can be years stale, while the key inside the
 * sender's own message is the one their client actually uses. Neither is proof
 * of identity, so the app refuses to pick silently: it stores the disagreement
 * and shows both fingerprints for the person to settle.
 */
export function recordKeyConflict({ address, pinned, incoming, armored }) {
  const key = String(address || '').toLowerCase().trim()
  if (!key) return
  const all = loadConflicts()
  all[key] = { pinned, incoming, armored, seenAt: new Date().toISOString() }
  saveConflicts(all)
}

export function listKeyConflicts() {
  return Object.entries(loadConflicts()).map(([email, c]) => ({ email, ...c }))
}

export function dismissKeyConflict(address) {
  const all = loadConflicts()
  delete all[String(address).toLowerCase().trim()]
  saveConflicts(all)
}

/** Adopt the key that arrived in the sender's own message. */
export async function resolveKeyConflict(address) {
  const key = String(address || '').toLowerCase().trim()
  const all = loadConflicts()
  const conflict = all[key]
  if (!conflict?.armored) return null
  const result = await replaceContactKey(conflict.armored)
  delete all[key]
  saveConflicts(all)
  return result
}

const BACKUP_KEY = 'sloth.pgp.backup.v1'
const BACKUP_PROMPT_DAYS = 7

/** Record that a key backup was taken, so the prompt can go quiet. */
export function markKeyBackupTaken() {
  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify({ takenAt: new Date().toISOString() }))
  } catch {
    /* nothing to do: the prompt will simply ask again */
  }
}

/**
 * Should the app ask for a backup?
 *
 * Keys live in this browser alone. Losing the browser without a backup means
 * losing the ability to read every encrypted message ever received — the one
 * failure in this product with no recovery path. So the ask is repeated, not
 * made once and forgotten.
 */
export function keyBackupDue() {
  const ring = loadRing()
  if (!ring.identity) return false
  let taken = null
  try {
    const raw = localStorage.getItem(BACKUP_KEY)
    if (raw) taken = JSON.parse(raw)?.takenAt ?? null
  } catch {
    taken = null
  }
  if (!taken) return true
  const ageMs = Date.now() - new Date(taken).getTime()
  return Number.isNaN(ageMs) ? true : ageMs > BACKUP_PROMPT_DAYS * 24 * 60 * 60 * 1000
}
