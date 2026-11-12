/**
 * The parts of OpenPGP support that do not need the OpenPGP library (about 390 kB): reading
 * whether this browser holds an identity, and recognising armour or an encrypted attachment.
 * They are needed on every page load; the library is only needed once something is
 * actually encrypted or decrypted, so it stays in src/pgp.js and loads then.
 */

export const RING_KEY = 'sloth.pgp.keyring.v1'

export function emptyRing() {
  return { identity: null, contacts: {} }
}

export function loadRing() {
  try {
    const raw = localStorage.getItem(RING_KEY)
    if (!raw) return emptyRing()
    const parsed = JSON.parse(raw)
    const contacts = {}
    for (const [email, value] of Object.entries(parsed.contacts ?? {})) {
      // Older rings stored bare armor. Normalise to {armored, fingerprint} so
      // every contact has a pin to compare future imports against.
      contacts[email] = typeof value === 'string' ? { armored: value, fingerprint: null } : value
    }
    return { identity: parsed.identity ?? null, contacts }
  } catch {
    return emptyRing()
  }
}

export function hasIdentity() {
  return !!loadRing().identity
}

export function looksEncrypted(text) {
  return typeof text === 'string' && text.includes('-----BEGIN PGP MESSAGE-----')
}

export function isPgpAttachment(att) {
  return /\.(asc|pgp|gpg)$/i.test(att?.name ?? '') || /pgp/i.test(att?.contentType ?? '')
}
