
import { encodeRfc2047Word, foldBase64 } from './mime'

function rfc5322Date(d) {
  return d.toUTCString().replace('GMT', '+0000')
}

function makeMessageId(ts, rand, domain) {
  return `<${ts}.${rand}@${domain}>`
}

function makeRand() {
  return Math.random().toString(36).slice(2, 10)
}

function buildHeaders({ from, to, cc, subject, date, messageId, inReplyTo, references, e2ee }) {
  return [
    `Date: ${date}`,
    `Message-ID: ${messageId}`,
    ...(inReplyTo  ? [`In-Reply-To: ${inReplyTo}`]  : []),
    ...(references ? [`References: ${references}`]   : []),
    `From: ${from}`,
    ...(to.length ? [`To: ${to.join(', ')}`] : []),
    ...(cc.length ? [`Cc: ${cc.join(', ')}`] : []),
    `Subject: ${encodeRfc2047Word(subject) || '(no subject)'}`,
    'MIME-Version: 1.0',
    'X-Mailer: Sloth Lee Mail',
    ...(e2ee ? ['OpenNeutron-E2EE: true'] : []),
  ]
}

function asDocument(body) {
  const html = body || ''
  if (/<html[\s>]/i.test(html)) return html
  return `<!DOCTYPE html>\r\n<html><body>${html}</body></html>`
}

function buildTextPart(body, boundary) {
  return [
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    asDocument(body),
  ].join('\r\n')
}

function buildAttachmentPart({ name, type, data }, boundary) {
  const safeName = encodeRfc2047Word(name) || name
  const mimeType = type || 'application/octet-stream'
  return [
    `--${boundary}`,
    `Content-Type: ${mimeType}; name="${safeName}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${safeName}"`,
    '',
    foldBase64(data),
  ].join('\r\n')
}

export function buildEmail({ from, to = [], cc = [], subject, body = '', attachments = [], inReplyTo = '', references = '', e2ee = false }) {
  const now    = new Date()
  const ts     = now.getTime()
  const rand   = makeRand()
  // 'from' may be a formatted address like `"Tibs" <tibs@slothlee.xyz>`, so take
  // the domain from inside the angle brackets — splitting on '@' alone leaves a
  // trailing '>' and produces an invalid Message-ID that receivers flag.
  const domain = String(from ?? '').match(/@([^>\s,;]+)/)?.[1] ?? 'localhost'

  const headers = buildHeaders({
    from,
    to,
    cc,
    subject,
    date:      rfc5322Date(now),
    messageId: makeMessageId(ts, rand, domain),
    inReplyTo,
    references,
    e2ee,
  })

  // PGP/MIME: an armoured message with no attachments is wrapped in
  // multipart/encrypted, which mail clients recognise and decrypt on their own.
  // Inline armour requires the recipient's client to guess; this does not.
  if (attachments.length === 0 && /^-----BEGIN PGP MESSAGE-----/.test(String(body).trim())) {
    const pgpBoundary = `----=_PGP_${ts}_${rand}`
    return [
      ...headers,
      `Content-Type: multipart/encrypted; protocol="application/pgp-encrypted"; boundary="${pgpBoundary}"`,
      '',
      `--${pgpBoundary}`,
      'Content-Type: application/pgp-encrypted',
      'Content-Description: PGP/MIME version identification',
      '',
      'Version: 1',
      '',
      `--${pgpBoundary}`,
      'Content-Type: application/octet-stream; name="encrypted.asc"',
      'Content-Description: OpenPGP encrypted message',
      'Content-Disposition: inline; filename="encrypted.asc"',
      'Content-Transfer-Encoding: 7bit',
      '',
      String(body).trim(),
      '',
      `--${pgpBoundary}--`,
    ].join('\r\n')
  }

  if (attachments.length === 0) {
    return [
      ...headers,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      asDocument(body),
    ].join('\r\n')
  }

  const boundary = `----=_Part_${ts}_${rand}`

  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    buildTextPart(body, boundary),
    ...attachments.map((att) => buildAttachmentPart(att, boundary)),
    `--${boundary}--`,
  ].join('\r\n')
}
