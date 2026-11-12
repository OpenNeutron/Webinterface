import '@testing-library/jest-dom/vitest'
import { webcrypto } from 'node:crypto'

// jsdom exposes a `crypto` without subtle; openpgp needs the real WebCrypto.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
}

if (!globalThis.confirm) {
  globalThis.confirm = () => true
}

// Unmount between tests so queries never see the previous render twice.
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
afterEach(() => cleanup())
