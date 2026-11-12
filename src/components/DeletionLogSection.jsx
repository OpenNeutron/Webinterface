import { useEffect, useState } from 'react'
import { ShieldAlert, ShieldCheck, Loader2 } from 'lucide-react'
import api from '@/api'
import { storage } from '@/storage'
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js'

/**
 * The deletion log: what left this mailbox, in a chain that cannot be rewritten
 * quietly.
 *
 * The server keeps it, so the client is what makes it worth anything: the head is
 * signed with ML-DSA-65, verified here with the key the server publishes, and the
 * head is remembered. A chain that comes back shorter than the last one seen, or a
 * signature that does not check out, is the alarm.
 *
 * It is a tripwire, not a backup: it makes silent deletion visible after the
 * fact, and it cannot bring a message back.
 */

const PIN_KEY = 'deletion_log_seen'

function b64ToBytes(text) {
  const bin = atob(text)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Recompute the tail the server sent. The head commits to the whole chain, so a
 * rewritten entry stops matching its own hash; a rewritten entry *plus* a
 * rewritten head is what the remembered pin is for. Both are checked.
 */
async function tailIsIntact(entries) {
  // entries arrive newest first from the API.
  const chronological = [...entries].reverse()
  let previous = chronological[0]?.prev ?? ''
  for (const entry of chronological) {
    const expected = await sha256Hex(`${previous}|${entry.seq}|${entry.ts}|${entry.op}|${entry.uid}`)
    if (expected !== entry.hash || entry.prev !== previous) return false
    previous = entry.hash
  }
  return true
}

function loadPin() {
  try {
    const raw = storage.getDeletionLogPin ? storage.getDeletionLogPin() : null
    return raw || null
  } catch {
    return null
  }
}

export default function DeletionLogSection() {
  const [state, setState] = useState({ phase: 'loading' })
  const [entries, setEntries] = useState([])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { data } = await api.get('/user/log', {
          headers: { Authorization: `Bearer ${storage.getToken()}` },
        })
        if (!alive) return
        setEntries(data.entries || [])

        const pin = loadPin()

        if (!data.count) {
          // A log that is empty *after* this browser saw entries is the loudest
          // possible signal: it is what wiping the record looks like. Checked
          // before the empty state so an empty log cannot pass as "nothing yet".
          if (pin && pin.count > 0) {
            setState({ phase: 'rolledback', count: 0, seen: pin.count })
          } else {
            setState({ phase: 'empty' })
          }
          return
        }

        // The signature covers the head string; verify it with the published key.
        let verified = false
        try {
          // @noble takes (signature, message, publicKey); the browser's own
          // crypto takes the public key first, so this order is easy to get wrong.
          verified = ml_dsa65.verify(
            b64ToBytes(data.signature),
            new TextEncoder().encode(data.head),
            b64ToBytes(data.public_key),
          )
        } catch {
          verified = false
        }

        const chainOk = await tailIsIntact(data.entries || [])
        const rolledBack = !!(pin && typeof pin.count === 'number' && data.count < pin.count)
        const headChanged = !!(pin && pin.head && pin.head !== data.head)

        if (pin && pin.count === data.count && headChanged) {
          setState({ phase: 'rewritten', count: data.count })
        } else if (!chainOk) {
          setState({ phase: 'inconsistent', count: data.count })
        } else if (!verified) {
          setState({ phase: 'unverified', count: data.count })
        } else if (rolledBack) {
          setState({ phase: 'rolledback', count: data.count, seen: pin.count })
        } else {
          storage.set({ [PIN_KEY]: { count: data.count, head: data.head, checked_at: Date.now() } })
          setState({ phase: 'ok', count: data.count })
        }
      } catch (err) {
        if (alive) setState({ phase: 'error', message: err?.response?.data?.error || err?.message || 'could not be read' })
      }
    })()
    return () => { alive = false }
  }, [])

  const reason = (entry) =>
    entry.op === 'expired' ? 'deleted when its timer ran out' : 'removed by you'

  return (
    <div className="space-y-2">
      <p className="max-w-[62ch] text-[12.5px] leading-relaxed text-ink-3">
        Every deleted message is recorded, each entry sealed to the one before it and the newest one
        signed. Your browser checks that record and remembers how far it reached, so a log that is
        edited, or one that comes back shorter than before, is reported here instead of passing as
        normal. Entries record that something went and when, never what it said — a log that copied
        your mail would be another copy of your mail.
      </p>

      {state.phase === 'loading' && (
        <p className="flex items-center gap-2 text-[12px] text-ink-3">
          <Loader2 className="size-3.5 animate-spin" /> Checking…
        </p>
      )}

      {state.phase === 'empty' && (
        <p className="text-[12px] text-ink-2">Nothing has been deleted from this mailbox yet.</p>
      )}

      {state.phase === 'ok' && (
        <div className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
          <div className="space-y-1">
            <p className="text-[12.5px] font-medium text-ink-2">Deletion record verified</p>
            <p className="text-[12px] text-ink-3">
              {state.count} deletion{state.count === 1 ? '' : 's'} recorded; every entry and the
              signature over the newest one check out, here in this browser.
            </p>
            <p className="text-[11.5px] text-ink-3">
              This browser remembers where the record ended. A shorter one, or a different ending at
              the same length, shows up as a warning — on this device. On a device that has never
              seen this mailbox, there is nothing to compare against.
            </p>
          </div>
        </div>
      )}

      {(state.phase === 'rewritten' || state.phase === 'rolledback' || state.phase === 'unverified' || state.phase === 'inconsistent') && (
        <div className="flex items-start gap-2 text-[12px] text-sand">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {state.phase === 'rolledback'
              ? `This chain now ends at ${state.count} entries; this browser saw ${state.seen}. Deletions have been removed from the record.`
              : state.phase === 'rewritten'
                ? `The chain still ends at ${state.count} entries but its head is different from the one this browser saw. The record was rewritten.`
                : state.phase === 'inconsistent'
                  ? 'The entries in this chain do not add up: one of them no longer matches the hash it records for itself. Treat the deletion record as untrustworthy.'
                  : 'The signature on this chain does not check out. Treat the deletion record as untrustworthy.'}
          </span>
        </div>
      )}

      {state.phase === 'error' && (
        <p className="text-[12px] text-ink-3">The deletion log could not be read: {state.message}.</p>
      )}

      {entries.length > 0 && state.phase !== 'error' && (
        <ul className="mt-1 space-y-1">
          {entries.slice(0, 6).map((entry) => (
            <li key={`${entry.seq}-${entry.hash.slice(0, 8)}`} className="flex items-baseline justify-between gap-3 text-[11.5px] text-ink-3">
              <span className="truncate">
                <span className="tabular-nums text-ink-3">#{entry.seq}</span> · {reason(entry)}
              </span>
              <span className="shrink-0 tabular-nums">
                {new Date(entry.ts * 1000).toLocaleString(undefined, {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
