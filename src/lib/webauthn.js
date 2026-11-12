/**
 * Security keys (WebAuthn) in the browser.
 *
 * Every failure is named here rather than surfacing as "wrong password": a key
 * cannot work in an insecure context, inside a cross-origin frame, or when the
 * user dismisses the prompt, and those are three different sentences.
 */

export const webauthnSupported = () =>
  typeof window !== 'undefined' &&
  !!window.PublicKeyCredential &&
  !!navigator.credentials &&
  typeof navigator.credentials.create === 'function'

export const webauthnSecure = () => typeof window !== 'undefined' && window.isSecureContext

export function securityKeyProblem() {
  if (!webauthnSupported()) {
    return 'This browser cannot use a security key. Try Chrome, Edge, Firefox or Safari on a recent version.'
  }
  if (!webauthnSecure()) {
    return 'Security keys need the site opened over https, on its own address — not inside a frame or a preview link.'
  }
  return ''
}

const urlToBuffer = (value) => {
  const s = String(value || '').replace(/-/g, '+').replace(/_/g, '/')
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4)
  const raw = atob(padded)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out.buffer
}

export const bufferToUrl = (buffer) => {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Turn the server's creation options into the shape the browser expects. */
function creationOptions(options) {
  return {
    publicKey: {
      ...options,
      challenge: urlToBuffer(options.challenge),
      user: { ...options.user, id: urlToBuffer(options.user.id) },
      excludeCredentials: (options.excludeCredentials || []).map((c) => ({ ...c, id: urlToBuffer(c.id) })),
    },
  }
}

function requestOptions(options) {
  return {
    publicKey: {
      ...options,
      challenge: urlToBuffer(options.challenge),
      allowCredentials: (options.allowCredentials || []).map((c) => ({ ...c, id: urlToBuffer(c.id) })),
    },
  }
}

/**
 * Name why a WebAuthn call failed. The three cases users actually hit are a
 * cancelled prompt, a key that is already enrolled, and a page that is not a
 * secure context — and none of them mean the credentials were wrong.
 */
export function describeKeyError(err) {
  const name = err?.name || ''
  if (name === 'NotAllowedError') {
    return 'No key answered. Touch the key when it blinks, or choose another option — nothing was changed.'
  }
  if (name === 'InvalidStateError') {
    return 'That key is already registered on this account. Use a different one, or remove the old entry first.'
  }
  if (name === 'SecurityError') {
    return 'The browser refused the key because this page is not a secure context. Open the site directly over https.'
  }
  if (name === 'AbortError') return 'The key was removed before it finished.'
  if (name === 'NotSupportedError') return 'This key does not support the required algorithm.'
  return err?.message || 'The security key step failed.'
}

/** Register a key. Returns the fields the server needs to verify the attestation. */
export async function createSecurityKey(options) {
  const credential = await navigator.credentials.create(creationOptions(options))
  if (!credential) throw new Error('The key returned nothing')
  const response = credential.response
  return {
    id: credential.id,
    clientDataJSON: bufferToUrl(response.clientDataJSON),
    attestationObject: bufferToUrl(response.attestationObject),
    transports: response.getTransports ? response.getTransports() : [],
  }
}

/** Prove possession of a key. Returns the assertion the server verifies. */
export async function getAssertion(options) {
  const credential = await navigator.credentials.get(requestOptions(options))
  if (!credential) throw new Error('The key returned nothing')
  const response = credential.response
  return {
    id: credential.id,
    clientDataJSON: bufferToUrl(response.clientDataJSON),
    authenticatorData: bufferToUrl(response.authenticatorData),
    signature: bufferToUrl(response.signature),
    userHandle: response.userHandle ? bufferToUrl(response.userHandle) : null,
  }
}
