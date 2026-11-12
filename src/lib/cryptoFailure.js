/**
 * What to tell someone when the browser itself refuses to do the crypto.
 *
 * The password step runs in WebAssembly (Argon2, bcrypt). Anything that blocks wasm —
 * a content blocker, an extension, or a CSP that forgot 'wasm-unsafe-eval' — makes the
 * hashing call throw before a single byte is sent. Reported as "login failed" that
 * reads as "wrong password", and people retype a correct password until they give up.
 *
 * Every screen that runs a crypto step on submit should check this first.
 */

export function isCryptoUnavailable(err) {
  return err?.code === 'crypto_unavailable'
}

export function cryptoUnavailableMessage(what = 'password step') {
  return (
    `This browser could not run the ${what}, so nothing was sent. ` +
    'A content blocker or an extension that blocks WebAssembly is the usual cause — ' +
    'try a private window, or allow this site and reload.'
  )
}
