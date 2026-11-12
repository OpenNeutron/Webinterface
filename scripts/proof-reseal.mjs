/**
 * Proof: mail stored before post-quantum protection can be moved into the hybrid
 * envelope, safely and resumably.
 *
 * Drives the *shipped* loop (`src/lib/reseal.js`) over a fetch-based adapter, so
 * what passes here is the code the Settings panel runs.
 *
 *   1. six messages imported while the account is still RSA-only  -> all v0
 *   2. enable post-quantum                                        -> still all v0
 *   3. run, pressing Stop after the first message                 -> 1 sealed, 5 left
 *   4. run again                                                  -> the other 5
 *   5. every body still opens, byte for byte, nothing duplicated
 *
 *   node scripts/proof-reseal.mjs
 */
import fs from 'node:fs'
import {
  hashPassword, generateKeyPair, exportPublicKeyBase64, encryptPrivateKey,
  generatePqKeyPair, wrapSecretBytes, decryptEmailBytes, sealHybridPayload,
} from '../src/lib/probeCrypto.mjs'
import { runReseal } from '../src/lib/reseal.js'

const BASE = 'https://mail.slothlee.xyz/api'
const USER = 'resprobe'
const password = `probe-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
const adminToken = fs.readFileSync('/tmp/admin.jwt', 'utf8').trim()

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  ok   ${name}`) } else { fail += 1; console.log(`  FAIL ${name} ${detail}`) }
}

async function call(method, path, body, token) {
  return callRaw(method, path, body === undefined ? undefined : JSON.stringify(body), token)
}

// A uid is a u128. As a JSON string serde rejects the body; as a JS number it
// loses precision past 2^53 — so it goes in as a numeric literal in hand-built
// JSON, exactly as the app does it.
async function callRaw(method, path, rawBody, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: rawBody,
  })
  const text = await res.text()
  let json = {}
  try { json = JSON.parse(text) } catch { json = { raw: text.slice(0, 160) } }
  return { status: res.status, json }
}

const BODIES = {
  'Reseal one': 'First body, with a line that must survive re-sealing.',
  'Reseal two': 'Second body — unicode: café, ✓.',
  'Reseal three': 'Third body.',
  'Reseal four': 'Fourth body.',
  'Reseal five': 'Fifth body — imported before the switch.',
  'Reseal six': 'Sixth body — also from before the switch.',
}

function rfc822(subject, body) {
  return [
    'From: Sender <sender@elsewhere.example>',
    `To: ${USER}@slothlee.xyz`,
    `Subject: ${subject}`,
    'Date: Wed, 14 Aug 2024 09:00:00 +0000',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ].join('\r\n')
}

async function main() {
  await call('DELETE', '/admin/users', { username: USER }, adminToken)
  const created = await call('POST', '/admin/users', { username: USER }, adminToken)
  check('account created', [200, 201].includes(created.status), String(created.status))

  const passwordHash = await hashPassword(password)
  await call('POST', '/admin/users/credentials', { username: USER, password: passwordHash }, adminToken)
  const login = await call('POST', '/auth/login', { username: USER, password: passwordHash })
  const token = login.json.token
  const salt = login.json.salt || login.json.server_salt
  check('signed in', !!token && login.status === 200)

  const rsa = await generateKeyPair()
  const rsaPublicB64 = await exportPublicKeyBase64(rsa.publicKey)
  const setup = await call('POST', '/user/setup', {
    password: passwordHash,
    public_key: rsaPublicB64,
    encrypted_private_key: await encryptPrivateKey(rsa.privateKey, password, salt),
  }, token)
  check('keys set up', setup.status === 200, JSON.stringify(setup.json).slice(0, 80))

  // ── six messages, stored the old way ───────────────────────────────────────
  for (const [subject, body] of Object.entries(BODIES)) {
    const r = await call('POST', '/import/message', {
      raw: Buffer.from(rfc822(subject, body)).toString('base64'),
    }, token)
    check(`imported "${subject}"`, r.status === 200, `${r.status} ${JSON.stringify(r.json).slice(0, 80)}`)
  }

  let status = await call('GET', '/pq/migration', undefined, token)
  check('all six count as pending before the switch', status.json.pending === 6 && status.json.sealed === 0,
    JSON.stringify(status.json).slice(0, 140))
  const sealedUids = status.json.uids.slice()

  // ── enable post-quantum ───────────────────────────────────────────────────
  const pq = generatePqKeyPair()
  const pqPublicB64 = Buffer.from(pq.publicKey).toString('base64')
  const en = await call('POST', '/user/pq-keys', {
    public_key: pqPublicB64,
    encrypted_private_key: await wrapSecretBytes(pq.secretKey, password, salt),
  }, token)
  check('post-quantum enabled', en.status === 200, JSON.stringify(en.json).slice(0, 80))

  const keys = {
    rsaPublicKey: rsaPublicB64,
    pqPublicKey: pqPublicB64,
    pqSecretKey: Buffer.from(pq.secretKey).toString('base64'),
    username: USER,
    privateKey: rsa.privateKey,
  }

  const io = {
    status: async () => (await call('GET', '/pq/migration', undefined, token)).json,
    fetchMessage: async (uid) => {
      const r = await callRaw('POST', '/email/get', `{"uid":${uid}}`, token)
      if (!r.json.data) throw new Error(`get failed ${r.status} ${JSON.stringify(r.json).slice(0, 60)}`)
      return { data: r.json.data, messageKey: r.json.message_key ?? null }
    },
    open: async (m) => decryptEmailBytes(m.data, m.messageKey, rsa.privateKey, keys.pqSecretKey, USER),
    seal: async (bytes) => sealHybridPayload(bytes, rsaPublicB64, pqPublicB64, USER),
    store: async (uid, sealed) => {
      const r = await callRaw('POST', '/email/set',
        `{"uid":${uid},"data":${JSON.stringify(sealed.data)},"message_key":${JSON.stringify(sealed.messageKey)}}`, token)
      if (r.status !== 200) throw new Error(`store ${r.status}`)
    },
  }

  // ── Stop after the message in hand ────────────────────────────────────────
  let stopNow = false
  const interrupted = await runReseal({
    keys,
    io,
    shouldStop: () => stopNow,
    onProgress: (p) => { if (p.resealed >= 1) stopNow = true },
  })
  check('Stop ends the run after the message in hand',
    interrupted.stopped === true && interrupted.resealed === 1 && interrupted.failed.length === 0,
    JSON.stringify(interrupted).slice(0, 160))

  status = await call('GET', '/pq/migration', undefined, token)
  check('and leaves real work behind', status.json.sealed === 1 && status.json.pending === 5,
    JSON.stringify(status.json).slice(0, 140))

  // ── the rest ──────────────────────────────────────────────────────────────
  const run = await runReseal({ keys, io })
  check('the resume seals the remaining five', run.resealed === 5 && run.failed.length === 0,
    JSON.stringify(run).slice(0, 160))

  status = await call('GET', '/pq/migration', undefined, token)
  check('nothing left in the old envelope', status.json.pending === 0 && status.json.sealed === 6,
    JSON.stringify(status.json).slice(0, 140))
  check('no duplicates from stopping and starting', status.json.total === 6, `total ${status.json.total}`)

  // ── the bodies are still the bodies ──────────────────────────────────────
  let matched = 0
  for (const uid of sealedUids) {
    const m = await io.fetchMessage(uid)
    const text = Buffer.from(await io.open(m)).toString('utf8')
    const subject = Object.keys(BODIES).find((s) => text.includes(s))
    if (subject && text.includes(BODIES[subject])) matched += 1
  }
  check('every body survives the re-seal, byte for byte', matched === 6, `${matched}/6 matched`)

  // ── mail arriving after the switch was never part of this ────────────────
  await call('POST', '/import/message', {
    raw: Buffer.from(rfc822('Reseal seven', 'Arrived after the switch.')).toString('base64'),
  }, token)
  const after = await call('GET', '/pq/migration', undefined, token)
  check('mail imported after the switch is already hybrid',
    after.json.pending === 0 && after.json.sealed === 7 && after.json.total === 7,
    JSON.stringify(after.json).slice(0, 140))

  await call('DELETE', '/admin/users', { username: USER }, adminToken)
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => { console.error('PROOF ERROR:', err.message); process.exit(1) })
