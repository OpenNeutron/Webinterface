/**
 * The shipped browser crypto, importable from Node.
 *
 * `src/crypto.js` imports a Vite worker, which Node cannot resolve; this strips
 * that one import out of a temporary copy of the live file, so proofs run
 * against the real code rather than a re-implementation that drifts.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'crypto.js'), 'utf8')
  .replace("import KeygenWorker from './keygen.worker.js?worker&inline'", 'const KeygenWorker = null')

// It must live inside the project: bare imports (hash-wasm, node-forge) resolve
// relative to the file, so a copy in /tmp cannot find them.
const dir = mkdtempSync(join(here, '..', '..', '.probe-crypto-'))
const path = join(dir, 'crypto.mjs')
writeFileSync(path, source)
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ } })

const mod = await import(path)

export const {
  decryptEmail,
  decryptEmailBytes,
  sealHybridPayload,
  hashPassword,
  generateKeyPair,
  exportPublicKeyBase64,
  encryptPrivateKey,
  generatePqKeyPair,
  wrapSecretBytes,
  unwrapSecretBytes,
  isPqEnvelope,
} = mod
export default mod
