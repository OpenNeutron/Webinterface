/**
 * Keeping the OpenPGP identity on the account, not just in one browser.
 *
 * The identity used to live in localStorage and nowhere else: a new device had no key,
 * and clearing site data destroyed it. It is now synced to the account — but never in
 * the clear. The armoured private key is wrapped here, in the browser, with a key
 * derived from the account password (PBKDF2-SHA256, 310k iterations, AES-256-GCM), and
 * only the ciphertext is uploaded. The server refuses anything that is not wrapped.
 *
 * Sync runs at sign-in, because that is the one moment the password is in hand:
 *
 *   stored + nothing local  → unwrap and restore   (a new device)
 *   local + nothing stored  → wrap and upload      (first sign-in since this shipped)
 *   both, fingerprints differ → local wins, and it is uploaded
 *
 * Nothing here touches the password itself beyond deriving from it in memory.
 */
import api from '@/api'
import { storage } from '@/storage'

/** Every call here is authenticated; axios has no interceptor that adds the token. */
const auth = () => ({ headers: { Authorization: `Bearer ${storage.getToken()}` } })
import { getIdentity, restoreIdentity, forgetIdentity } from '@/pgp'
import { wrapPrivateKey, unwrapPrivateKey } from '@/lib/pgpWrap'

/**
 * Reconcile the browser's identity with the account's.
 * Returns what happened, for the caller to report if it wants to.
 */
export async function syncIdentityWithAccount(password) {
  const local = getIdentity()
  let stored = null
  try {
    const res = await api.get('/user/pgpkey', auth())
    stored = res?.data?.exists ? res.data : null
  } catch {
    // A failed read must not block sign-in; the identity is still usable locally.
    return { action: 'unavailable' }
  }

  if (!local && stored) {
    try {
      const armored = await unwrapPrivateKey({ blob: stored.encrypted_private_key, salt: stored.salt, kdf: stored.kdf }, password)
      restoreIdentity({
        name: stored.name || '',
        email: stored.email || '',
        publicKey: stored.public_key,
        privateKey: armored,
        fingerprint: (stored.fingerprint || '').toUpperCase(),
        createdAt: Date.now(),
        restoredFromAccount: true,
      })
      return { action: 'restored' }
    } catch (err) {
      return { action: 'restore_failed', error: err.message }
    }
  }

  if (local && (!stored || (stored.fingerprint || '').toUpperCase() !== (local.fingerprint || '').toUpperCase())) {
    const wrapped = await wrapPrivateKey(local.privateKey, password)
    await api.put('/user/pgpkey', {
      public_key: local.publicKey,
      encrypted_private_key: wrapped.blob,
      salt: wrapped.salt,
      fingerprint: local.fingerprint,
      kdf: wrapped.kdf,
      name: local.name,
      email: local.email,
    }, auth())
    return { action: 'uploaded' }
  }

  return { action: 'in-step' }
}

/** Removing the identity from this browser also removes it from the account. */
export async function forgetIdentityEverywhere() {
  forgetIdentity()
  try {
    await api.delete('/user/pgpkey', auth())
    return { action: 'removed' }
  } catch {
    return { action: 'removed_locally' }
  }
}
