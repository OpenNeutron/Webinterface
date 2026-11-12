/**
 * DMARC aggregate reports, read in the browser.
 *
 * These arrive as XML attachments addressed to the reporting address in the DMARC
 * record, and they are the only way to know what receivers think of your domain —
 * including someone else sending as it. They cannot be parsed on the server, because
 * the server cannot read mail here by design; so this runs in the tab, on messages
 * already decrypted for reading, and nothing about them leaves the device.
 */

/** Subjects look like: "Report domain: slothlee.xyz Submitter: google.com" */
export function looksLikeDmarcReport(subject = '') {
  const s = String(subject).toLowerCase()
  return /report[- ]domain/.test(s) || /dmarc.*aggregate/.test(s) || /aggregate report/.test(s)
}

/** True when an attachment is a DMARC report, gzipped or not. */
export function looksLikeDmarcAttachment(name = '', contentType = '') {
  const n = String(name).toLowerCase()
  const t = String(contentType).toLowerCase()
  if (n.endsWith('.xml') || n.endsWith('.xml.gz') || n.endsWith('.gz')) return true
  return t.includes('xml') || t.includes('gzip')
}

/** Gunzip only when it really is gzip — most reports are, some senders are not. */
export async function maybeGunzip(bytes) {
  if (!bytes || bytes.length < 2) return bytes
  const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b
  if (!gzipped) return bytes
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot decompress .gz reports. Chrome, Edge, Firefox and Safari 16.4+ can.')
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

const text = (el, tag) => {
  const found = el?.getElementsByTagName(tag)?.[0]
  return found ? found.textContent.trim() : ''
}

/**
 * Parse one aggregate report.
 *
 * Shapes vary by reporter: Google sends what you expect, Microsoft puts extra nesting
 * in, and some senders omit policy_evaluated entirely. Missing fields become empty
 * strings rather than throwing, so one odd report cannot hide the rest.
 */
export function parseDmarcReport(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) {
    throw new Error('not valid XML')
  }
  const meta = doc.getElementsByTagName('report_metadata')[0]
  const published = doc.getElementsByTagName('policy_published')[0]
  const range = meta?.getElementsByTagName('date_range')?.[0]

  const records = [...doc.getElementsByTagName('record')].map((rec) => {
    const row = rec.getElementsByTagName('row')[0]
    const evaluated = row?.getElementsByTagName('policy_evaluated')?.[0]
    const ids = rec.getElementsByTagName('identifiers')[0]
    // auth_results carries the raw SPF/DKIM verdicts; policy_evaluated carries the
    // *aligned* ones, which is what DMARC actually judges.
    const dkimAuth = rec.getElementsByTagName('auth_results')?.[0]?.getElementsByTagName('dkim')?.[0]
    const spfAuth = rec.getElementsByTagName('auth_results')?.[0]?.getElementsByTagName('spf')?.[0]
    return {
      sourceIp: text(row, 'source_ip'),
      count: Number(text(row, 'count') || '0'),
      disposition: text(evaluated, 'disposition') || 'none',
      dkim: text(evaluated, 'dkim'),
      spf: text(evaluated, 'spf'),
      headerFrom: text(ids, 'header_from'),
      dkimDomain: text(dkimAuth, 'domain'),
      dkimResult: text(dkimAuth, 'result'),
      spfDomain: text(spfAuth, 'domain'),
      spfResult: text(spfAuth, 'result'),
    }
  })

  return {
    org: text(meta, 'org_name') || 'unknown reporter',
    reportId: text(meta, 'report_id'),
    domain: text(published, 'domain'),
    policy: text(published, 'p'),
    begin: Number(text(range, 'begin') || '0'),
    end: Number(text(range, 'end') || '0'),
    records,
  }
}

const passes = (r) => {
  // DMARC passes when either mechanism is aligned and passes.
  const dkim = (r.dkim || r.dkimResult || '').toLowerCase() === 'pass'
  const spf = (r.spf || r.spfResult || '').toLowerCase() === 'pass'
  return { dkim, spf, ok: dkim || spf }
}

/** Fold many reports into the two numbers a person cares about. */
export function summarise(reports) {
  const bySource = new Map()
  let messages = 0
  let passed = 0
  let failed = 0
  let first = null
  let last = null

  for (const report of reports) {
    if (report.begin) first = first === null ? report.begin : Math.min(first, report.begin)
    if (report.end) last = last === null ? report.end : Math.max(last, report.end)
    for (const r of report.records) {
      const p = passes(r)
      messages += r.count
      if (p.ok) passed += r.count
      else failed += r.count
      const key = `${r.sourceIp}|${r.headerFrom}|${report.org}`
      const entry = bySource.get(key) || {
        sourceIp: r.sourceIp,
        headerFrom: r.headerFrom,
        reporter: report.org,
        count: 0,
        failed: 0,
        dkim: r.dkim || r.dkimResult || '',
        spf: r.spf || r.spfResult || '',
        disposition: r.disposition,
      }
      entry.count += r.count
      if (!p.ok) entry.failed += r.count
      bySource.set(key, entry)
    }
  }

  const sources = [...bySource.values()].sort((a, b) => b.failed - a.failed || b.count - a.count)
  return {
    reports: reports.length,
    messages,
    passed,
    failed,
    first,
    last,
    sources,
    failures: sources.filter((s) => s.failed > 0),
  }
}
