/**
 * Photograph the mail surface at phone sizes and measure it.
 *
 * The UI pass needs a baseline that is a rendered picture, not an opinion: this creates a
 * throwaway account with a small, deliberately varied mailbox, opens the inbox at the three
 * phone viewports the project tests at, and prints what actually painted — row heights,
 * painted width versus viewport, and any control under 44 px.
 *
 *   SHOT_DIR=/tmp/shots node scripts/shot-inbox.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { hashPassword, generateKeyPair, exportPublicKeyBase64, encryptPrivateKey } from '../src/lib/probeCrypto.mjs'

const WEB = 'https://mail.slothlee.xyz'
const API = `${WEB}/api`
const USER = `uipass${Date.now().toString(36).slice(-5)}`
const PASSWORD = `UiPass-${Math.random().toString(36).slice(2, 12)}`
const ADMIN_FILE = ['/tmp/admin.jwt', '/opt/data/home/.tmp/admin.jwt'].find((p) => fs.existsSync(p))
const ADMIN = ADMIN_FILE ? fs.readFileSync(ADMIN_FILE, 'utf8').trim() : ''
const SHOTS = process.env.SHOT_DIR || '/tmp/shots'
fs.mkdirSync(SHOTS, { recursive: true })

const VIEWPORTS = [
  { w: 390, h: 700, tag: '390' },
  { w: 360, h: 640, tag: '360' },
  { w: 412, h: 760, tag: '412' },
]

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

/** A mailbox with the shapes that break list layouts. */
const FIXTURES = [
  ['Priya Raman', 'Q4 rollout: the two dates that moved', 'Finance signed off on the 14th, so the migration window shifts by a week. Nothing else changes.'],
  ['GitHub', '[sloth-lee] Run failed: ci — main (a91f2c4)', 'Build failed in 3m 12s. The gate could not reach the database container.'],
  ['Barclays', 'Your statement is ready', 'Your statement for October is now available in Online Banking.'],
  ['Ana Beatriz Ferreira-Lindqvist', 'Re: Re: Re: Re: contract redlines — final, this time (really)', 'Attached is the version we agreed on the phone. Please confirm before Friday.'],
  ['noreply', 'Verify your email address', 'Click the link to confirm this address belongs to you.'],
  ['Sam Smith', 'pictures from the weekend', 'No message body, just the two files.'],
]

function message({ from, subject, body, minutesAgo }) {
  const date = new Date(Date.now() - minutesAgo * 60000).toUTCString()
  return [
    `From: ${from} <${from.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@example.com>`,
    `To: ${USER}@slothlee.xyz`,
    `Subject: ${subject}`,
    `Date: ${date}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
    '',
  ].join('\r\n')
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
  if (!ADMIN) throw new Error('no admin token')
  const chrome = findChrome()
  if (!chrome) throw new Error('no Chromium')

  await call('DELETE', '/admin/users', { username: USER }, ADMIN)
  await call('POST', '/admin/users', { username: USER }, ADMIN)
  const passwordHash = await hashPassword(PASSWORD)
  await call('POST', '/admin/users/credentials', { username: USER, password: passwordHash }, ADMIN)
  const login = await call('POST', '/auth/login', { username: USER, password: passwordHash })
  const token = login.json.token
  const rsa = await generateKeyPair()
  await call('POST', '/user/setup', {
    password: passwordHash,
    public_key: await exportPublicKeyBase64(rsa.publicKey),
    encrypted_private_key: await encryptPrivateKey(rsa.privateKey, PASSWORD, login.json.salt),
  }, token)

  for (const [i, [from, subject, body]] of FIXTURES.entries()) {
    await call('POST', '/import/message', {
      raw: Buffer.from(message({ from, subject, body, minutesAgo: (i + 1) * 37 })).toString('base64'),
    }, token)
  }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'uishot-'))
  const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--hidden=1', '--window-size=390,700', 'about:blank'],
    { stdio: ['ignore', 'pipe', 'pipe'] })

  const wsUrl = await new Promise((resolve, reject) => {
    let buf = ''
    const timer = setTimeout(() => reject(new Error('no devtools address')), 20000)
    proc.stderr.on('data', (d) => {
      buf += d.toString()
      const m = buf.match(/ws:\/\/[^\s]+/)
      if (m) { clearTimeout(timer); resolve(m[0]) }
    })
    proc.on('exit', () => reject(new Error('chromium exited')))
  })

  const browser = await CDP.connect(wsUrl)
  const { targetInfos } = await browser.send('Target.getTargets')
  const page = targetInfos.find((t) => t.type === 'page')
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId: page.targetId, flatten: true })
  const send = (m, p) => browser.send(m, p, sessionId)
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Network.enable')
  await send('Network.setCacheDisabled', { cacheDisabled: true })

  const evalJS = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
    return r.result.value
  }
  const waitFor = async (expr, timeout = 30000) => {
    const until = Date.now() + timeout
    while (Date.now() < until) {
      try { if (await evalJS(expr)) return true } catch { /* navigating */ }
      await sleep(300)
    }
    return false
  }
  const shot = async (name) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' })
    const file = path.join(SHOTS, `${name}.png`)
    fs.writeFileSync(file, Buffer.from(data, 'base64'))
    return file
  }
  const fill = (selector, value) => evalJS(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)

  await send('Page.navigate', { url: `${WEB}/login` })
  await waitFor(`!!document.querySelector('#username')`)
  await fill('#username', USER)
  await fill('#password', PASSWORD)
  await evalJS(`document.querySelector('form button[type=submit]').click()`)
  const ok = await waitFor(`location.pathname === '/' && document.body.innerText.length > 200`, 30000)
  console.log('signed in:', ok)

  for (const vp of VIEWPORTS) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: vp.w, height: vp.h, deviceScaleFactor: 2, mobile: true,
    })
    await send('Page.navigate', { url: `${WEB}/` })
    await sleep(2200)
    const metrics = await evalJS(`(() => {
      const rows = [...document.querySelectorAll('[data-uid], li[role="button"], .mail-row')];
      const boxes = rows.map((r) => r.getBoundingClientRect()).filter((b) => b.height > 2);
      const wide = [...document.querySelectorAll('body *')]
        .map((el) => el.getBoundingClientRect())
        .filter((b) => b.right > window.innerWidth + 0.5)
        .length;
      const small = [...document.querySelectorAll('button, a[href]')]
        .map((el) => ({ w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height, t: (el.innerText || el.getAttribute('aria-label') || '').slice(0, 18) }))
        .filter((b) => (b.h > 0 && b.h < 44) || (b.w > 0 && b.w < 44));
      return {
        viewport: window.innerWidth + 'x' + window.innerHeight,
        rows: boxes.length,
        rowHeights: [...new Set(boxes.map((b) => Math.round(b.height)))].slice(0, 8),
        overflowing: wide,
        smallTargets: small.length,
        smallSample: small.slice(0, 6).map((b) => b.t + ' ' + Math.round(b.w) + 'x' + Math.round(b.h)),
      };
    })()`)
    console.log(vp.tag, JSON.stringify(metrics))
    console.log('  shot:', await shot(`inbox-${vp.tag}`))
  }

  // Why exactly this row stops short: geometry, not a guess.
  if (process.env.MEASURE_ROW) {
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 700, deviceScaleFactor: 2, mobile: true })
    await send('Page.navigate', { url: `${WEB}/` })
    await sleep(2200)
    const detail = await evalJS(`(() => {
      const rows = [...document.querySelectorAll('[data-uid], li[role="button"], .mail-row')];
      const out = [];
      for (const row of rows) {
        // The subject is the first line that is not the sender: find the truncating node.
        const leaves = [...row.querySelectorAll('.truncate, p, span')].filter(
          (el) => el.children.length === 0 && !/sr-only/.test(el.className) && (el.textContent || '').trim(),
        ).sort((x, y) => (y.textContent || '').length - (x.textContent || '').length);
        const truncs = leaves.slice(0, 1);
        if (!truncs.length) continue;
        const el = truncs[0];
        const parent = el.parentElement;
        const box = (n) => { const b = n.getBoundingClientRect(); return Math.round(b.width) + 'w@' + Math.round(b.left); };
        out.push({
          text: (el.textContent || ''),
          el: box(el), client: el.clientWidth, scroll: el.scrollWidth,
          parent: box(parent),
          parentChildren: [...parent.children].map((c) => c.tagName + '.' + (c.className || '').toString().slice(0, 22) + ' ' + box(c)),
          grid: parent.parentElement ? box(parent.parentElement) : null,
          rowBox: (() => { const b = row.getBoundingClientRect(); const cs = getComputedStyle(row); return Math.round(b.width) + 'w@' + Math.round(b.left) + ' pad:' + cs.paddingLeft + '/' + cs.paddingRight; })(),
          style: (() => { const cs = getComputedStyle(el); return cs.display + ' ov:' + cs.overflow + ' clamp:' + (cs.webkitLineClamp || '-') + ' te:' + cs.textOverflow + ' ws:' + cs.whiteSpace; })(),
        });
      }
      return { rows: out.slice(0, 2), innerWidth: window.innerWidth, clientWidth: document.documentElement.clientWidth,
               scrollbar: window.innerWidth - document.documentElement.clientWidth };
    })()`)
    console.log('MEASURE', JSON.stringify(detail, null, 1))
  }

  // The reader, which the pass also touches.
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 700, deviceScaleFactor: 2, mobile: true })
  await send('Page.navigate', { url: `${WEB}/` })
  await sleep(1800)
  const opened = await evalJS(`(() => { const r = document.querySelector('[data-uid]'); if (!r) return false; r.click(); return true; })()`)
  if (opened) {
    await sleep(2500)
    console.log('  shot:', await shot('reader-390'))
    const rm = await evalJS(`(() => {
      const col = document.querySelector('[data-reader], article, main');
      const b = col ? col.getBoundingClientRect() : null;
      return { readerWidth: b ? Math.round(b.width) : null, viewport: window.innerWidth,
               overflowing: [...document.querySelectorAll('body *')].map((e) => e.getBoundingClientRect()).filter((x) => x.right > window.innerWidth + 0.5).length };
    })()`)
    console.log('reader', JSON.stringify(rm))
  }

  proc.kill('SIGKILL')
  fs.rmSync(profile, { recursive: true, force: true })
  await call('DELETE', '/admin/users', { username: USER }, ADMIN)
}

main().catch(async (err) => {
  console.error('shot run failed:', err.message)
  try { await call('DELETE', '/admin/users', { username: USER }, ADMIN) } catch { /* best effort */ }
  process.exit(1)
})
