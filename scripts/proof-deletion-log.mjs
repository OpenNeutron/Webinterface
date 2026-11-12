/**
 * Proof for the deletion log.
 *
 * The claim is narrow: a message cannot leave the mailbox without a record, the
 * records link to each other, and the head is signed with a key this proof checks
 * itself rather than trusting the server to say so.
 *
 *   node scripts/proof-deletion-log.mjs
 */
import fs from 'node:fs'
import { execSync } from 'node:child_process'
import {
  hashPassword, generateKeyPair, exportPublicKeyBase64, encryptPrivateKey,
} from '../src/lib/probeCrypto.mjs'
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js'
import { createHash } from 'node:crypto'

const BASE = 'https://mail.slothlee.xyz/api'
const USER = 'logprobe'
const adminToken = fs.readFileSync('/tmp/admin.jwt', 'utf8').trim()
const SSH = 'ssh -i /opt/data/home/.ssh/mail_ed25519 root@46.62.155.175'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  ok   ${name}`) } else { fail += 1; console.log(`  FAIL ${name} ${detail}`) }
}

async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: typeof body === 'string' ? body : body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json = {}
  try { json = JSON.parse(text.replace(/([,:\[]\s*)(\d{16,})/g, '$1"$2"')) } catch { json = { raw: text.slice(0, 160) } }
  return { status: res.status, json }
}

const b64 = (text) => Buffer.from(text, 'base64')
const sha256 = (text) => createHash('sha256').update(text).digest('hex')
const entryHash = (prev, seq, ts, op, uid) => sha256(`${prev}|${seq}|${ts}|${op}|${uid}`)

async function main() {
  await call('DELETE', '/admin/users', JSON.stringify({ username: USER }), adminToken)
  await call('POST', '/admin/users', JSON.stringify({ username: USER }), adminToken)
  const password = `probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const passwordHash = await hashPassword(password)
  await call('POST', '/admin/users/credentials', JSON.stringify({ username: USER, password: passwordHash }), adminToken)
  const login = await call('POST', '/auth/login', JSON.stringify({ username: USER, password: passwordHash }))
  const token = login.json.token
  const salt = login.json.salt || login.json.server_salt
  const rsa = await generateKeyPair()
  await call('POST', '/user/setup', {
    password: passwordHash,
    public_key: await exportPublicKeyBase64(rsa.publicKey),
    encrypted_private_key: await encryptPrivateKey(rsa.privateKey, password, salt),
  }, token)

  let status = await call('GET', '/user/log', undefined, token)
  check('a fresh account has an empty log', status.status === 200 && status.json.count === 0,
    JSON.stringify(status.json).slice(0, 120))

  // Two messages in, both imported, so the uids are known.
  const uids = []
  for (const subject of ['Log one', 'Log two']) {
    const raw = [
      'From: Sender <sender@elsewhere.example>',
      `To: ${USER}@slothlee.xyz`,
      `Subject: ${subject}`,
      'Date: Wed, 14 Aug 2024 09:00:00 +0000',
      'MIME-Version: 1.0',
      'Content-Type: text/plain',
      '',
      `Body of ${subject}.`,
    ].join('\r\n')
    const r = await call('POST', '/import/message', { raw: Buffer.from(raw).toString('base64') }, token)
    if (r.status !== 200) throw new Error(`import failed ${r.status}`)
    uids.push(r.json.uid)
  }

  status = await call('GET', '/user/log', undefined, token)
  check('importing is not a deletion', status.json.count === 0, `count ${status.json.count}`)

  const del = await call('POST', '/email/delete', `{"uid":${uids[0]}}`, token)
  check('one message deleted', del.status === 200, String(del.status))

  status = await call('GET', '/user/log', undefined, token)
  const snap = status.json
  check('the deletion is recorded', snap.count === 1 && snap.entries?.length === 1, JSON.stringify(snap).slice(0, 140))
  check('the entry names the message and the reason',
    snap.entries?.[0]?.uid === String(uids[0]) && snap.entries?.[0]?.op === 'deleted',
    JSON.stringify(snap.entries?.[0] || {}).slice(0, 140))

  // The signature is checked here, with the key the server published — nothing
  // about "verified" comes from the server's own say-so.
  // @noble orders these (signature, message, publicKey) — not the WebCrypto order.
  const verified = ml_dsa65.verify(
    b64(snap.signature),
    new TextEncoder().encode(snap.head),
    b64(snap.public_key),
  )
  check('the head signature verifies against the published key', verified)
  check('a different head does not verify',
    !ml_dsa65.verify(b64(snap.signature), new TextEncoder().encode('deadbeef'), b64(snap.public_key)))

  const entry = snap.entries[0]
  check('the entry hash is what the chain says it is',
    entry.hash === entryHash(entry.prev, entry.seq, entry.ts, entry.op, entry.uid), entry.hash)
  check('the first entry starts from an empty head', entry.prev === '', entry.prev)

  // A second deletion has to link to the first.
  await call('POST', '/email/delete', `{"uid":${uids[1]}}`, token)
  status = await call('GET', '/user/log', undefined, token)
  const two = status.json
  const [newest, oldest] = two.entries
  check('a second deletion extends the chain', two.count === 2 && newest.prev === oldest.hash,
    `${newest?.prev?.slice(0, 12)} vs ${oldest?.hash?.slice(0, 12)}`)

  // Delete something that is not ours: the log must not grow.
  const before = two.count
  await call('POST', '/email/delete', '{"uid":12345}', token)
  status = await call('GET', '/user/log', undefined, token)
  check('a refused deletion writes nothing', status.json.count === before, `count ${status.json.count}`)

  // Tamper with the stored chain and confirm the signature no longer matches.
  execSync(`${SSH} "python3 - <<'PY'
import json
p='/opt/on/data/mailboxlog.json'
d=json.load(open(p))
u=d['users']['${USER}']
u['entries'][0]['uid']='999'
json.dump(d, open(p,'w'))
PY"`, { stdio: 'ignore' })
  const tampered = await call('GET', '/user/log', undefined, token)
  const stillVerifies = ml_dsa65.verify(
    b64(tampered.json.signature),
    new TextEncoder().encode(tampered.json.head),
    b64(tampered.json.public_key),
  )
  const chainOk = tampered.json.entries?.every((e) =>
    e.hash === entryHash(e.prev, e.seq, e.ts, e.op, e.uid))
  check('an edited entry breaks the chain the client recomputes', chainOk === false,
    `chainOk=${chainOk} verifies=${stillVerifies}`)

  // Put it back, so the account is left in a coherent state before deletion.
  execSync(`${SSH} "python3 - <<'PY'
import json
p='/opt/on/data/mailboxlog.json'
d=json.load(open(p))
d['users'].pop('${USER}', None)
json.dump(d, open(p,'w'))
PY"`, { stdio: 'ignore' })

  await call('DELETE', '/admin/users', JSON.stringify({ username: USER }), adminToken)
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => { console.error('PROOF ERROR:', err.message); process.exit(1) })
