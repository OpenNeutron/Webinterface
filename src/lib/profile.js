// Display name and signature, kept on the device.
//
// Deliberately not part of the account record: the server has no use for a
// person's signature, and anything it stores can be read by whoever holds the
// server.

const KEY = 'sloth.profile.v1'

export function loadProfile() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { displayName: '', signature: '' }
    const parsed = JSON.parse(raw)
    return {
      displayName: typeof parsed?.displayName === 'string' ? parsed.displayName : '',
      signature: typeof parsed?.signature === 'string' ? parsed.signature : '',
    }
  } catch {
    return { displayName: '', signature: '' }
  }
}

export function saveProfile({ displayName, signature }) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ displayName, signature }))
  } catch {
    // A full or blocked store must not break sending mail.
  }
}

// "Name <address>" when a name is set, otherwise the bare address.
export function formatSender(address, displayName) {
  const name = (displayName || '').trim()
  if (!name) return address
  return `"${name.replace(/"/g, '')}" <${address}>`
}
