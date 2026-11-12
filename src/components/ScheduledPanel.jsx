import { useEffect, useState } from 'react'
import { Clock, Pencil, X, AlertCircle } from 'lucide-react'
import { listScheduled, cancelScheduled } from '@/api'

function whenLabel(seconds, now) {
  if (!seconds) return ''
  const date = new Date(seconds * 1000)
  const diff = seconds - now
  if (diff < 0) return 'sending'
  if (diff < 90) return 'in a moment'
  if (diff < 3600) return `in ${Math.round(diff / 60)} min`
  return date.toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

/**
 * Messages the server is holding, and the way to take one back.
 *
 * Shown above the list in Sent, because a scheduled message is not in Sent yet —
 * the point of the panel is that its absence from the list is not a mystery.
 */
export function ScheduledPanel({ onCount, onEdit, editableIds, onItems, onCancelled, version = 0 }) {
  const [items, setItems] = useState([])
  const [now, setNow] = useState(Math.floor(Date.now() / 1000))
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const data = await listScheduled()
      setItems(data.items ?? [])
      setNow(data.now ?? Math.floor(Date.now() / 1000))
      onCount?.((data.items ?? []).filter((i) => i.status === 'pending').length)
      onItems?.(data.items ?? [])
    } catch {
      // A missing panel is better than a panel that guesses.
    }
  }

  useEffect(() => {
    load()
    const timer = setInterval(load, 60000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version])

  const cancel = async (id) => {
    setBusy(id)
    setError('')
    try {
      await cancelScheduled(id)
      // The local copy is only useful while the message is waiting.
      onCancelled?.(id)
      await load()
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not take that back')
    } finally {
      setBusy('')
    }
  }

  const live = items.filter((i) => i.status === 'pending' || i.status === 'failed')
  if (live.length === 0) return null

  return (
    <div className="border-b border-border/60 bg-foreground/[0.02] px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground/70">
        <Clock className="w-3.5 h-3.5" />
        Waiting to go out
        <span className="text-foreground/45">· {live.length}</span>
      </div>
      <ul className="mt-1 space-y-1">
        {live.map((item) => (
          <li key={item.id} className="flex items-center gap-2 text-[11px]">
            {item.status === 'failed' ? (
              <AlertCircle className="w-3.5 h-3.5 shrink-0 text-destructive" />
            ) : (
              <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate">
              {item.subject || '(no subject)'}
              <span className="text-foreground/45"> · {item.to.join(', ')}</span>
            </span>
            <span className={item.status === 'failed' ? 'text-destructive shrink-0' : 'text-foreground/50 shrink-0'}>
              {item.status === 'failed' ? `couldn't send — ${item.error || 'unknown reason'}` : whenLabel(item.send_at, now)}
            </span>
            {item.status === 'pending' && (
              <>
                {/* Editing is only offered when this device still holds the plaintext:
                    the server keeps the sealed request and cannot hand it back, so a
                    button that opened an empty composer would be a lie. */}
                {editableIds?.has(item.id) && (
                  <button
                    type="button"
                    onClick={() => onEdit?.(item)}
                    disabled={busy === item.id}
                    title="Edit before it goes"
                    aria-label="Edit before it goes"
                    className="shrink-0 flex items-center justify-center h-11 w-11 md:h-7 md:w-7 text-foreground/50 hover:text-foreground disabled:opacity-40"
                  >
                    <Pencil className="w-4 h-4 md:w-3.5 md:h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => cancel(item.id)}
                  disabled={busy === item.id}
                  title="Take it back"
                  aria-label="Take it back"
                  className="shrink-0 flex items-center justify-center h-11 w-11 md:h-7 md:w-7 text-foreground/50 hover:text-destructive disabled:opacity-40"
                >
                  <X className="w-4 h-4 md:w-3.5 md:h-3.5" />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="mt-1 text-[11px] text-destructive">{error}</p>}
    </div>
  )
}

export default ScheduledPanel
