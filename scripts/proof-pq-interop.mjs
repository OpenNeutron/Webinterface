/**
 * Interop proof: the server seals, the shipped browser code opens.
 *
 * The risk in a hybrid wrap is never "does AES work" — it is that the two sides
 * disagree about one byte: the length field, the HKDF salt, which secret goes
 * first, where the nonce sits. This script therefore uses the **real**
 * `src/crypto.js` (worker import stubbed) rather than a re-implementation, so a
 * mismatch fails here instead of in someone's inbox.
 *
 * Run:  node src/__pq_interop.mjs
 */
import fs from 'node:fs'
import { webcrypto as crypto } from 'node:crypto'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// The shipped module imports a Vite worker, which Node cannot resolve. Rather
// than keep a copy that silently drifts away from the real code, stub that one
// import in a temporary copy of the live source every run.
const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'src', 'crypto.js'), 'utf8')
  .replace("import KeygenWorker from './keygen.worker.js?worker&inline'", 'const KeygenWorker = null')
// It must live inside the project, or its bare imports (hash-wasm, node-forge)
// resolve relative to /tmp and fail.
const probeDir = mkdtempSync(join(here, '..', '.pq-probe-'))
const probePath = join(probeDir, 'crypto.mjs')
process.on('exit', () => { try { rmSync(probeDir, { recursive: true, force: true }) } catch {} })
writeFileSync(probePath, source)
const {
  decryptEmail,
  hashPassword,
  generateKeyPair,
  exportPublicKeyBase64,
  encryptPrivateKey,
  generatePqKeyPair,
  wrapSecretBytes,
  isPqEnvelope,
} = await import(probePath)

process.chdir(join(here, '..'))
const BASE = 'https://mail.slothlee.xyz/api'
const USER = 'pqprobe'
const password = `pq-probe-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
const adminToken = fs.readFileSync('/tmp/admin.jwt', 'utf8').trim()

let pass = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) {
    pass += 1
    console.log(`  ok   ${name}${detail ? `  [${detail}]` : ''}`)
  } else {
    failures.push(name)
    console.log(`  FAIL ${name} ${detail}`)
  }
}

async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json = {}
  try { json = JSON.parse(text) } catch { json = { raw: text.slice(0, 160) } }
  return { status: res.status, json }
}

const b64 = (bytes) => Buffer.from(bytes).toString('base64')
const unb64 = (s) => new Uint8Array(Buffer.from(s, 'base64'))

async function main() {
  console.log('account')
  await call('DELETE', '/admin/users', { username: USER }, adminToken) // left over from an earlier run
  const created = await call('POST', '/admin/users', { username: USER }, adminToken)
  check('admin creates the account', created.status === 200 || created.status === 201, String(created.status))

  const passwordHash = await hashPassword(password)
  const creds = await call('POST', '/admin/users/credentials',
    { username: USER, password: passwordHash }, adminToken)
  check('credentials set', creds.status === 200, String(creds.status))

  const login = await call('POST', '/auth/login', { username: USER, password: passwordHash })
  check('login works', login.status === 200 && !!login.json.token, String(login.status))
  const token = login.json.token
  const salt = login.json.salt || login.json.server_salt
  check('a wrap salt came back', !!salt, salt ? `${String(salt).slice(0, 6)}…` : 'missing')

  console.log('keys')
  const rsa = await generateKeyPair()
  const publicKeyB64 = await exportPublicKeyBase64(rsa.publicKey)
  const encryptedKey = await encryptPrivateKey(rsa.privateKey, password, salt)
  const setup = await call('POST', '/user/setup',
    { password: passwordHash, public_key: publicKeyB64, encrypted_private_key: encryptedKey }, token)
  check('account is set up with an RSA key', setup.status === 200, String(setup.status))

  const pq = generatePqKeyPair()
  const pqPublicB64 = b64(pq.publicKey)
  const wrappedPqSecret = await wrapSecretBytes(pq.secretKey, password, salt)
  const pqSet = await call('POST', '/user/pq-keys',
    { public_key: pqPublicB64, encrypted_private_key: wrappedPqSecret }, token)
  check('post-quantum key is accepted', pqSet.status === 200, String(pqSet.status))

  const status = await call('GET', '/user/pq-keys', undefined, token)
  check('status reports it enabled', status.json.enabled === true)

  const shortKey = await call('POST', '/user/pq-keys',
    { public_key: Buffer.alloc(10).toString('base64'), encrypted_private_key: 'x' }, token)
  check('a stub key is refused', shortKey.status === 400, String(shortKey.status))

  console.log('a message sealed after the switch')
  const marker = `PQ-INTEROP-${Date.now()}`
  const raw = [
    'From: Prover <prover@elsewhere.example>',
    `To: ${USER}@slothlee.xyz`,
    'Subject: Quantum test',
    'Message-ID: <pq-interop-' + Date.now() + '@elsewhere.example>',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    marker,
    '',
  ].join('\r\n')
  const imported = await call('POST', '/import/message',
    { raw: Buffer.from(raw).toString('base64'), date_unix: Math.floor(Date.now() / 1000) }, token)
  check('the message was stored', imported.status === 200 && !!imported.json.uid, String(imported.status))
  const uid = imported.json.uid

  // u128 over the wire must be raw digits: Number() loses precision above 2^53.
  const res = await fetch(BASE + '/email/get', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: `{"uid":${uid}}`,
  })
  const body = await res.json()
  const envelope = unb64(body.message_key)
  check('the stored envelope is the hybrid one', isPqEnvelope(envelope),
    Buffer.from(envelope.slice(0, 4)).toString('hex'))
  const rsaLen = (envelope[4] << 8) | envelope[5]
  check('the envelope carries both halves', rsaLen === 512 && envelope.length === 6 + 512 + 1088,
    `rsa ${rsaLen}, mlkem ${envelope.length - 6 - rsaLen}`)

  const plaintext = await decryptEmail(body.data, body.message_key, rsa.privateKey, pq.secretKey, USER)
  check('the shipped client code opens it', plaintext.includes(marker))

  console.log('the properties that make it hybrid')
  const wrongSecret = generatePqKeyPair().secretKey
  // ML-KEM decapsulates with *implicit rejection*: a wrong secret key yields a
  // pseudorandom shared secret rather than an error, by design. So the failure
  // must surface as an AEAD authentication failure, and that is the correct
  // behaviour to assert — an error here would mean the combiner was leaking
  // whether the PQ half matched.
  let failedWithWrongPq = false
  let wrongPqCode = ''
  try {
    await decryptEmail(body.data, body.message_key, rsa.privateKey, wrongSecret, USER)
  } catch (err) {
    failedWithWrongPq = true
    wrongPqCode = err.code || err.message
  }
  check('a different PQ key cannot open it', failedWithWrongPq, wrongPqCode)

  let failedWithWrongName = false
  try {
    await decryptEmail(body.data, body.message_key, rsa.privateKey, pq.secretKey, 'somebody-else')
  } catch {
    failedWithWrongName = true
  }
  check('the account name is bound into the key', failedWithWrongName)

  let failedWithoutPq = false
  try {
    await decryptEmail(body.data, body.message_key, rsa.privateKey, null, USER)
  } catch (err) {
    failedWithoutPq = err.code === 'pq_key_missing'
  }
  check('without the PQ half it refuses, with a name for why', failedWithoutPq)

  console.log('cleaning up')
  await fetch(BASE + '/email/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: `{"uid":${uid}}`,
  })
  await call('DELETE', '/user/pq-keys', undefined, token)
  const removed = await call('DELETE', '/admin/users', { username: USER }, adminToken)
  check('the probe account is gone', removed.status === 200, String(removed.status))

  console.log(`\n${pass} passed, ${failures.length} failed`)
  process.exit(failures.length ? 1 : 0)
}

main().catch((err) => {
  console.error('interop proof crashed:', err)
  process.exit(1)
})
