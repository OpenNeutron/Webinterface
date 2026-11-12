/**
 * The browser side of re-sealing: fetch, open, seal, store.
 *
 * Kept apart from the loop in `reseal.js` so the loop can be proven in Node with
 * the same code that ships, by swapping this adapter for one built on fetch.
 */
import api from '@/api'
import { storage } from '@/storage'
import { keySession } from '@/keySession'
import { decryptEmailBytes, sealHybridPayload } from '@/crypto'
import { isHybridEnvelopeB64 } from '@/lib/reseal'

// Sending pre-serialised JSON: see the note in fetchMessage.
//
// Read the token per call, never once at import: a module-level constant is
// evaluated before anyone signs in, so it captures "Bearer undefined" and every
// request in the loop answers 401 — which the panel reported as
// "Stopped: Unauthorized".
function jsonBody() {
  return {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${storage.getToken()}`,
    },
  }
}
export async function makeResealIo(status) {
  // Keys come from where the reader gets them, not from a second source.
  const rsaPublicKey = storage.getPublicKey()
  const pqPublicKey = status?.public_key ?? null
  const username = storage.getUsername()
  const privateKey = await keySession.get()
  const pqSecretKey = keySession.getPq()

  const io = {
    username,
    status: async () => (await api.get('/pq/migration', jsonBody())).data,

    fetchMessage: async (uid) => {
      const { data } = await api.post('/email/get', `{"uid":"${uid}"}`, jsonBody())
      return { data: data.data, messageKey: data.message_key ?? null }
    },

    open: async (message) =>
      decryptEmailBytes(message.data, message.messageKey, privateKey, pqSecretKey, username),

    seal: async (bytes) => sealHybridPayload(bytes, rsaPublicKey, pqPublicKey, username),

    store: async (uid, sealed) => {
      // uid is a u128: as a JSON number it is fine inside the text, but through
      // JSON.stringify a JS number would lose precision and an object would send
      // it as a quoted string, which the server rejects.
      await api.post('/email/set', `{"uid":"${uid}","data":${JSON.stringify(sealed.data)},"message_key":${JSON.stringify(sealed.messageKey)}}`, jsonBody())
    },
  }

  return { io, keys: { rsaPublicKey, pqPublicKey, pqSecretKey, username, privateKey } }
}

export { isHybridEnvelopeB64 }
