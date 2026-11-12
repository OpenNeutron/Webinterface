import { useState } from 'react'
import { ShieldCheck, ShieldAlert, ScanLine } from 'lucide-react'
import api from '@/api'
import { storage } from '@/storage'
import { keySession } from '@/keySession'
import { parseEmail } from '@/emailParser'
import { decryptStored } from '@/lib/decryptStored'
import { looksLikeDmarcReport, looksLikeDmarcAttachment, maybeGunzip, parseDmarcReport, summarise } from '@/lib/dmarc'

const SCAN_LIMIT = 60      // recent messages looked at
const REPORT_LIMIT = 40     // reports actually parsed, to keep a phone happy

const day = (unix) => (unix ? new Date(unix * 1000).toLocaleDateString() : '—')

/**
 * Read the DMARC aggregate reports sitting in this mailbox.
 *
 * The server can never parse these — it cannot read mail here — so the work happens in
 * the tab: list recent messages, find the report-looking ones, decrypt them with the key
 * already unlocked for reading, pull the XML out of the attachments and add them up.
 * Nothing is uploaded, and nothing is kept after the tab closes.
 */
export default function DmarcSection() {
  const [phase, setPhase] = useState('idle') // idle | scanning | done
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  const scan = async () => {
    setPhase('scanning')
    setError('')
    setNote('')
    setSummary(null)
    // Declared outside the try so the catch can name the step it died on.
    let step = 'read your message list'
    try {
      const token = storage.getToken()
      const auth = { headers: { Authorization: `Bearer ${token}` } }
      const privateKey = await keySession.get()
      if (!privateKey) throw new Error('Your key is locked. Sign out and back in, then try again.')

      const recent = await api.post('/email/recent', JSON.stringify({ offset: 0, limit: SCAN_LIMIT }), auth)
      const uids = recent.data?.uids || []
      if (uids.length === 0) {
        setSummary(summarise([]))
        setPhase('done')
        return
      }

      // There is no cheap subject filter: the list endpoint returns uids and ciphertext
      // only, so a report is not identifiable until it is decrypted. Walk the recent
      // messages newest-first and stop once enough reports are in hand.
      const reports = []
      const problems = []
      for (let i = 0; i < uids.length && reports.length < REPORT_LIMIT; i += 1) {
        const uid = uids[i]
        step = `open message ${i + 1} of ${uids.length}`
        if (i % 10 === 0) setNote(`Reading your messages — ${i + 1} of ${uids.length}…`)
        try {
          const got = await api.post('/email/get', JSON.stringify({ uid }), auth)
          const raw = await decryptStored(got.data.data, got.data.message_key, privateKey)
          const parsed = parseEmail(raw)
          if (!looksLikeDmarcReport(parsed.subject || '')) continue
          const attachment = (parsed.attachments || []).find((a) => looksLikeDmarcAttachment(a.name, a.contentType))
          if (!attachment) { problems.push(`${uid}: no XML attachment`); continue }
          const xml = new TextDecoder().decode(await maybeGunzip(attachment.data))
          reports.push(parseDmarcReport(xml))
        } catch (err) {
          problems.push(`${uid}: ${err.message}`)
        }
      }

      if (reports.length === 0) {
        setSummary(summarise([]))
        setNote(`Read your ${uids.length} most recent messages and found no DMARC reports. Reporters send one a day at most, and only because your DMARC record has a rua= address.`)
        setPhase('done')
        return
      }

      setSummary(summarise(reports))
      setNote(problems.length ? `${problems.length} report(s) could not be read: ${problems.slice(0, 3).join('; ')}` : '')
      setPhase('done')
    } catch (err) {
      // Name the step: "Invalid JSON" with no context is a dead end for whoever reads it.
      console.error('[dmarc] failed at', step, err?.response?.status, err?.message)
      setError(`Could not ${step}: ${err?.response?.data?.error || err.message || 'unknown error'}`)
      setPhase('idle')
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-secondary/60 p-4">
        <div className="flex items-start gap-3">
          <ScanLine className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
          <div className="min-w-0">
            <p className="text-[13px] leading-relaxed text-ink-2">
              Receivers that check your domain send a report saying how your mail authenticated
              and who else tried to send as you. This reads the ones already in your mailbox.
            </p>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-3">
              It runs here in the browser, on mail this device has already decrypted. Nothing is
              uploaded, and the server never sees these reports.
            </p>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={scan}
        disabled={phase === 'scanning'}
        className="flex h-11 items-center gap-2 rounded-md bg-secondary/60 px-4 text-[13px] font-medium text-ink-1 transition-colors duration-120 hover:bg-secondary disabled:opacity-60"
        data-testid="dmarc-scan"
      >
        <ScanLine className="h-4 w-4" />
        {phase === 'scanning' ? 'Reading reports…' : 'Scan mailbox for reports'}
      </button>

      {error && <p className="text-[12.5px] leading-relaxed text-destructive">{error}</p>}
      {note && <p className="text-[12px] leading-relaxed text-ink-3">{note}</p>}

      {summary && phase === 'done' && (
        <div className="space-y-3" data-testid="dmarc-summary">
          {summary.reports === 0 ? (
            <p className="text-[12.5px] text-ink-3">No DMARC reports found yet.</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-secondary/60 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-ink-3">Reports</p>
                  <p className="mono text-[18px] text-ink-1" data-testid="dmarc-reports">{summary.reports}</p>
                </div>
                <div className="rounded-lg bg-secondary/60 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-ink-3">Passed</p>
                  <p className="mono text-[18px] text-primary" data-testid="dmarc-passed">{summary.passed}</p>
                </div>
                <div className="rounded-lg bg-secondary/60 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-ink-3">Failed</p>
                  <p className={`mono text-[18px] ${summary.failed ? 'text-destructive' : 'text-ink-1'}`} data-testid="dmarc-failed">{summary.failed}</p>
                </div>
              </div>

              <p className="text-[12px] text-ink-3">
                {summary.messages} message{summary.messages === 1 ? '' : 's'} reported, {day(summary.first)} to {day(summary.last)}.
              </p>

              {summary.failures.length > 0 ? (
                <div className="rounded-lg bg-destructive/10 p-4" data-testid="dmarc-failures">
                  <div className="flex items-start gap-2">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-destructive">Mail that failed DMARC</p>
                      <ul className="mt-2 space-y-1">
                        {summary.failures.slice(0, 8).map((s) => (
                          <li key={`${s.sourceIp}-${s.headerFrom}`} className="text-[12px] leading-relaxed text-ink-2">
                            <span className="mono">{s.sourceIp}</span> · {s.count} message{s.count === 1 ? '' : 's'} · from {s.headerFrom || 'unknown'} · reported by {s.reporter}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
                        Someone else may be sending as you, or one of your own senders is misconfigured.
                        Your policy is reject, so receivers dropped these — this is what would otherwise be invisible.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-lg bg-secondary/60 p-4" data-testid="dmarc-clean">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <p className="text-[12.5px] leading-relaxed text-ink-2">
                    Every reported message passed DMARC. Nobody is sending as your domain and failing.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
