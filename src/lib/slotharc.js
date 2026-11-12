/**
 * Sealed mailbox archives (`.slotharc`).
 *
 * A mail export that is a plain `.mbox` is a decrypted copy of everything the
 * account ever received, sitting in Downloads until someone deletes it. This
 * format replaces that: one passphrase-derived key, AES-256-GCM, and the messages
 * framed so a restore can rebuild the mailbox message by message.
 *
 * Layout
 *   header   "SLARC" + version, Argon2id parameters, salt, chunk size
 *   record*  u32 length | nonce (12) | ciphertext + tag
 *   end      0xFFFFFFFF
 *
 * Each chunk authenticates the header, its own index and whether it is the last
 * chunk. That is what makes the file self-defending: a chunk cannot be moved,
 * dropped or truncated without the tag failing, so a partial download can never
 * be mistaken for a complete archive — including a download where the attacker
 * cut the last chunk to hide the newest mail.
 *
 * The key is Argon2id (64 MiB, 3 passes) over the passphrase. Symmetric only, so
 * nothing here depends on factoring or discrete logs: this is the part of mail
 * that stays sealed even against a quantum adversary, and the honest limit is the
 * passphrase itself, not the cipher.
 */
import { argon2id } from 'hash-wasm'

const MAGIC = [0x53, 0x4c, 0x41, 0x52, 0x43] // "SLARC"
const VERSION = 1
const SALT_LEN = 16
const NONCE_LEN = 12
const TAG_LEN = 16
const CHUNK_SIZE = 1 << 20 // 1 MiB of plaintext per chunk
const END = 0xffffffff

// 64 MiB / 3 passes is ~0.6 s on a laptop and deliberately slow on a phone: the
// cost is the only thing standing between a stolen archive and its passphrase.
const KDF = { memory: 65536, iterations: 3, parallelism: 1 }

const TAG_MESSAGE = 0
const TAG_MANIFEST = 1

function u32(value) {
  return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff])
}

function readU32(bytes, at) {
  if (at + 4 > bytes.length) throw new Error('archive ends in the middle of a record')
  return ((bytes[at] << 24) >>> 0) + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3]
}

function headerBytes(salt) {
  const head = new Uint8Array(MAGIC.length + 1 + 4 + 4 + 1 + SALT_LEN + 4)
  let at = 0
  head.set(MAGIC, at); at += MAGIC.length
  head[at] = VERSION; at += 1
  head.set(u32(KDF.memory), at); at += 4
  head.set(u32(KDF.iterations), at); at += 4
  head[at] = KDF.parallelism; at += 1
  head.set(salt, at); at += SALT_LEN
  head.set(u32(CHUNK_SIZE), at)
  return head
}

function parseHeader(bytes) {
  let at = 0
  for (let i = 0; i < MAGIC.length; i += 1, at += 1) {
    if (bytes[at] !== MAGIC[i]) throw new Error('this is not a sealed archive')
  }
  const version = bytes[at]; at += 1
  if (version !== VERSION) throw new Error(`this archive was written by a newer version (${version})`)
  const memory = readU32(bytes, at); at += 4
  const iterations = readU32(bytes, at); at += 4
  const parallelism = bytes[at]; at += 1
  const salt = bytes.slice(at, at + SALT_LEN); at += SALT_LEN
  if (salt.length !== SALT_LEN) throw new Error('archive header is cut short')
  const chunkSize = readU32(bytes, at); at += 4
  const header = bytes.slice(0, at)
  return { header, salt, chunkSize, version, kdf: { memory, iterations, parallelism } }
}

function aad(header, index, isFinal) {
  const out = new Uint8Array(header.length + 4 + 1)
  out.set(header, 0)
  out.set(u32(index), header.length)
  out[header.length + 4] = isFinal ? 1 : 0
  return out
}

async function deriveKey(passphrase, salt, kdf) {
  const raw = await argon2id({
    password: passphrase,
    salt,
    parallelism: kdf.parallelism,
    iterations: kdf.iterations,
    memorySize: kdf.memory,
    hashLength: 32,
    outputType: 'binary',
  })
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

/** Group framed records into chunks no larger than CHUNK_SIZE. */
function chunkFrames(frames) {
  const chunks = []
  let current = []
  let size = 0
  for (const frame of frames) {
    if (size > 0 && size + frame.length > CHUNK_SIZE) {
      chunks.push(current)
      current = []
      size = 0
    }
    current.push(frame)
    size += frame.length
  }
  if (current.length) chunks.push(current)
  return chunks
}

function frame(tag, payload) {
  const out = new Uint8Array(1 + 4 + payload.length)
  out[0] = tag
  out.set(u32(payload.length), 1)
  out.set(payload, 5)
  return out
}

/**
 * Seal messages into an archive.
 *
 * `messages` are raw RFC 822 bytes in the order they should be restored.
 * `metadata` is plain JSON written into the archive (counts, dates) — it is
 * encrypted like everything else, so it may name the account.
 */
export async function sealArchive(messages, passphrase, metadata = {}, onProgress = () => {}) {
  if (!passphrase || passphrase.length < 8) {
    throw new Error('use a passphrase of at least 8 characters')
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN))
  const header = headerBytes(salt)
  const key = await deriveKey(passphrase, salt, KDF)

  const manifest = new TextEncoder().encode(
    JSON.stringify({
      format: 'slotharc',
      version: VERSION,
      created: new Date().toISOString(),
      messages: messages.length,
      bytes: messages.reduce((n, m) => n + m.length, 0),
      ...metadata,
    }),
  )

  const frames = [frame(TAG_MANIFEST, manifest)]
  for (const message of messages) frames.push(frame(TAG_MESSAGE, message))

  const chunks = chunkFrames(frames)
  const parts = [header]
  for (let i = 0; i < chunks.length; i += 1) {
    const plain = new Uint8Array(chunks[i].reduce((n, f) => n + f.length, 0))
    let at = 0
    for (const f of chunks[i]) { plain.set(f, at); at += f.length }

    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LEN))
    const sealed = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: nonce, additionalData: aad(header, i, i === chunks.length - 1) },
        key,
        plain,
      ),
    )
    parts.push(u32(sealed.length), nonce, sealed)
    onProgress({ done: i + 1, total: chunks.length })
  }
  parts.push(u32(END))

  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

/** Split the archive into its encrypted records. */
function readRecords(bytes) {
  let at = MAGIC.length + 1 + 4 + 4 + 1 + SALT_LEN + 4
  const records = []
  for (;;) {
    const length = readU32(bytes, at); at += 4
    if (length === END) break
    if (length < TAG_LEN + 1) throw new Error('archive record is too short to be real')
    const nonce = bytes.slice(at, at + NONCE_LEN); at += NONCE_LEN
    if (nonce.length !== NONCE_LEN) throw new Error('archive ends in the middle of a record')
    const sealed = bytes.slice(at, at + length); at += length
    if (sealed.length !== length) throw new Error('archive ends in the middle of a record')
    records.push({ nonce, sealed })
  }
  return { records, endAt: at }
}

/**
 * Open an archive and return its messages, in the order they were sealed.
 *
 * Nothing is returned until every record has authenticated: a mailbox restored
 * from a damaged file would be worse than one restored from nothing, because the
 * gaps would be silent.
 */
export async function openArchive(bytes, passphrase, onProgress = () => {}) {
  const { header, salt, kdf } = parseHeader(bytes)
  const { records, endAt } = readRecords(bytes)
  if (endAt !== bytes.length) throw new Error('archive has trailing bytes after its end marker')
  if (records.length === 0) throw new Error('archive holds no records')

  const key = await deriveKey(passphrase, salt, kdf)

  const messages = []
  let manifest = null
  for (let i = 0; i < records.length; i += 1) {
    const { nonce, sealed } = records[i]
    let plain
    try {
      plain = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: nonce, additionalData: aad(header, i, i === records.length - 1) },
          key,
          sealed,
        ),
      )
    } catch {
      // One message for both causes on purpose: telling a wrong passphrase from a
      // damaged file would confirm a guess to whoever stole the archive.
      throw new Error('this archive did not open — wrong passphrase, or the file has been changed since it was written')
    }

    let at = 0
    while (at < plain.length) {
      if (at + 5 > plain.length) throw new Error('archive chunk ends in the middle of a frame')
      const tag = plain[at]
      const length = readU32(plain, at + 1)
      at += 5
      if (at + length > plain.length) throw new Error('archive chunk ends in the middle of a frame')
      const payload = plain.slice(at, at + length)
      at += length
      if (tag === TAG_MANIFEST) {
        try { manifest = JSON.parse(new TextDecoder().decode(payload)) } catch { manifest = null }
      } else if (tag === TAG_MESSAGE) {
        messages.push(payload)
      } else {
        throw new Error('archive holds a record this version does not understand')
      }
    }
    onProgress({ done: i + 1, total: records.length })
  }

  return { manifest, messages }
}
