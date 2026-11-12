/**
 * Proof: the OpenPGP identity lives on the account, not in one browser.
 *
 * Three sign-ins, in a real browser, at 390 px:
 *
 *   1. create an identity, then sign out    — nothing is on the account yet
 *   2. sign in                              — the sync uploads it, wrapped
 *   3. wipe storage as a new device would, sign in
 *                                           — the identity comes back, same fingerprint
 *
 * The fingerprint is the assertion: a restore that produced a different key, or no key at
 * all, cannot pass.
 *
 *   node scripts/proof-pgp-ui.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { hashPassword, generateKeyPair, exportPublicKeyBase64, encryptPrivateKey } from '../src/lib/probeCrypto.mjs'

const WEB = 'https://mail.slothlee.xyz'
const API = `${WEB}/api`
const USER = `pgpui${Date.now().toString(36).slice(-5)}`
const PASSWORD = `PgpUi-${Math.random().toString(36).slice(2, 12)}`
const RING = 'sloth.pgp.keyring.v1'
const ADMIN_FILE = ['/tmp/admin.jwt', '/opt/data/home/.tmp/admin.jwt'].find((p) => fs.existsSync(p))
const ADMIN = ADMIN_FILE ? fs.readFileSync(ADMIN_FILE, 'utf8').trim() : ''

let passed = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`  ok   ${name}`); return }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}

async function call(method, p, body, token) {
  const res = await fetch(API + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text()
  let json = {}
  try { json = JSON.parse(t) } catch { json = {} }
  return { status: res.status, json }
}

function findChrome() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN
  const roots = ['/opt/hermes/.playwright', path.join(os.homedir(), '.cache/ms-playwright')]
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    for (const dir of fs.readdirSync(root).sort().reverse()) {
      for (const rel of ['chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-linux/chrome']) {
        const c = path.join(root, dir, rel)
        if (fs.existsSync(c)) return c
      }
    }
  }
  return null
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map()
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id)
        this.pending.delete(m.id)
        m.error ? reject(new Error(m.error.message)) : resolve(m.result)
      }
    })
  }
  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true })
      ws.addEventListener('error', () => rej(new Error('devtools refused')), { once: true })
    })
    return new CDP(ws)
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  if (!ADMIN) throw new Error('no admin token at /tmp/admin.jwt')
  const chrome = findChrome()
  if (!chrome) throw new Error('no Chromium found')

  await call('DELETE', '/admin/users', { username: USER }, ADMIN)
  await call('POST', '/admin/users', { username: USER }, ADMIN)
  const passwordHash = await hashPassword(PASSWORD)
  await call('POST', '/admin/users/credentials', { username: USER, password: passwordHash }, ADMIN)

  // An account with real mail keys, so sign-in behaves exactly as it does for a person.
  const login0 = await call('POST', '/auth/login', { username: USER, password: passwordHash })
  const token0 = login0.json.token
  const rsa = await generateKeyPair()
  await call('POST', '/user/setup', {
    password: passwordHash,
    public_key: await exportPublicKeyBase64(rsa.publicKey),
    encrypted_private_key: await encryptPrivateKey(rsa.privateKey, PASSWORD, login0.json.salt),
  }, token0)

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pgpui-'))
  const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--window-size=390,700', 'about:blank'],
    { stdio: ['ignore', 'pipe', 'pipe'] })

  const wsUrl = await new Promise((resolve, reject) => {
    let buf = ''
    const timer = setTimeout(() => reject(new Error('Chromium printed no devtools address')), 20000)
    proc.stderr.on('data', (d) => {
      buf += d.toString()
      const m = buf.match(/ws:\/\/[^\s]+/)
      if (m) { clearTimeout(timer); resolve(m[0]) }
    })
    proc.on('exit', () => reject(new Error('Chromium exited early')))
  })

  const browser = await CDP.connect(wsUrl)
  const { targetInfos } = await browser.send('Target.getTargets')
  const page = targetInfos.find((t) => t.type === 'page')
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId: page.targetId, flatten: true })
  const send = (m, p) => browser.send(m, p, sessionId)
  await send('Page.enable')
  await send('Runtime.enable')
  const consoleLines = []
  browser.ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ')
      if (text) consoleLines.push(text.slice(0, 240))
    }
  })

  const evalJS = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
    return r.result.value
  }
  const waitFor = async (expression, timeout = 30000) => {
    const until = Date.now() + timeout
    while (Date.now() < until) {
      try { if (await evalJS(expression)) return true } catch { /* navigating */ }
      await sleep(300)
    }
    return false
  }
  const goto = async (url) => { await send('Page.navigate', { url }); await sleep(900) }
  const fill = (selector, value) => evalJS(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)

  const signIn = async () => {
    await goto(`${WEB}/login`)
    await waitFor(`!!document.querySelector('#username')`)
    await fill('#username', USER)
    await fill('#password', PASSWORD)
    await evalJS(`document.querySelector('form button[type=submit]').click()`)
    return waitFor(`location.pathname === '/' || location.pathname.startsWith('/settings')`, 30000)
  }
  const signOut = async () => {
    await goto(`${WEB}/settings`)
    const clicked = await evalJS(`(() => { const b = document.querySelector('[aria-label="Sign out"]'); if (!b) return false; b.click(); return true; })()`)
    if (!clicked) return false
    return waitFor(`location.pathname === '/login'`, 20000)
  }
  const ringFingerprint = () => evalJS(`(() => {
    try { const r = JSON.parse(localStorage.getItem(${JSON.stringify(RING)}) || '{}');
      return (r?.identity?.fingerprint || '').toUpperCase() || null } catch { return null }
  })()`)

  // ── 1. create an identity in the browser ──
  check('the account signs in', await signIn())
  await goto(`${WEB}/settings#keys`)
  check('the keys panel opens', await waitFor(`/Your identity|Create key/i.test(document.body.innerText)`, 25000))

  await evalJS(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /create key|create your key|new key|set up/i.test(x.innerText));
    if (b) b.click(); return !!b;
  })()`)
  const formReady = await waitFor(`!!document.querySelector('input[placeholder="At least 8 characters"]')`, 15000)
  check('the create form is reachable', formReady, (await evalJS('document.body.innerText')).slice(-160))

  if (formReady) {
    await fill('input[placeholder="Sam Smith"]', 'Proof Account')
    await fill('input[placeholder="you@slothlee.xyz"]', `${USER}@slothlee.xyz`)
    await fill('input[placeholder="At least 8 characters"]', 'local-passphrase-1')
    await fill('input[placeholder="Repeat passphrase"]', 'local-passphrase-1')
    await evalJS(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /create key/i.test(x.innerText)); if (b) b.click(); return !!b; })()`)
    const made = await waitFor(`(() => { try { const r = JSON.parse(localStorage.getItem(${JSON.stringify(RING)}) || '{}'); return !!r?.identity?.privateKey } catch { return false } })()`, 60000)
    check('a key is created in the browser', made, consoleLines.slice(-3).join(' // '))
  }
  const firstPrint = await ringFingerprint()
  check('the browser holds a fingerprint', !!firstPrint && firstPrint.length >= 40, String(firstPrint))

  // nothing on the account yet: creation happens offline, sync happens at sign-in
  const beforeSync = await call('GET', '/user/pgpkey', undefined, token0)
  check('the account has no key before the next sign-in', beforeSync.json.exists === false)

  // ── 2. sign out, sign in: the identity is uploaded ──
  check('it can sign out', await signOut())
  check('it can sign back in', await signIn())
  const uploaded = await waitFor(`true`, 500)
  void uploaded
  await sleep(3500) // the sync runs after navigation; give it the moment it needs
  const afterUpload = await call('GET', '/user/pgpkey', undefined, token0)
  check('signing in put the key on the account', afterUpload.json.exists === true,
    JSON.stringify(afterUpload.json).slice(0, 80) + ' | ' +
    (consoleLines.filter((l) => /OpenPGP|pgpkey|sync|skip/i.test(l)).join(' // ') || consoleLines.slice(-6).join(' // ')))
  check('and what went up is ciphertext', !String(afterUpload.json.encrypted_private_key || '').includes('BEGIN PGP'))
  check('the uploaded fingerprint is the browser’s', String(afterUpload.json.fingerprint || '').toUpperCase() === firstPrint)

  // ── 3. a new device: no local key at all ──
  check('sign out before wiping', await signOut())
  await evalJS(`localStorage.clear(); sessionStorage.clear(); true`)
  const wiped = await ringFingerprint()
  check('storage really is empty', wiped === null, String(wiped))

  check('the new device signs in', await signIn())
  const restored = await waitFor(`(() => { try { const r = JSON.parse(localStorage.getItem(${JSON.stringify(RING)}) || '{}'); return !!r?.identity?.privateKey } catch { return false } })()`, 45000)
  check('the identity comes back on the new device', restored, consoleLines.slice(-3).join(' // '))
  const secondPrint = await ringFingerprint()
  check('it is the same key, not a new one', !!secondPrint && secondPrint === firstPrint, `${firstPrint} vs ${secondPrint}`)

  proc.kill('SIGKILL')
  fs.rmSync(profile, { recursive: true, force: true })
  await call('DELETE', '/admin/users', { username: USER }, ADMIN)

  const total = passed + failures.length
  console.log(`\n${passed}/${total} checks passed${failures.length ? ', FAILED:' : ''}`)
  failures.forEach((f) => console.log(`  - ${f}`))
  process.exit(failures.length ? 1 : 0)
}

main().catch(async (err) => {
  console.error('proof crashed:', err.message)
  try { await call('DELETE', '/admin/users', { username: USER }, ADMIN) } catch { /* best effort */ }
  process.exit(1)
})
