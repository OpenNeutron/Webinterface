
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function decodeRfc2047(str) {
  if (!str || !str.includes('=?')) return str ?? ''
  return str.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset, enc, text) => {
    try {
      let bytes
      if (enc.toUpperCase() === 'B') {
        const bin = atob(text.replace(/\s/g, ''))
        bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      } else {
        const unescaped = text
          .replace(/_/g, ' ')
          .replace(/=([0-9A-Fa-f]{2})/g, (__, h) => String.fromCharCode(parseInt(h, 16)))
        bytes = new TextEncoder().encode(unescaped)
      }
      return new TextDecoder(charset).decode(bytes)
    } catch {
      return text
    }
  })
}

function splitAddressList(str) {
  const parts = []
  let depth = 0
  let curr = ''
  for (const ch of str) {
    if (ch === '<') depth++
    else if (ch === '>') depth--
    else if (ch === ',' && depth === 0) {
      parts.push(curr.trim())
      curr = ''
      continue
    }
    curr += ch
  }
  if (curr.trim()) parts.push(curr.trim())
  return parts
}

export function parseAddress(str) {
  if (!str) return null
  str = str.trim()
  if (!str) return null

  const angleMatch = str.match(/^(.*?)\s*<([^>@\s]+@[^>]+)>\s*$/)
  if (angleMatch) {
    const rawName = angleMatch[1].replace(/^"|"$/g, '').trim()
    const email = angleMatch[2].trim().toLowerCase()
    const domain = email.split('@')[1] ?? ''
    const name = decodeRfc2047(rawName) || email.split('@')[0]
    return { name, email, domain }
  }

  if (str.includes('@')) {
    const email = str.toLowerCase()
    const domain = email.split('@')[1] ?? ''
    return { name: email.split('@')[0], email, domain }
  }

  return null
}

export function parseAddressList(str) {
  if (!str) return []
  return splitAddressList(str).map(parseAddress).filter(Boolean)
}

export function formatAddress(addr) {
  if (!addr) return ''
  const localPart = addr.email.split('@')[0]
  if (addr.name && addr.name !== localPart && addr.name !== addr.email) {
    return `${addr.name} <${addr.email}>`
  }
  return addr.email
}

export function parseHeaderBlock(block) {
  const unfolded = block.replace(/\r?\n([ \t]+)/g, ' ')
  const lines = unfolded.split(/\r?\n/)
  const headers = []
  for (const line of lines) {
    const colon = line.indexOf(':')
    if (colon < 1) continue
    const name = line.slice(0, colon).trim().toLowerCase()
    const value = decodeRfc2047(line.slice(colon + 1).trim())
    headers.push({ name, value })
  }
  return headers
}

function getHeader(headers, name) {
  return headers.find(h => h.name === name.toLowerCase())?.value ?? null
}

export function parseContentType(value) {
  if (!value) return { type: 'text/plain', params: {} }
  const parts = value.split(';').map(s => s.trim())
  const type = parts[0].toLowerCase()
  const params = {}
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=')
    if (eq < 0) continue
    const k = p.slice(0, eq).trim().toLowerCase()
    let v = p.slice(eq + 1).trim()
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
    params[k] = v
  }
  return { type, params }
}

function decodeQuotedPrintable(str) {
  return str
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

/**
 * A base64 or quoted-printable body decodes to one byte per character — a binary
 * string, not text. Everything non-ASCII in it (an em dash, an ellipsis, an
 * accented name) reads as mojibake until those bytes are decoded to Unicode with
 * the part's own charset. Attachments keep the raw bytes; only text parts pass
 * through here.
 */
function binaryToText(bin, charset) {
  if (!bin) return bin
  // Already text (some senders hand us 8-bit text, and the transcoder above has
  // run): a character above U+00FF means this is not a byte string.
  for (let i = 0; i < bin.length; i += 1) {
    if (bin.charCodeAt(i) > 0xff) return bin
  }
  let ascii = true
  for (let i = 0; i < bin.length; i += 1) {
    if (bin.charCodeAt(i) > 0x7f) { ascii = false; break }
  }
  if (ascii) return bin
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i) & 0xff
  try {
    return new TextDecoder((charset || 'utf-8').trim().toLowerCase()).decode(bytes)
  } catch {
    return bin
  }
}

function decodeTransferEncoding(raw, encoding) {
  const enc = (encoding ?? '').toLowerCase().trim()
  if (enc === 'base64') {
    try { return atob(raw.replace(/\s+/g, '')) } catch { return raw }
  }
  if (enc === 'quoted-printable') return decodeQuotedPrintable(raw)
  return raw
}

function splitMultipart(body, boundary) {
  const esc = escapeRegex(boundary)
  const delimRe = new RegExp(`(?:^|\\n)--${esc}[ \\t]*(?:\\r?\\n|$)`)
  const endRe   = new RegExp(`(?:^|\\n)--${esc}--`)

  const endIdx = body.search(endRe)
  const content = endIdx >= 0 ? body.slice(0, endIdx) : body

  const parts = []
  let remaining = content

  const first = delimRe.exec(remaining)
  if (!first) return parts
  remaining = remaining.slice(first.index + first[0].length)

  let match
  while ((match = delimRe.exec(remaining)) !== null) {
    parts.push(remaining.slice(0, match.index))
    remaining = remaining.slice(match.index + match[0].length)
  }
  parts.push(remaining)

  return parts.filter(p => p.trim())
}

function getAttachmentFilename(headers, ct) {
  const cd = getHeader(headers, 'content-disposition') ?? ''
  const cdMatch = cd.match(/filename\*?=(?:"([^"]+)"|([^\s;]+))/i)
  if (cdMatch) return decodeRfc2047(cdMatch[1] ?? cdMatch[2])
  if (ct.params.name) return decodeRfc2047(ct.params.name)
  return 'attachment'
}

function extractPartsFromRaw(raw) {
  const sepMatch = raw.match(/\r?\n\r?\n/)
  if (!sepMatch) return { textBody: raw, htmlBody: null, attachments: [] }

  const sepIdx = raw.indexOf(sepMatch[0])
  const headerBlock = raw.slice(0, sepIdx)
  const body = raw.slice(sepIdx + sepMatch[0].length)

  const headers = parseHeaderBlock(headerBlock)
  const ct = parseContentType(getHeader(headers, 'content-type'))
  const encoding = getHeader(headers, 'content-transfer-encoding') ?? ''
  const cd = (getHeader(headers, 'content-disposition') ?? '').toLowerCase()

  let textBody = null
  let htmlBody = null
  const attachments = []

  if (ct.type.startsWith('multipart/')) {
    const boundary = ct.params.boundary
    if (boundary) {
      for (const part of splitMultipart(body, boundary)) {
        const sub = extractPartsFromRaw(part)
        if (!textBody && sub.textBody) textBody = sub.textBody
        if (!htmlBody && sub.htmlBody) htmlBody = sub.htmlBody
        attachments.push(...sub.attachments)
      }
    } else {
      textBody = body
    }
  } else {
    const decoded = decodeTransferEncoding(body.trim(), encoding)
    const decodedText = ct.type.startsWith('text/')
      ? binaryToText(decoded, ct.params?.charset)
      : decoded
    const isAttachment =
      cd.startsWith('attachment') ||
      (!ct.type.startsWith('text/') && !ct.type.startsWith('multipart/'))

    if (isAttachment) {
      attachments.push({
        name: getAttachmentFilename(headers, ct),
        contentType: ct.type,
        size: decoded.length,
        data: decoded,
      })
    } else if (ct.type === 'text/html') {
      htmlBody = decodedText
    } else {
      textBody = decodedText
    }
  }

  return { textBody, htmlBody, attachments }
}

export function stripHtml(html) {
  if (!html) return ''
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function formatEmailDate(date) {
  if (!date || isNaN(date.getTime())) return ''
  const pad = n => String(n).padStart(2, '0')
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const now  = new Date()
  const today     = new Date(now.getFullYear(),  now.getMonth(),  now.getDate())
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  if (d.getTime() === today.getTime())     return `Today, ${time}`
  if (d.getTime() === yesterday.getTime()) return `Yesterday, ${time}`
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}, ${time}`
}

export function getFaviconUrl(domain) {
  if (!domain) return null
  return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(domain)}`
}

export function extractPreview(text, maxLen = 160) {
  if (!text) return ''
  const lines = text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('>') && l !== '--')
  const flat = lines.join(' ').replace(/\s+/g, ' ').trim()
  if (flat.length <= maxLen) return flat
  // A preview that stops mid-word reads as a bug, not as a preview: cut at the
  // last word boundary that keeps most of the sentence, and say it was cut.
  const cut = flat.slice(0, maxLen)
  const space = cut.lastIndexOf(' ')
  const body = space > maxLen * 0.6 ? cut.slice(0, space) : cut
  return `${body.replace(/[\s,;:.\-–—]+$/, '')}…`
}

const URL_RE = /https?:\/\/[^\s<>"']+/g

function trimUrlPunctuation(url) {
  return url.replace(/[.,;:!?)>\]'"]+$/, '')
}

export function segmentLinks(text) {
  if (!text) return []
  const segments = []
  let lastIndex = 0
  URL_RE.lastIndex = 0
  let match
  while ((match = URL_RE.exec(text)) !== null) {
    const url = trimUrlPunctuation(match[0])
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    }
    segments.push({ type: 'link', value: url })
    lastIndex = match.index + url.length
    URL_RE.lastIndex = lastIndex
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) })
  }
  return segments
}

export function parseEmail(raw) {
  if (!raw) return null

  const sepMatch = raw.match(/\r?\n\r?\n/)
  const sepIdx = sepMatch ? raw.indexOf(sepMatch[0]) : -1
  const headerBlock = sepIdx >= 0 ? raw.slice(0, sepIdx) : raw
  const bodyRaw     = sepIdx >= 0 ? raw.slice(sepIdx + sepMatch[0].length) : ''

  const headers = parseHeaderBlock(headerBlock)

  const from     = parseAddress(getHeader(headers, 'from'))
  const to       = parseAddressList(getHeader(headers, 'to') ?? '')
  const cc       = parseAddressList(getHeader(headers, 'cc') ?? '')
  const bcc      = parseAddressList(getHeader(headers, 'bcc') ?? '')
  const replyTo   = parseAddressList(getHeader(headers, 'reply-to') ?? '')
  const subject   = getHeader(headers, 'subject') ?? '(no subject)'
  const messageId = getHeader(headers, 'message-id') ?? ''
  const inReplyTo = getHeader(headers, 'in-reply-to') ?? ''
  const references = getHeader(headers, 'references') ?? ''
  const dateStr   = getHeader(headers, 'date') ?? ''
  // Autocrypt: the sender's client attaches its public key so replies can be
  // encrypted without any lookup. Kept on the parsed message so the fetch hook
  // can import it.
  const autocrypt = getHeader(headers, 'autocrypt') ?? ''
  const date     = dateStr ? new Date(dateStr) : null
  const e2ee     = getHeader(headers, 'openneutron-e2ee')?.toLowerCase() === 'true'
  const ct       = parseContentType(getHeader(headers, 'content-type'))

  let textBody = null
  let htmlBody = null
  let attachments = []

  // PGP/MIME arrives as multipart/encrypted: a Version part and then the
  // ciphertext as application/octet-stream. Pull the armour out as the body so
  // the reader treats it like any other encrypted message.
  if (ct.type === 'multipart/encrypted') {
    const armor = bodyRaw.match(/-----BEGIN PGP MESSAGE-----[\s\S]*?-----END PGP MESSAGE-----/)
    textBody = armor ? armor[0] : null
  } else if (ct.type.startsWith('multipart/')) {
    const boundary = ct.params.boundary
    if (boundary) {
      for (const part of splitMultipart(bodyRaw, boundary)) {
        const ext = extractPartsFromRaw(part)
        if (!textBody && ext.textBody) textBody = ext.textBody
        if (!htmlBody && ext.htmlBody) htmlBody = ext.htmlBody
        attachments.push(...ext.attachments)
      }
    } else {
      textBody = bodyRaw
    }
  } else {
    const encoding = getHeader(headers, 'content-transfer-encoding') ?? ''
    const decoded  = decodeTransferEncoding(bodyRaw, encoding)
    const text = ct.type.startsWith('text/') ? binaryToText(decoded, ct.params?.charset) : decoded
    if (ct.type === 'text/html') htmlBody = text
    else textBody = text
  }

  const displayText = textBody ?? (htmlBody ? stripHtml(htmlBody) : '')
  const preview = extractPreview(displayText)

  return {
    headers,
    autocrypt,
    from,
    to,
    cc,
    bcc,
    replyTo,
    subject,
    date,
    e2ee,
    messageId,
    inReplyTo,
    references,
    textBody:    textBody ?? '',
    htmlBody:    htmlBody ?? null,
    attachments,
    preview,
  }
}

function formatLongDate(date) {
  const days   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const pad = n => String(n).padStart(2, '0')
  return `${days[date.getDay()]}, ${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()} at ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function buildReplyAttribution(email) {
  const sender = (email.replyTo?.[0] ?? email.from)
  const dateStr = email.date ? formatLongDate(email.date) : ''
  const senderStr = sender ? `${sender.name} <${sender.email}>` : 'unknown'
  return `On ${dateStr}, ${senderStr} wrote:`
}

export function buildQuotedBody(email) {
  const text = email.textBody || (email.htmlBody ? stripHtml(email.htmlBody) : '')
  const attribution = buildReplyAttribution(email)
  const quoted = text.split('\n').map(l => `> ${l}`).join('\n')
  return `${attribution}\n${quoted}`
}
