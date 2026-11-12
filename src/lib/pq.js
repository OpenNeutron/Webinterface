/**
 * Post-quantum key material (ML-KEM-768, FIPS 203).
 *
 * Kept separate from the account keys on purpose: this is the layer that will
 * eventually wrap the per-message AES key, and it has to be swappable without
 * touching how accounts, passwords or OpenPGP keys work.
 *
 * Nothing here is wired into sending yet. Establishing the primitives and their
 * serialisation first is what makes the later swap testable.
 */
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js'

export const PQ_KEM = 'ml-kem-768'

const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
const fromB64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))

/** A fresh keypair, serialised the way it will be stored and published. */
export function generatePqKeyPair() {
  const { publicKey, secretKey } = ml_kem768.keygen()
  return {
    kem: PQ_KEM,
    publicKey: b64(publicKey),
    secretKey: b64(secretKey),
  }
}

/** Encapsulate a shared secret to someone's public key. */
export function pqEncapsulate(publicKeyB64) {
  const { cipherText, sharedSecret } = ml_kem768.encapsulate(fromB64(publicKeyB64))
  return { cipherText: b64(cipherText), sharedSecret }
}

/** Recover the shared secret from a ciphertext and our own secret key. */
export function pqDecapsulate(cipherTextB64, secretKeyB64) {
  return ml_kem768.decapsulate(fromB64(cipherTextB64), fromB64(secretKeyB64))
}

export function pqKeyLengths() {
  const { publicKey, secretKey } = ml_kem768.keygen()
  return { publicKey: publicKey.length, secretKey: secretKey.length }
}
