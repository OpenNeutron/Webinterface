// End-to-end send in a real browser, against production.
//
// Signs in as one QA account, composes to another, presses Send, and reports whether the
// composer refused. It exists because every unit test in this repo stubs the network: this
// is the only check that the shipped bundle fetches a key, verifies its transparency proof,
// seals a hybrid envelope and gets it accepted.
//
// Credentials come from QA_ACCOUNTS, a `user:password` file kept off the repo
// one `user:password` per line. Never commit that file.
//
//   node scripts/e2e-send.mjs
//
// Then confirm the server side:
//   ssh … "cd /opt/on && python3 /tmp/newest-envelope.py qatester2 1"   → magic=SLQ version=2

import { createRequire } from 'node:module'
import { readFileSync, appendFileSync } from 'node:fs'

const require = createRequire('/opt/data/workspace/sloth-lee/dashboard/package.json')
const puppeteer = require('puppeteer-core')

const accounts = Object.fromEntries(
  readFileSync(process.env.QA_ACCOUNTS || '/opt/data/cache/scratch/e2e-accounts.txt', 'utf8')
    .split('\n')
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split(':')),
)

const FROM = process.env.QA_FROM || 'qatester'
const TO = process.env.QA_TO || 'qatester2@slothlee.xyz'
const SUBJECT = process.env.QA_SUBJECT || `kt e2e ${new Date().toISOString()}`
const BODY = 'checking the directory before sealing this'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = []
const record = (line) => {
  log.push(line)
  console.log(line)
}

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 412, height: 760 },
})

let page
try {
  page = await browser.newPage()
  page.on('console', (msg) => {
    const text = msg.text()
    if (/kt |transparency|proof|verify|refus/i.test(text)) record(`console: ${text}`)
  })

  await page.goto('https://mail.slothlee.xyz/login', { waitUntil: 'networkidle2', timeout: 60000 })

  // Optionally plant a key-transparency head this browser "saw" earlier, so a send has to
  // prove the directory still extends it. Without this the harness always looks like a
  // brand-new browser, which is the one case where no proof is required.
  if (process.env.QA_KT_PIN_SIZE && process.env.QA_KT_PIN_ROOT) {
    await page.evaluate(
      (value) => localStorage.setItem('sloth.kt.head', JSON.stringify(value)),
      { size: Number(process.env.QA_KT_PIN_SIZE), root: process.env.QA_KT_PIN_ROOT },
    )
    record(`pinned head: size ${process.env.QA_KT_PIN_SIZE}`)
  }

  const fields = await page.$$('input')
  await fields[0].type(FROM)
  await fields[1].type(accounts[FROM])
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('button')).find((b) => /sign in|log in|continue/i.test(b.textContent || ''))?.click()
  })
  try {
    // Wait on the route, not on words: the compose button lives in the sidebar, which a
    // phone hides behind the nav drawer, and the word "Inbox" only appears in the empty
    // state. Both made this look like a failed sign-in on a perfectly good session.
    await page.waitForFunction(() => !/\/login/.test(location.pathname), { timeout: 90000 })
    await sleep(2500)
  } catch {
    record('sign-in did not reach the mailbox; page says: ' + (await page.evaluate(() => document.body.innerText.slice(0, 200).replace(/\n/g, ' | '))))
    throw new Error('sign-in failed')
  }
  await sleep(1200)
  record('signed in')

  await page.evaluate(() => {
    Array.from(document.querySelectorAll('button')).find((b) => /new message/i.test(b.textContent || ''))?.click()
  })
  await page.waitForFunction(() => !!document.querySelector('input[placeholder="Subject"]'), { timeout: 20000 })
  await sleep(600)

  const recipient = (await page.$$('input[placeholder="Email address…"]'))[0]
  await recipient.click()
  await recipient.type(TO)
  await page.keyboard.press('Enter')
  await sleep(400)

  const subject = (await page.$$('input[placeholder="Subject"]'))[0]
  await subject.click()
  await subject.type(SUBJECT)

  const editable = await page.$('[contenteditable="true"]')
  if (editable) {
    await editable.click()
    await page.keyboard.type(BODY)
  } else {
    record('no contenteditable body found')
  }
  await sleep(400)

  record(`composer: ${await page.evaluate(() => document.body.innerText.slice(0, 200).replace(/\n/g, ' | '))}`)

  const clicked = await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('button')).find((b) => /^send$/i.test((b.textContent || '').trim()))
    if (!button) return false
    button.click()
    return true
  })
  record(clicked ? 'pressed Send' : 'no Send button found')

  await sleep(10000)

  const after = await page.evaluate(() => document.body.innerText)
  const refusal = after.split('\n').find((line) => /could not verify whose key|key directory this browser saw/i.test(line))
  if (refusal) record(`REFUSED: ${refusal}`)

  await page.screenshot({ path: process.env.QA_SHOT || '/tmp/e2e-after-send.png' })
  // A refusal is a result too: when asked, capture what the panel says after Send.
  if (process.env.QA_DUMP_TEXT) {
    try {
      const text = await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | '))
      log.push('page after send: ' + text.slice(0, 500))
    } catch (err) {
      log.push('page after send: could not read the page (' + err.message + ')')
    }
  }
  appendFileSync(process.env.QA_LOG || '/tmp/e2e-send.log', `${log.join('\n')}\nSUBJECT ${SUBJECT}\n---\n`)
  console.log(`SUBJECT ${SUBJECT}`)
} catch (error) {
  console.error('FAILED:', error.message)
  console.error(log.join('\n'))
  process.exitCode = 1
} finally {
  await browser.close()
}
