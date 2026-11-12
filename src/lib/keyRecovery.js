import { storage } from '@/storage'
import { keySession } from '@/keySession'
import { userGetKey } from '@/api'

/**
 * Make sure this browser holds the wrapped private key.
 *
 * The key only ever lives in localStorage because a previous login put it there.
 * New devices, cleared site data and private windows all start without it, which
 * used to surface as "no encrypted key found in storage" with no way forward.
 * The server keeps a copy wrapped with the password, so fetch it when missing.
 */
export async function ensureStoredKey() {
  if (storage.getEncryptedKey()) return true
  try {
    const data = await userGetKey()
    if (!data?.encrypted_private_key) return false
    storage.set({ encrypted_key: data.encrypted_private_key })
    if (data.public_key) storage.set({ public_key: data.public_key })
    if (data.salt) {
      keySession.setSalt(data.salt)
      storage.setLoginSalt(data.salt)
    }
    return true
  } catch {
    return false
  }
}
