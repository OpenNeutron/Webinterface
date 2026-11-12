import { useRef, useState } from 'react'
import { AlertTriangle, Check, FileUp, Loader2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { importMessage } from '@/api'
import { openArchive } from '@/lib/slotharc'
import { Input } from '@/components/ui/input'
import { toast } from '@/lib/toast'

/**
 * Bringing mail in, rather than only taking it out.
 *
 * Files are parsed here, in the browser, and sent one message at a time: a
 * 50 MB mbox never lands in one request, progress is real, and a message that
 * fails is reported by its subject instead of aborting the whole archive.
 *
 * Two details that decide whether this feels like a restore or like a mess:
 * the message's own `Date` is sent along (an archive that all arrives "today"
 * sorts wrongly), and the server remembers Message-IDs so a retried upload
 * does not double the mailbox.
 */

const MAX_PER_FILE = 5000

function bytesToBase64(bytes) {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** Latin-1 view of the bytes: one character per byte, so byte offsets survive. */
function bytesToLatin1(bytes) {
  let out = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return out
}

/**
 * Split an mbox into individual messages.
 *
 * The separator is a line starting with "From " that follows a blank line;
 * mboxrd escapes a body line that looks like one by prefixing ">", which is
 * undone here. A file that does not open with "From " is one message.
 */
function splitMessages(text) {
  const looksLikeMbox = /^From .+\r?\n/.test(text) && /\n\nFrom .+\r?\n/.test(text)
  if (!looksLikeMbox) return [text]

  const parts = []
  const lines = text.split(/\r?\n/)
  let current = []
  let started = false
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const isSeparator = /^From .+/.test(line) && (i === 0 || lines[i - 1] === '')
    if (isSeparator && started) {
      parts.push(current.join('\n'))
      current = []
    }
    if (isSeparator) {
      started = true
      continue
    }
    // Undo mboxrd quoting so the message we send is the message that was sent.
    current.push(line.startsWith('>From ') ? line.slice(1) : line)
  }
  if (current.length) parts.push(current.join('\n'))
  return parts.filter((part) => part.trim().length > 0)
}

function headerOf(text, name) {
  const head = text.split(/\r?\n\r?\n/)[0] || ''
  const match = new RegExp(`^${name}:\\s*(.*(?:\\r?\\n[ \\t].*)*)`, 'im').exec(head)
  return match ? match[1].replace(/\r?\n[ \t]+/g, ' ').trim() : ''
}

function dateOf(text) {
  const raw = headerOf(text, 'Date')
  if (!raw) return undefined
  const parsed = Date.parse(raw)
  if (Number.isNaN(parsed)) return undefined
  return Math.floor(parsed / 1000)
}

function subjectOf(text) {
  return headerOf(text, 'Subject') || '(no subject)'
}

export default function ImportSection() {
  const inputRef = useRef(null)
  const [running, setRunning] = useState(false)
  const [total, setTotal] = useState(0)
  const [done, setDone] = useState(0)
  const [imported, setImported] = useState(0)
  const [skipped, setSkipped] = useState(0)
  const [failures, setFailures] = useState([])
  const [summary, setSummary] = useState('')
  const [passphrase, setPassphrase] = useState('')

  const reset = () => {
    setTotal(0)
    setDone(0)
    setImported(0)
    setSkipped(0)
    setFailures([])
    setSummary('')
  }

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || [])
    if (!files.length || running) return
    reset()
    setRunning(true)

    let importedCount = 0
    let skippedCount = 0
    const problems = []
    let planned = 0

    try {
      // Read and split everything first so the progress bar has a real total
      // instead of guessing from file count.
      const jobs = []
      for (const file of files) {
        const buffer = new Uint8Array(await file.arrayBuffer())

        // A sealed archive is already framed message by message: open it, and the
        // plaintext stays in memory only for as long as the upload takes.
        if (/\.slotharc$/i.test(file.name)) {
          if (!passphrase) {
            problems.push({ name: file.name, reason: 'enter the archive passphrase, then choose the file again' })
            continue
          }
          const { messages, manifest } = await openArchive(buffer, passphrase)
          if (messages.length > MAX_PER_FILE) {
            problems.push({ name: file.name, reason: `more than ${MAX_PER_FILE} messages in one archive` })
            continue
          }
          for (const bytes of messages) {
            jobs.push({ file: `${file.name}${manifest?.created ? ` (${manifest.created.slice(0, 10)})` : ''}`, bytes, text: bytesToLatin1(bytes) })
          }
          continue
        }

        const text = bytesToLatin1(buffer)
        const parts = splitMessages(text)
        if (parts.length > MAX_PER_FILE) {
          problems.push({ name: file.name, reason: `more than ${MAX_PER_FILE} messages in one file` })
          continue
        }
        for (const part of parts) {
          const bytes = new Uint8Array(part.length)
          for (let j = 0; j < part.length; j += 1) bytes[j] = part.charCodeAt(j) & 0xff
          jobs.push({ file: file.name, bytes, text: part })
        }
      }
      planned = jobs.length
      setTotal(planned)

      for (let i = 0; i < jobs.length; i += 1) {
        const job = jobs[i]
        try {
          const result = await importMessage(bytesToBase64(job.bytes), dateOf(job.text))
          if (result?.skipped) skippedCount += 1
          else importedCount += 1
        } catch (err) {
          const reason = err?.response?.data?.error || err?.message || 'could not be imported'
          problems.push({ name: `${job.file} — ${subjectOf(job.text).slice(0, 48)}`, reason })
          // A missing key or a refused payload will fail for every message; stop
          // rather than hammering the server with the same error.
          if (err?.response?.status === 409 || err?.response?.status === 401) break
        }
        setDone(i + 1)
        setImported(importedCount)
        setSkipped(skippedCount)
      }
    } catch (err) {
      problems.push({ name: 'the upload', reason: err?.message || 'could not be read' })
    } finally {
      setFailures(problems)
      setRunning(false)
      setSummary(
        importedCount || skippedCount
          ? `Imported ${importedCount} message${importedCount === 1 ? '' : 's'}${
              skippedCount ? `, skipped ${skippedCount} already here` : ''
            }${problems.length ? `, ${problems.length} could not be read` : ''}.`
          : 'Nothing was imported.',
      )
      if (importedCount) toast(`${importedCount} message${importedCount === 1 ? '' : 's'} imported`)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const pct = total ? Math.round((done / total) * 100) : 0

  return (
    <div>
      <p className="max-w-[62ch] text-[12.5px] leading-relaxed text-ink-3">
        Files are read in this browser and each message is encrypted to your key on the way in, so
        imported mail is as private as delivered mail. The original date is kept, and a message
        already here is skipped rather than duplicated.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="Passphrase (only for .slotharc)"
          autoComplete="off"
          className="w-full max-w-[240px] max-sm:min-h-[44px]"
          aria-label="Passphrase for sealed archives"
        />
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".eml,.mbox,.txt,.slotharc,message/rfc822,application/mbox"
          className="sr-only"
          id="import-files"
          onChange={(e) => handleFiles(e.target.files)}
          disabled={running}
        />
        <Button
          onClick={() => inputRef.current?.click()}
          disabled={running}
          className="gap-2 max-sm:min-h-[44px]"
        >
          {running ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
          {running ? 'Importing…' : 'Choose files'}
        </Button>
        <span className="text-[11.5px] text-ink-4">
          .eml, .mbox, .slotharc or a folder of them · up to 20 MB each
        </span>
      </div>

      {running && (
        <div className="mt-4">
          <div className="flex items-baseline justify-between">
            <span className="label">Importing</span>
            <span className="mono text-[11px] text-ink-3">
              {done} / {total || '…'}
            </span>
          </div>
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-line/70">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200"
              style={{ width: `${total ? pct : 8}%` }}
            />
          </div>
        </div>
      )}

      {summary && !running && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-line bg-background/40 px-3 py-2">
          {failures.length ? (
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-sand" />
          ) : (
            <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />
          )}
          <div className="min-w-0">
            <p className="text-[12.5px] text-ink-1">{summary}</p>
            {failures.length > 0 && (
              <ul className="mt-1.5 space-y-1">
                {failures.slice(0, 6).map((failure, index) => (
                  <li key={index} className="text-[11.5px] leading-relaxed text-ink-3">
                    <span className="text-ink-2">{failure.name}</span> — {failure.reason}
                  </li>
                ))}
                {failures.length > 6 && (
                  <li className="text-[11.5px] text-ink-4">and {failures.length - 6} more</li>
                )}
              </ul>
            )}
          </div>
        </div>
      )}

      <p className="mt-4 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-ink-4">
        <FileUp className="mt-0.5 size-3 shrink-0" />
        Folders and mailboxes that another provider exports as .mbox work directly. Thunderbird,
        Apple Mail and most IMAP tools export in that format.
      </p>
    </div>
  )
}
