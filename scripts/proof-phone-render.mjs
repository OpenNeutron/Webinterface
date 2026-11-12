/**
 * Proof: a message is readable on a phone, at the size a phone actually is.
 *
 * This exists because the same bug shipped twice and was only ever caught by the user:
 * HTML mail cut off at the right edge. Every earlier "verification" measured at the
 * device's *screen* size (390x844) — a size no browser gives a page — or measured the
 * page's scrollWidth, which stays at the viewport width while the message's own box
 * overflows invisibly inside the reader.
 *
 * So this proof does what the eye does:
 *   - drives a real Chromium at 390x700, 360x640, 412x760 (browser chrome subtracted)
 *   - imports mail with the shapes that break: a 600px newsletter table, a 2002-era
 *     four-column table, a 900px layout, and a verification mail with a logo header
 *   - compares *painted* rectangles: nothing may sit to the right of the frame, the
 *     frame may not sit to the right of the column, the page may not scroll sideways
 *   - and the short verification mail must be whole on one screen, not scrolled
 *
 *   node scripts/proof-phone-render.mjs
 *
 * Prints "<n> passed, <m> failed" and exits non-zero on any failure.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import {
  hashPassword, generateKeyPair, exportPublicKeyBase64, encryptPrivateKey,
  generatePqKeyPair, wrapSecretBytes,
} from '../src/lib/probeCrypto.mjs'

const WEB = 'https://mail.slothlee.xyz'
const API = `${WEB}/api`
const USER = `phoneproof${Date.now().toString(36).slice(-5)}`
const ADMIN = (() => {
  for (const p of ['/tmp/admin.jwt', '/opt/data/home/.tmp/admin.jwt']) {
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim()
  }
  return ''
})()

// Playwright installs chromium under a versioned directory, so the path is discovered
// rather than pinned: a hardcoded build number turns this proof into a crash the day
// the host updates.
function findChrome() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN
  const roots = ['/opt/hermes/.playwright', path.join(os.homedir(), '.cache/ms-playwright')]
  const named = ['chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-linux/chrome']
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    for (const dir of fs.readdirSync(root).sort().reverse()) {
      for (const rel of named) {
        const candidate = path.join(root, dir, rel)
        if (fs.existsSync(candidate)) return candidate
      }
    }
  }
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) {
    if (fs.existsSync(p)) return p
  }
  return null
}

let passed = 0
const failures = []
function check(name, ok, detail) {
  if (ok) { passed += 1; return }
  failures.push(`${name} — ${detail}`)
}

async function call(method, p, body, token) {
  const res = await fetch(API + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json = {}
  try { json = JSON.parse(text) } catch { json = { raw: text.slice(0, 160) } }
  return { status: res.status, json }
}

// ── fixtures: the shapes that actually break ────────────────────────────────
const FI = {
  newsletter600: `<!doctype html><html><body>
<table width="600" cellpadding="0" cellspacing="0" style="width:600px;font-family:Arial,sans-serif">
<tr><td style="padding:20px"><h1 style="font-size:24px;margin:0">Weekly Digest</h1></td></tr>
<tr><td style="padding:0 20px 20px;font-size:15px;line-height:1.5">
A newsletter written for a six hundred pixel canvas, with a paragraph long enough to wrap several times at this width.
</td></tr>
<tr><td style="padding:20px;background:#eef4ff;font-size:14px">A call to action that lives in its own cell</td></tr>
</table></body></html>`,

  legacyColumns: `<table width="620" cellpadding="0" cellspacing="0" style="width:620px">
<tr><td width="140" style="font-size:11px">Navigation</td><td width="140" style="font-size:11px">Advertise</td>
<td width="140" style="font-size:11px">Downloads</td><td width="200" style="font-size:11px">All CNET</td></tr>
<tr><td colspan="4" nowrap style="font-size:12px">A row with nowrap on the cell, which holds the column open at any screen width</td></tr>
</table>`,

  wide900: `<div style="width:900px;font-size:14px;font-family:Arial">
A layout that declares nine hundred pixels and cannot reflow into a phone column at all.
</div>`,

  // Declares its own background: the sender's design must survive untouched.
  themedMail: `<div style="background:#ffffff;color:#111111;padding:16px">
<p style="font-family:Arial;font-size:15px">A message that dresses itself.</p></div>`,

  // Never opened by this proof: the reference row for "unread still looks unread".
  keepUnread: `<p style="font-family:Arial;font-size:15px">
A message nothing opens, so the inbox always has one row that is definitely unread.
</p>`,

  verifyMail: `<table width="600" cellpadding="0" cellspacing="0" style="width:600px;font-family:-apple-system,Helvetica,Arial,sans-serif">
<tr><td align="center" style="padding:28px 0 12px"><div style="font-family:cursive;font-size:26px">Instagram</div>
<hr style="border:0;border-top:1px solid #dbdbdb;margin:18px 24px 0"></td></tr>
<tr><td style="padding:20px 24px 0;font-size:16px">Hi,</td></tr>
<tr><td style="padding:12px 24px 0;font-size:16px;line-height:1.5">Someone tried to sign up for an Instagram account with
<b>you@example.com</b>. If it was you, enter this confirmation code in the app:</td></tr>
<tr><td align="center" style="padding:24px;font-size:34px;letter-spacing:8px;color:#8e8e8e">414118</td></tr>
<tr><td style="padding:0 24px 28px;font-size:13px;line-height:1.5;color:#8e8e8e">If you didn't request this code, you can safely
ignore this email.</td></tr>
<tr><td style="padding:0 24px 32px;font-size:11px;color:#c7c7c7">&copy; Instagram, 1 Hacker Way</td></tr>
</table>`,
}

// ── a minimal CDP client ───────────────────────────────────────────────────
class CDP {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
      }
    })
  }
  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true })
      ws.addEventListener('error', () => rej(new Error('devtools socket refused')), { once: true })
    })
    return new CDP(ws)
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id
    const payload = { id, method, params, ...(sessionId ? { sessionId } : {}) }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify(payload))
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`${method} timed out`)) }
      }, 20000)
    })
  }
}

async function launchChrome() {
  const bin = findChrome()
  if (!bin) throw new Error('no chromium binary found; set CHROME_BIN')
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'phoneproof-'))
  const child = spawn(bin, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] })

  const wsUrl = await new Promise((resolve, reject) => {
    let buf = ''
    const timer = setTimeout(() => reject(new Error('chromium did not report a devtools socket')), 20000)
    child.stderr.on('data', (d) => {
      buf += d.toString()
      const m = buf.match(/ws:\/\/[^\s]+/)
      if (m) { clearTimeout(timer); resolve(m[0]) }
    })
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`chromium exited ${code}`)) })
  })
  return { child, wsUrl, profile }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function openSession(cdp, storage) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  await cdp.send('Page.enable', {}, sessionId)
  await cdp.send('Runtime.enable', {}, sessionId)
  await cdp.send('Page.navigate', { url: `${WEB}/login` }, sessionId)
  await sleep(2500)
  await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      localStorage.setItem('openneutron', JSON.stringify(${JSON.stringify(storage.local)}));
      const ss = ${JSON.stringify(storage.session)};
      for (const k of Object.keys(ss)) sessionStorage.setItem(k, ss[k]);
      return 'ok';
    })()`,
    returnByValue: true,
  }, sessionId)
  return { sessionId, targetId }
}

async function evaluate(cdp, sessionId, expression) {
  const r = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  }, sessionId)
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'evaluate threw')
  return r.result?.value
}

// Everything the eye can see, measured inside the message's own document.
const MEASURE = `(() => {
  const fit = document.querySelector('.email-html-fit');
  if (!fit) return JSON.stringify({ error: 'no reader wrapper' });
  const frame = fit.querySelector('iframe');
  if (!frame) return JSON.stringify({ error: 'no message frame' });
  const doc = frame.contentDocument;
  if (!doc || !doc.body) return JSON.stringify({ error: 'frame unreadable' });
  const wrapBox = fit.getBoundingClientRect();
  const frameBox = frame.getBoundingClientRect();
  const frameW = parseFloat(getComputedStyle(frame).width);
  const scale = parseFloat(fit.dataset.scale || '1');
  const els = [...doc.body.querySelectorAll('*')];
  const paintedRight = els.length ? Math.max(...els.map((e) => e.getBoundingClientRect().right)) : 0;
  const fonts = els.filter((e) => (e.innerText || '').trim() && !e.children.length)
    .map((e) => parseFloat(getComputedStyle(e).fontSize) * scale).filter((n) => n > 0);
  return JSON.stringify({
    mode: fit.dataset.mode,
    scale,
    clipRight: Math.round(paintedRight - frameW),
    frameOutsideColumn: Math.round(frameBox.right - wrapBox.right),
    pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    wholeOnScreen: frameBox.bottom <= innerHeight + 1,
    minFont: fonts.length ? Math.round(Math.min(...fonts) * 10) / 10 : null,
    vw: innerWidth, vh: innerHeight,
  });
})()`

async function main() {
  if (!ADMIN) throw new Error('no admin token at /tmp/admin.jwt — cannot create the proof account')

  // ── account with real keys, so messages can be decrypted and opened ──────
  await call('DELETE', '/admin/users', { username: USER }, ADMIN)
  const created = await call('POST', '/admin/users', { username: USER }, ADMIN)
  if (![200, 201].includes(created.status)) throw new Error(`account create failed ${created.status}`)
  const passwordHash = await hashPassword(`phoneproof-${Date.now()}`)
  await call('POST', '/admin/users/credentials', { username: USER, password: passwordHash }, ADMIN)
  const login = await call('POST', '/auth/login', { username: USER, password: passwordHash })
  if (login.status !== 200 || !login.json.token) throw new Error(`login failed ${login.status}`)
  const token = login.json.token
  const salt = login.json.salt || login.json.server_salt
  const rsa = await generateKeyPair()
  const publicKey = await exportPublicKeyBase64(rsa.publicKey)
  const encKey = await encryptPrivateKey(rsa.privateKey, passwordHash, salt)
  const setup = await call('POST', '/user/setup',
    { password: passwordHash, public_key: publicKey, encrypted_private_key: encKey }, token)
  if (setup.status !== 200) throw new Error(`account setup failed ${setup.status}`)

  // Post-quantum keys, because that is what a real account has: without them the
  // server seals mail in the old envelope and the proof would test a path nobody uses.
  const pq = generatePqKeyPair()
  const pqEn = await call('POST', '/user/pq-keys', {
    public_key: Buffer.from(pq.publicKey).toString('base64'),
    encrypted_private_key: await wrapSecretBytes(pq.secretKey, passwordHash, salt),
  }, token)
  if (pqEn.status !== 200) throw new Error(`pq enable failed ${pqEn.status}`)

  // ── fixtures in, through the real import path ───────────────────────────
  const subjects = {}
  let dayOffset = 0
  for (const [key, html] of Object.entries(FI)) {
    const subject = `PHONE ${key}`
    subjects[key] = subject
    // Different dates: today, this year, and two older years, so the date column has to
    // hold "14:34", "Oct 17" and "Aug 20, 24" at once instead of one repeated width.
    const when = new Date(Date.now() - dayOffset * 24 * 60 * 60 * 1000)
    dayOffset = dayOffset === 0 ? 12 : dayOffset === 12 ? 400 : 800
    const raw = [
      'From: Proof <proof@example.com>',
      `To: ${USER}@slothlee.xyz`,
      `Subject: ${subject}`,
      `Date: ${when.toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      html,
    ].join('\r\n')
    const res = await call('POST', '/import/message',
      { raw: Buffer.from(raw, 'utf8').toString('base64') }, token)
    check(`import ${key}`, res.status === 200, `POST /import/message ${res.status} ${JSON.stringify(res.json).slice(0, 120)}`)
  }

  // ── the browser a phone actually gives the page ─────────────────────────
  // PHONE_PROOF_VIEWPORTS exists so this proof can be shown to fail: point it at a
  // viewport where the message cannot fit (390x300) and it must go red. A proof that
  // cannot fail is a decoration.
  const VIEWPORTS = (process.env.PHONE_PROOF_VIEWPORTS || '390x700,360x640,412x760')
    .split(',').map((s) => {
      const [w, h] = s.split('x').map(Number)
      return { w, h, label: `${w}x${h}` }
    })

  const { child, wsUrl, profile } = await launchChrome()
  const cdp = await CDP.connect(wsUrl)
  try {
    const jwk = await crypto.subtle.exportKey('jwk', rsa.privateKey)
    const storage = {
      local: { token, username: USER, public_key: publicKey, login_salt: salt, is_admin: false },
      session: {
        'openneutron.private_key': JSON.stringify({ format: 'jwk', data: jwk }),
        'openneutron.salt': salt,
        'openneutron.pq_key': Buffer.from(pq.secretKey).toString('base64'),
      },
    }

    for (const vp of VIEWPORTS) {
      const { sessionId, targetId } = await openSession(cdp, storage)
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: vp.w, height: vp.h, deviceScaleFactor: 3, mobile: true,
      }, sessionId)
      await cdp.send('Page.navigate', { url: `${WEB}/?v=${Date.now()}` }, sessionId)
      await sleep(6000)

      // The date column must be one column, not three widths and a wrap.
      const dates = JSON.parse(await evaluate(cdp, sessionId, `(() => {
        const rows = [...document.querySelectorAll('.mail-row')];
        const cells = rows.map((r) => [...r.querySelectorAll('span.mono')].pop()).filter(Boolean);
        return JSON.stringify({
          count: cells.length,
          widths: [...new Set(cells.map((c) => Math.round(c.getBoundingClientRect().width)))],
          wrapped: cells.filter((c) => c.getClientRects().length > 1).length,
        });
      })()`))
      check(`dates @ ${vp.label}: one column width`, dates.widths.length === 1,
        `date widths ${JSON.stringify(dates.widths)}`)
      check(`dates @ ${vp.label}: never wrap`, dates.wrapped === 0,
        `${dates.wrapped} date(s) wrapped to a second line`)

      for (const key of Object.keys(FI).filter((k) => k !== 'keepUnread')) {
        const subject = subjects[key]
        const opened = await evaluate(cdp, sessionId, `(() => {
          const rows = [...document.querySelectorAll('.mail-row')];
          const row = rows.find((r) => (r.innerText || '').includes(${JSON.stringify(subject)}));
          if (!row) return false;
          row.click();
          return true;
        })()`)
        if (!opened) {
          check(`${key} @ ${vp.label}: opens`, false, 'message row not found in the inbox')
          continue
        }
        await sleep(3500)
        const raw = await evaluate(cdp, sessionId, MEASURE)
        const m = JSON.parse(raw)
        if (m.error) { check(`${key} @ ${vp.label}: renders`, false, m.error); continue }

        check(`${key} @ ${vp.label}: nothing past the right edge`, m.clipRight <= 2,
          `content painted ${m.clipRight}px past the frame`)
        check(`${key} @ ${vp.label}: frame inside the column`, m.frameOutsideColumn <= 1,
          `frame ${m.frameOutsideColumn}px outside the column`)
        check(`${key} @ ${vp.label}: page does not scroll sideways`, m.pageOverflow === false,
          `document scrollWidth ${m.vw}+ while the viewport is ${m.vw}`)
        check(`${key} @ ${vp.label}: text stays legible`, (m.minFont ?? 0) >= 8,
          `smallest rendered text is ${m.minFont}px`)

        if (key === 'verifyMail') {
          check(`${key} @ ${vp.label}: whole message on one screen`, m.wholeOnScreen === true,
            `message ends at ${m.vh}+ (mode ${m.mode}, scale ${m.scale})`)
        }

        // Paper: a message that declares no background is drawn on the app's paper, so a
        // dark theme does not show a white slab with pale ink on it; a message that does
        // declare one keeps it.
        const paper = JSON.parse(await evaluate(cdp, sessionId, `(() => {
          const f = document.querySelector('iframe.email-html-body');
          const b = f && f.contentDocument && f.contentDocument.body;
          const app = getComputedStyle(document.documentElement).getPropertyValue('--color-background').trim();
          return JSON.stringify({
            body: b ? getComputedStyle(b).backgroundColor : null,
            app, dark: document.documentElement.dataset.theme !== 'light',
          });
        })()`))
        if (key === 'themedMail') {
          check(`${key} @ ${vp.label}: the sender's background is kept`,
            paper.body === 'rgb(255, 255, 255)', `body background is ${paper.body}`)
        } else if (paper.dark && ['verifyMail', 'wide900'].includes(key)) {
          // These two declare no background of their own, so the app's paper applies.
          // newsletter600 declares one on a table cell, and keeps it — that is the
          // distinction being tested, not an exception to it.
          check(`${key} @ ${vp.label}: drawn on the app's paper, not a white slab`,
            paper.body !== 'rgb(255, 255, 255)', `body background is ${paper.body}`)
        }

        // The verbs have to be reachable with a thumb at the end of a long message.
        // They were once rendered above it — inside the column, before the scroll area —
        // so this checks position, not merely existence.
        const bar = JSON.parse(await evaluate(cdp, sessionId, `(() => {
          const want = ['Reply', 'All', 'Fwd', 'Reply all', 'Forward'];
          const btns = [...document.querySelectorAll('button')]
            .filter((b) => want.includes((b.innerText || '').trim()))
            .filter((b) => b.getBoundingClientRect().top > innerHeight * 0.6);
          return JSON.stringify({
            count: btns.length,
            short: btns.filter((b) => b.getBoundingClientRect().height < 44).length,
            vh: innerHeight,
            lowest: btns.length ? Math.max(...btns.map((b) => Math.round(b.getBoundingClientRect().bottom))) : 0,
          });
        })()`))
        check(`${key} @ ${vp.label}: reply bar sits at the bottom`, bar.count >= 2,
          `${bar.count} action(s) in the bottom third of ${bar.vh}px`)
        check(`${key} @ ${vp.label}: reply bar is thumb-sized`, bar.short === 0,
          `${bar.short} action(s) under 44px`)
        check(`${key} @ ${vp.label}: reply bar is on screen`, bar.lowest > 0 && bar.lowest <= bar.vh + 1,
          `bar ends at ${bar.lowest} of ${bar.vh}`)

        await evaluate(cdp, sessionId, `(() => {
          const b = [...document.querySelectorAll('button')]
            .find((e) => /back to inbox|^← Inbox/i.test(e.innerText || ''));
          if (b) b.click();
        })()`)
        await sleep(1600)

        // Unread has to survive a grayscale screen: weight and a dot, not a hue.
        // Opening a message marks it read, so the row just visited must now be lighter
        // than the ones still waiting.
        if (key === 'verifyMail') {
          const unread = JSON.parse(await evaluate(cdp, sessionId, `(() => {
            const rows = [...document.querySelectorAll('.mail-row')];
            const weight = (r) => {
              const s = r.querySelector('span.truncate');
              return s ? getComputedStyle(s).fontWeight : null;
            };
            const dot = (r) => {
              const d = [...r.querySelectorAll('span')]
                .find((s) => (s.className || '').includes('size-1.5 rounded-full'));
              return d ? getComputedStyle(d).opacity : null;
            };
            const opened = rows.find((r) => (r.innerText || '').includes(${JSON.stringify(subject)}));
            // Compare against the fixture this proof never opens, not "some other row":
            // by the third viewport every row it has visited is read.
            const other = rows.find((r) => (r.innerText || '').includes(${JSON.stringify(subjects.keepUnread)}));
            return JSON.stringify({
              readWeight: opened ? weight(opened) : null,
              unreadWeight: other ? weight(other) : null,
              unreadDot: other ? dot(other) : null,
              hasLabel: other ? /Unread/.test(other.innerText || '') : false,
            });
          })()`))
          check(`${key} @ ${vp.label}: the opened message turns read`, unread.readWeight === '400',
            `row weight is ${unread.readWeight} after opening`)
          check(`${key} @ ${vp.label}: unread keeps its weight`, unread.unreadWeight === '600',
            `unread row weight is ${unread.unreadWeight}`)
          check(`${key} @ ${vp.label}: unread keeps its dot`, Number(unread.unreadDot) > 0.9,
            `dot opacity ${unread.unreadDot}`)
          check(`${key} @ ${vp.label}: unread is named, not just coloured`, unread.hasLabel === true,
            'no Unread text for screen readers')
        }
      }
      await cdp.send('Target.closeTarget', { targetId })
    }
  } finally {
    try { child.kill('SIGKILL') } catch { /* already gone */ }
    fs.rmSync(profile, { recursive: true, force: true })
    await call('DELETE', '/admin/users', { username: USER }, ADMIN).catch(() => {})
  }

  console.log(`${passed} passed, ${failures.length} failed`)
  for (const f of failures) console.log(`  FAIL ${f}`)
  process.exit(failures.length ? 1 : 0)
}

main().catch((err) => {
  console.log(`0 passed, 1 failed`)
  console.log(`  FAIL proof crashed: ${err.message}`)
  process.exit(1)
})
