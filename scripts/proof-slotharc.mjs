/**
 * Proof for sealed archives.
 *
 * Two halves:
 *   1. the format — round trip, and every way a file can be damaged must fail
 *      loudly rather than yield a mailbox with silent gaps;
 *   2. the round trip through production — export an account's mail, seal it,
 *      restore it into a different empty account through the normal import path,
 *      and check the mail that comes out is the mail that went in.
 *
 *   node scripts/proof-slotharc.mjs
 */
import fs from 'node:fs'
import {
  hashPassword, generateKeyPair, exportPublicKeyBase64, encryptPrivateKey, decryptEmailBytes,
} from '../src/lib/probeCrypto.mjs'
import { sealArchive, openArchive } from '../src/lib/slotharc.js'

const BASE = 'https://mail.slothlee.xyz/api'
const SOURCE = 'arcsrc'
const TARGET = 'arcdst'
const passphrase = 'nine solid vellum beams'
const adminToken = fs.readFileSync('/tmp/admin.jwt', 'utf8').trim()

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  ok   ${name}`) } else { fail += 1; console.log(`  FAIL ${name} ${detail}`) }
}

async function call(method, path, rawBody, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: typeof rawBody === 'string' ? rawBody : rawBody === undefined ? undefined : JSON.stringify(rawBody),
  })
  let text = await res.text()
  let json = {}
  try {
    // uids are u128: parsed as JS numbers they lose precision, so quote long
    // digit runs before parsing — the same repair the app's axios does.
    json = JSON.parse(text.replace(/([,:\[]\s*)(\d{16,})/g, '$1"$2"'))
  } catch { json = { raw: text.slice(0, 160) } }
  return { status: res.status, json }
}

const SUBJECTS = {
  'Archive one': 'First message. Body line one.\nSecond line with "quotes" and — punctuation.',
  'Archive two': 'Second message — unicode: café, ✓, 日本語.',
  'Archive three': 'Third message, deliberately longer.\n' + 'Filler line.\n'.repeat(40),
  'Archive four': 'Fourth message.',
}

function rfc822(subject, body, to) {
  return Buffer.from([
    'From: Sender <sender@elsewhere.example>',
    `To: ${to}@slothlee.xyz`,
    `Subject: ${subject}`,
    'Date: Wed, 14 Aug 2024 09:00:00 +0000',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ].join('\r\n'))
}

async function makeAccount(username, withMail) {
  await call('DELETE', '/admin/users', `{"username":"${username}"}`, adminToken)
  const created = await call('POST', '/admin/users', `{"username":"${username}"}`, adminToken)
  if (![200, 201].includes(created.status)) throw new Error(`create ${username} failed ${created.status}`)
  const password = `probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const passwordHash = await hashPassword(password)
  await call('POST', '/admin/users/credentials', JSON.stringify({ username, password: passwordHash }), adminToken)
  const login = await call('POST', '/auth/login', JSON.stringify({ username, password: passwordHash }))
  const token = login.json.token
  const salt = login.json.salt || login.json.server_salt
  const rsa = await generateKeyPair()
  const publicKey = await exportPublicKeyBase64(rsa.publicKey)
  await call('POST', '/user/setup', {
    password: passwordHash,
    public_key: publicKey,
    encrypted_private_key: await encryptPrivateKey(rsa.privateKey, password, salt),
  }, token)
  const uids = []
  if (withMail) {
    for (const [subject, body] of Object.entries(SUBJECTS)) {
      const r = await call('POST', '/import/message', { raw: rfc822(subject, body, username).toString('base64') }, token)
      if (r.status !== 200) throw new Error(`import failed ${r.status}`)
    }
    const list = await call('POST', '/email/list', '{}', token)
    uids.push(...(list.json.uids || list.json.emails || []))
  }
  return { username, token, rsa, uids }
}

async function readAll(account) {
  const out = []
  const status = await call('POST', '/email/list', '{}', account.token)
  const uids = status.json.uids || status.json.emails || []
  for (const uid of uids) {
    const g = await call('POST', '/email/get', `{"uid":${uid}}`, account.token)
    const bytes = await decryptEmailBytes(g.json.data, g.json.message_key ?? null, account.rsa.privateKey, null, account.username)
    out.push(Buffer.from(bytes))
  }
  return out
}

async function main() {
  // ── 1. the format ────────────────────────────────────────────────────────
  console.log('\nformat')
  const messages = Object.entries(SUBJECTS).map(([s, b]) => rfc822(s, b, 'arcsrc'))
  const archive = await sealArchive(messages, passphrase, { account: 'arcsrc' })

  check('seals to bytes', archive.length > 0)
  const text = Buffer.from(archive).toString('latin1')
  check('no message body survives in the file', !text.includes('Second message') && !text.includes('Subject: Archive one'))
  check('manifest is not in the clear either', !text.includes('slotharc'))

  const opened = await openArchive(archive, passphrase)
  check('manifest comes back', opened.manifest?.format === 'slotharc' && opened.manifest?.messages === 4,
    JSON.stringify(opened.manifest).slice(0, 90))
  check('every message comes back byte for byte',
    opened.messages.length === 4 && opened.messages.every((m, i) => Buffer.compare(Buffer.from(m), messages[i]) === 0))

  let wrong = ''
  try { await openArchive(archive, 'nine solid vellum bean') } catch (e) { wrong = e.message }
  check('a wrong passphrase does not open it', /wrong passphrase/.test(wrong), wrong)

  let truncated = ''
  try { await openArchive(archive.slice(0, archive.length - 40), passphrase) } catch (e) { truncated = e.message }
  check('a truncated file is refused, not half-restored', truncated.length > 0, truncated)

  const tampered = archive.slice()
  tampered[tampered.length - 60] ^= 0x01
  let tamperMsg = ''
  try { await openArchive(tampered, passphrase) } catch (e) { tamperMsg = e.message }
  check('a flipped byte is caught', tamperMsg.length > 0, tamperMsg)

  let notOurs = ''
  try { await openArchive(new TextEncoder().encode('From alice@example.com Wed Aug 14 09:00:00 2024\nSubject: hi\n'), passphrase) } catch (e) { notOurs = e.message }
  check('an mbox is not mistaken for an archive', /not a sealed archive/.test(notOurs), notOurs)

  // ── 2. through production ────────────────────────────────────────────────
  console.log('\nround trip through the server')
  const source = await makeAccount(SOURCE, true)
  const target = await makeAccount(TARGET, false)

  const exported = await readAll(source)
  check('the source account exported four messages', exported.length === 4, `saw ${exported.length}`)

  const file = await sealArchive(exported, passphrase, { account: source.username })
  fs.writeFileSync('/tmp/arcsrc.slotharc', file)
  check('archive written to disk', fs.statSync('/tmp/arcsrc.slotharc').size === file.length)

  const restored = await openArchive(fs.readFileSync('/tmp/arcsrc.slotharc'), passphrase)
  let imported = 0
  for (const message of restored.messages) {
    const r = await call('POST', '/import/message', { raw: Buffer.from(message).toString('base64') }, target.token)
    if (r.status === 200) imported += 1
  }
  check('every message restored into the other account', imported === 4, `imported ${imported}`)

  const back = await readAll(target)
  check('the target account now holds four messages', back.length === 4, `saw ${back.length}`)
  const bodies = back.map((b) => b.toString('utf8'))
  const allThere = Object.entries(SUBJECTS).every(([subject, body]) => bodies.some((b) => b.includes(subject) && b.includes(body)))
  check('subjects and bodies arrived intact', allThere)

  // Restoring the same archive twice must not duplicate the mailbox.
  for (const message of restored.messages) {
    await call('POST', '/import/message', { raw: Buffer.from(message).toString('base64') }, target.token)
  }
  const again = await readAll(target)
  check('restoring twice does not duplicate', again.length === 4, `saw ${again.length}`)

  await call('DELETE', '/admin/users', `{"username":"${SOURCE}"}`, adminToken)
  await call('DELETE', '/admin/users', `{"username":"${TARGET}"}`, adminToken)

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => { console.error('PROOF ERROR:', err.message); process.exit(1) })
