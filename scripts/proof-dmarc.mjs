/**
 * Proof: the DMARC panel reads real aggregate reports out of the mailbox.
 *
 * DMARC reports cannot be parsed server-side here — the server cannot read mail — so
 * this proves the client path end to end: three report mails are imported into a fresh
 * account (one all-pass, one plain-text XML with failures, one gzipped like most
 * senders send), the browser decrypts them, parses the XML and adds up the numbers.
 *
 * The numbers are the assertion: 3 reports, 17 messages passed, 7 failed, and the
 * failing source named. If the parser silently mangled a report, these move.
 *
 *   node scripts/proof-dmarc.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { spawn } from 'node:child_process'
import {
  hashPassword, generateKeyPair, exportPublicKeyBase64, encryptPrivateKey,
} from '../src/lib/probeCrypto.mjs'

const WEB = 'https://mail.slothlee.xyz'
const API = `${WEB}/api`
const USER = `dmarcproof${Date.now().toString(36).slice(-5)}`
const PASSWORD = `DmarcProof-${Math.random().toString(36).slice(2, 12)}`
const ADMIN = ['/tmp/admin.jwt', '/opt/data/home/.tmp/admin.jwt'].find((p) => fs.existsSync(p))
  ? fs.readFileSync(['/tmp/admin.jwt', '/opt/data/home/.tmp/admin.jwt'].find((p) => fs.existsSync(p)), 'utf8').trim()
  : ''

let passed = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`  ok   ${name}`); return }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}

const reportXml = ({ reporter, sourceIp, count, fail = false, begin, end }) => `<?xml version="1.0"?>
<feedback>
  <report_metadata>
    <org_name>${reporter}</org_name>
    <report_id>${reporter}-${sourceIp.replace(/\./g, '')}</report_id>
    <date_range><begin>${begin}</begin><end>${end}</end></date_range>
  </report_metadata>
  <policy_published>
    <domain>slothlee.xyz</domain><adkim>s</adkim><aspf>s</aspf><p>reject</p><sp>reject</sp><pct>100</pct>
  </policy_published>
  <record>
    <row>
      <source_ip>${sourceIp}</source_ip>
      <count>${count}</count>
      <policy_evaluated>
        <disposition>${fail ? 'reject' : 'none'}</disposition>
        <dkim>${fail ? 'fail' : 'pass'}</dkim>
        <spf>${fail ? 'fail' : 'pass'}</spf>
      </policy_evaluated>
    </row>
    <identifiers><header_from>slothlee.xyz</header_from></identifiers>
    <auth_results>
      <dkim><domain>slothlee.xyz</domain><result>${fail ? 'fail' : 'pass'}</result></dkim>
      <spf><domain>slothlee.xyz</domain><result>${fail ? 'fail' : 'pass'}</result></spf>
    </auth_results>
  </record>
</feedback>`

function messageWith({ subject, reporter, xml, gzip = false }) {
  const name = gzip ? 'report.xml.gz' : 'report.xml'
  const payload = gzip ? zlib.gzipSync(Buffer.from(xml)) : Buffer.from(xml)
  const b64 = payload.toString('base64').replace(/(.{76})/g, '$1\r\n')
  return [
    `From: ${reporter} <noreply-dmarc@${reporter}>`,
    `To: ${USER}@slothlee.xyz`,
    `Subject: ${subject}`,
    'Date: Thu, 29 Oct 2026 06:00:00 +0000',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="dmarc-boundary"',
    '',
    '--dmarc-boundary',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'This is a DMARC aggregate report.',
    '--dmarc-boundary',
    `Content-Type: application/xml; name="${name}"`,
    `Content-Disposition: attachment; filename="${name}"`,
    'Content-Transfer-Encoding: base64',
    '',
    b64,
    '--dmarc-boundary--',
    '',
  ].join('\r\n')
}

async function call(method, p, body, token) {
  const res = await fetch(API + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text()
  let json = {}
  try { json = JSON.parse(t) } catch { json = { raw: t.slice(0, 160) } }
  return { status: res.status, json }
}

function findChrome() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN
  const roots = ['/opt/hermes/.playwright', path.join(os.homedir(), '.cache/ms-playwright')]
  const named = ['chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-linux/chrome']
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    for (const dir of fs.readdirSync(root).sort().reverse()) {
      for (const rel of named) {
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

  // ── account with real keys, so imported mail can actually be decrypted ──
  await call('DELETE', '/admin/users', { username: USER }, ADMIN)
  if (![200, 201].includes((await call('POST', '/admin/users', { username: USER }, ADMIN)).status)) {
    throw new Error('could not create the test account')
  }
  const passwordHash = await hashPassword(PASSWORD)
  await call('POST', '/admin/users/credentials', { username: USER, password: passwordHash }, ADMIN)
  const login = await call('POST', '/auth/login', { username: USER, password: passwordHash })
  if (login.status !== 200 || !login.json.token) throw new Error(`login ${login.status}`)
  const token = login.json.token
  const salt = login.json.salt || login.json.server_salt
  const rsa = await generateKeyPair()
  await call('POST', '/user/setup', {
    password: passwordHash,
    public_key: await exportPublicKeyBase64(rsa.publicKey),
    encrypted_private_key: await encryptPrivateKey(rsa.privateKey, PASSWORD, salt),
  }, token)

  // ── three reports: pass, fail, and one gzipped like real senders ──
  const begin = Math.floor(Date.now() / 1000) - 86400
  const msgs = [
    { subject: 'Report domain: slothlee.xyz Submitter: google.com', reporter: 'google.com',
      xml: reportXml({ reporter: 'google.com', sourceIp: '46.62.155.175', count: 12, begin, end: begin + 86400 }) },
    { subject: 'Report domain: slothlee.xyz Submitter: microsoft.com', reporter: 'microsoft.com',
      xml: reportXml({ reporter: 'microsoft.com', sourceIp: '203.0.113.9', count: 7, fail: true, begin, end: begin + 86400 }) },
    { subject: 'Report domain: slothlee.xyz Submitter: yahoo.com', reporter: 'yahoo.com',
      xml: reportXml({ reporter: 'yahoo.com', sourceIp: '46.62.155.175', count: 5, begin, end: begin + 86400 }), gzip: true },
  ]
  for (const m of msgs) {
    const raw = messageWith(m)
    const imp = await call('POST', '/import/message', { raw: Buffer.from(raw).toString('base64') }, token)
    if (imp.status !== 200) throw new Error(`import failed ${imp.status} ${JSON.stringify(imp.json).slice(0, 80)}`)
  }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dmarcproof-'))
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

  const evalJS = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
    return r.result.value
  }
  const waitFor = async (expression, timeout = 25000) => {
    const until = Date.now() + timeout
    while (Date.now() < until) {
      try { if (await evalJS(expression)) return true } catch { /* navigating */ }
      await sleep(250)
    }
    return false
  }
  const goto = async (url) => { await send('Page.navigate', { url }); await sleep(900) }
  const shot = async (name) => {
    if (!process.env.SHOT_DIR) return
    const { data } = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(process.env.SHOT_DIR, `${name}.png`), Buffer.from(data, 'base64'))
  }

  // ── sign in and open the panel ──
  await goto(`${WEB}/login`)
  await waitFor(`!!document.querySelector('#username')`)
  await evalJS(`(() => {
    const set = (sel, v) => {
      const el = document.querySelector(sel);
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('#username', ${JSON.stringify(USER)});
    set('#password', ${JSON.stringify(PASSWORD)});
    document.querySelector('form button[type=submit]').click();
    return true;
  })()`)
  const inbox = await waitFor(`location.pathname === '/' && /Inbox/i.test(document.body.innerText)`, 30000)
  check('signs in to the test account', inbox)

  await goto(`${WEB}/settings#dmarc`)
  const panel = await waitFor(`!!document.querySelector('[data-testid=dmarc-scan]')`, 20000)
  check('the DMARC panel opens from the settings index', panel)

  await evalJS(`document.querySelector('[data-testid=dmarc-scan]').click()`)
  const done = await waitFor(`!!document.querySelector('[data-testid=dmarc-summary]')`, 60000)
  check('the scan finishes and shows a summary', done, (await evalJS('document.body.innerText')).slice(0, 160))

  if (done) {
    const num = (id) => evalJS(`Number(document.querySelector('[data-testid=${id}]')?.textContent || -1)`)
    const reports = await num('dmarc-reports')
    const passedCount = await num('dmarc-passed')
    const failedCount = await num('dmarc-failed')
    check('three reports were read', reports === 3, `got ${reports}`)
    check('passing messages add up across the plain and gzipped reports', passedCount === 17, `got ${passedCount}`)
    check('failing messages are counted', failedCount === 7, `got ${failedCount}`)
    const failureText = await evalJS(`document.querySelector('[data-testid=dmarc-failures]')?.innerText || ''`)
    check('the failing source is named', failureText.includes('203.0.113.9'), failureText.slice(0, 120))
    check('the failure panel explains what it means', /reject|someone else may be sending/i.test(failureText))
    await shot('dmarc-panel-390')
  }

  // The check must be able to fail: a report with a broken body must not be counted.
  const bad = `From: broken <broken@example.com>\r\nTo: ${USER}@slothlee.xyz\r\nSubject: Report domain: slothlee.xyz Submitter: broken.example\r\nMIME-Version: 1.0\r\nContent-Type: text/plain\r\n\r\nno attachment here\r\n`
  await call('POST', '/import/message', { raw: Buffer.from(bad).toString('base64') }, token)
  await goto(`${WEB}/settings#dmarc`)
  await waitFor(`!!document.querySelector('[data-testid=dmarc-scan]')`, 15000)
  await evalJS(`document.querySelector('[data-testid=dmarc-scan]').click()`)
  const done2 = await waitFor(`!!document.querySelector('[data-testid=dmarc-summary]')`, 60000)
  const reports2 = done2 ? await evalJS(`Number(document.querySelector('[data-testid=dmarc-reports]')?.textContent || -1)`) : -1
  check('a report with no attachment is skipped, not counted', reports2 === 3, `got ${reports2}`)

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
