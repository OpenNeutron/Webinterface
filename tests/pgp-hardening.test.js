import { describe, it, expect, beforeEach } from 'vitest'
import {
  generateIdentity,
  importPublicKey,
  encryptBody,
  decryptBody,
  loadRing,
  listContacts,
  exportPrivateKey,
} from '@/pgp'

const PASS = 'hardening passphrase'

async function identityFor(email, passphrase = PASS) {
  return generateIdentity({ name: email.split('@')[0], email, passphrase })
}

beforeEach(() => localStorage.clear())

describe('trust on first use', () => {
  it('pins a fingerprint and refuses a silent key swap', async () => {
    await identityFor('me@slothlee.xyz')
    const friendA = await identityFor('friend@example.org')
    await importPublicKey(friendA.publicKey)

    const pinned = listContacts().find((c) => c.email === 'friend@example.org')
    expect(pinned.fingerprint).toBe(friendA.fingerprint)

    // A different key for the same address must not replace trust by itself.
    localStorage.clear()
    await identityFor('me@slothlee.xyz')
    await importPublicKey(friendA.publicKey)
    const other = await openpgpGenerate('friend@example.org')
    await expect(importPublicKey(other)).rejects.toMatchObject({ code: 'key_fingerprint_changed' })

    // …but an explicit replacement is allowed.
    const result = await importPublicKey(other, { replace: true })
    expect(result.fingerprint).not.toBe(friendA.fingerprint)
  }, 40000)

  it('accepts a ring written by the older build (bare armor strings)', async () => {
    await identityFor('me@slothlee.xyz')
    const raw = loadRing()
    raw.contacts['legacy@example.org'] = raw.identity.publicKey // old format: string
    localStorage.setItem('sloth.pgp.keyring.v1', JSON.stringify(raw))

    const found = listContacts().find((c) => c.email === 'legacy@example.org')
    expect(found).toBeTruthy()
    expect(found.armored).toContain('BEGIN PGP PUBLIC KEY BLOCK')
  }, 30000)
})

describe('signature is checked against the sender, not just any known key', () => {
  it('reports good when the sender signed with the key saved for them', async () => {
    const me = await identityFor('me@slothlee.xyz')
    const friend = await identityFor('friend@example.org')
    await importPublicKey(friend.publicKey)

    const armored = await encryptBody({ text: 'hello', recipients: ['friend@example.org'], passphrase: PASS })
    const out = await decryptBody({ armored, passphrase: PASS, sender: 'friend@example.org' })
    expect(out.signature).toBe('good')
  }, 40000)

  it('flags a message that claims a sender but was signed by someone else', async () => {
    const me = await identityFor('me@slothlee.xyz')
    const friend = await identityFor('friend@example.org')
    const impostor = await identityFor('impostor@example.net')
    await importPublicKey(friend.publicKey)
    await importPublicKey(impostor.publicKey)

    // Signed by the impostor's key, addressed to me, but claiming to be friend.
    const armored = await encryptBody({
      text: 'trust me',
      recipients: ['me@slothlee.xyz'],
      passphrase: PASS,
    })
    // encryptBody signs with *our* identity, so send from impostor's ring instead:
    localStorage.setItem('sloth.pgp.keyring.v1', JSON.stringify({
      identity: { ...impostor, email: 'impostor@example.net' },
      contacts: {
        'me@slothlee.xyz': { armored: me.publicKey, fingerprint: me.fingerprint },
        'friend@example.org': { armored: friend.publicKey, fingerprint: friend.fingerprint },
        'impostor@example.net': { armored: impostor.publicKey, fingerprint: impostor.fingerprint },
      },
    }))
    const signedByImpostor = await encryptBody({
      text: 'trust me',
      recipients: ['me@slothlee.xyz'],
      passphrase: PASS,
    })

    // Now back to my own ring to read it, claiming it came from friend.
    localStorage.setItem('sloth.pgp.keyring.v1', JSON.stringify({
      identity: me,
      contacts: {
        'friend@example.org': { armored: friend.publicKey, fingerprint: friend.fingerprint },
        'impostor@example.net': { armored: impostor.publicKey, fingerprint: impostor.fingerprint },
      },
    }))
    const out = await decryptBody({ armored: signedByImpostor, passphrase: PASS, sender: 'friend@example.org' })
    expect(out.text).toBe('trust me')
    expect(out.signature).toBe('wrong-signer')
    expect(out.signerEmail).toBe('impostor@example.net')
  }, 60000)

  it('reports unknown-signer when no key is saved for the claimed sender', async () => {
    const me = await identityFor('me@slothlee.xyz')
    const stranger = await identityFor('stranger@example.net')
    await importPublicKey(stranger.publicKey)
    const armored = await encryptBody({ text: 'hi', recipients: ['me@slothlee.xyz'], passphrase: PASS })
    const out = await decryptBody({ armored, passphrase: PASS, sender: 'nobody@example.net' })
    expect(out.signature).toBe('unknown-signer')
  }, 40000)
})

describe('you can always read your own mail', () => {
  it('encrypts to the sender as well, so the sent copy stays readable', async () => {
    const me = await identityFor('me@slothlee.xyz')
    const friend = await identityFor('friend@example.org')
    await importPublicKey(friend.publicKey)

    const armored = await encryptBody({ text: 'my own copy', recipients: ['friend@example.org'], passphrase: PASS })
    // Remove the friend's key: only our own key can open it now.
    const ring = loadRing()
    delete ring.contacts['friend@example.org']
    localStorage.setItem('sloth.pgp.keyring.v1', JSON.stringify(ring))

    const out = await decryptBody({ armored, passphrase: PASS })
    expect(out.text).toBe('my own copy')
  }, 40000)

  it('exports a private key that still needs the passphrase', async () => {
    await identityFor('me@slothlee.xyz')
    const armored = exportPrivateKey()
    expect(armored).toContain('BEGIN PGP PRIVATE KEY BLOCK')
    expect(armored).not.toContain('hardening passphrase')
  })

  it('lists a contact fingerprint for verification out of band', async () => {
    await identityFor('me@slothlee.xyz')
    const friend = await identityFor('friend@example.org')
    await importPublicKey(friend.publicKey)
    const contact = listContacts().find((c) => c.email === 'friend@example.org')
    expect(contact.fingerprint).toMatch(/^[0-9A-F]{40}$/)
  }, 30000)
})

// helper: a fresh public key for an address, generated outside the ring
async function openpgpGenerate(email) {
  const openpgp = await import('openpgp')
  const { publicKey } = await openpgp.generateKey({
    type: 'ecc',
    curve: 'curve25519Legacy',
    userIDs: [{ name: email.split('@')[0], email }],
    passphrase: PASS,
    format: 'armored',
  })
  return publicKey
}

describe('unusable keys are refused', () => {
  it('rejects a key that has already expired', async () => {
    await identityFor('me@slothlee.xyz')
    const openpgp = await import('openpgp')
    const { publicKey } = await openpgp.generateKey({
      type: 'ecc',
      curve: 'curve25519Legacy',
      userIDs: [{ name: 'Old', email: 'old@example.org' }],
      date: new Date(Date.now() - 10 * 864e5),
      keyExpirationTime: 86400,
      format: 'armored',
    })
    // getExpirationTime() is async: an unawaited Promise made this check a no-op.
    await expect(importPublicKey(publicKey)).rejects.toThrow(/expired/i)
  }, 60000)

  it('still accepts a live key', async () => {
    await identityFor('me@slothlee.xyz')
    const friend = await identityFor('friend@example.org')
    const result = await importPublicKey(friend.publicKey)
    expect(result.fingerprint).toMatch(/^[0-9A-F]{40}$/)
  }, 30000)
})
