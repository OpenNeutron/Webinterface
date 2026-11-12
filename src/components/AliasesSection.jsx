import { useEffect, useState } from 'react'
import { Copy, Check, Plus, Trash2, Power } from 'lucide-react'
import { listAliases, createAlias, setAliasDisabled, deleteAlias } from '@/api'
import { copyWithToast } from '@/lib/toast'

/**
 * Addresses you can hand out and then kill.
 *
 * The point is not extra inboxes — it is one inbox you never have to hand to
 * anyone you do not trust. An address that starts getting spam is switched off
 * and the mail to it is refused, while everything already delivered stays here.
 */
export function AliasesSection() {
  const [rows, setRows] = useState([])
  const [limit, setLimit] = useState(10)
  const [want, setWant] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [made, setMade] = useState('')
  const [copied, setCopied] = useState('')

  const refresh = async () => {
    try {
      const data = await listAliases()
      setRows(data.aliases ?? [])
      setLimit(data.limit ?? 10)
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not load your addresses')
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const copy = async (address) => {
    const ok = await copyWithToast(address, `${address} copied`)
    if (ok) {
      // A failed copy left a red line in this card; a good one has to clear it,
      // or the page says both "could not copy" and "copied" at once.
      setError('')
      setCopied(address)
      setTimeout(() => setCopied(''), 2000)
    } else {
      setError('Could not copy — long-press the address instead')
    }
  }

  const make = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setMade('')
    try {
      const res = await createAlias({ local: want.trim(), label: label.trim() })
      setMade(res.address)
      setWant('')
      setLabel('')
      await refresh()
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not create that address')
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (row) => {
    setBusy(true)
    setError('')
    try {
      await setAliasDisabled(row.local, !row.disabled_at)
      await refresh()
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not change that address')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (row) => {
    if (!window.confirm(`Delete ${row.address}? Mail to it will bounce.`)) return
    setBusy(true)
    setError('')
    try {
      await deleteAlias(row.local)
      await refresh()
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not delete that address')
    } finally {
      setBusy(false)
    }
  }

  const active = rows.filter((r) => !r.disabled_at).length

  return (
    <section className="mt-4 rounded-xl bg-secondary/60 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Addresses</h3>
        <span className="text-[11px] text-ink-3">
          {rows.length}/{limit}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-ink-2">
        Hand out one of these instead of your real address. Mail arrives here as usual; switching it off makes
        senders bounce, and everything already delivered stays.
      </p>

      {made && rows.some((r) => r.address === made) && (
        <div className="mt-2 rounded-lg border border-primary/30 bg-primary/[0.06] p-2">
          <p className="text-[11px] text-ink-2">Ready to use:</p>
          <div className="mt-1 flex items-center gap-2">
            <code className="text-xs font-mono break-all">{made}</code>
            <button type="button" onClick={() => copy(made)} className="text-primary" title="Copy">
              {copied === made ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      )}

      <form onSubmit={make} className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={want}
          onChange={(e) => setWant(e.target.value)}
          placeholder="name (optional)"
          className="min-w-0 flex-1 rounded-lg border border-line bg-transparent px-2 py-1.5 text-xs"
        />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="what it's for"
          className="min-w-0 flex-1 rounded-lg border border-line bg-transparent px-2 py-1.5 text-xs"
        />
        <button
          type="submit"
          disabled={busy}
          className="flex items-center gap-1 rounded-lg bg-primary/15 px-2 py-1.5 text-xs font-medium text-primary disabled:opacity-50"
        >
          <Plus className="w-3.5 h-3.5" />
          New address
        </button>
      </form>

      {rows.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {rows.map((row) => (
            <li
              key={row.local}
              className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-line/70 px-2 py-1.5 ${
                row.disabled_at ? 'opacity-55' : ''
              }`}
            >
              <code className="text-[11px] font-mono break-all">{row.address}</code>
              {row.label && <span className="text-[11px] text-ink-3">· {row.label}</span>}
              <span className="text-[11px] text-ink-3">
                · {row.received} {row.received === 1 ? 'message' : 'messages'}
              </span>
              {row.disabled_at && <span className="text-[11px] text-amber-600 dark:text-amber-400">off</span>}
              <span className="ml-auto flex items-center gap-2">
                <button type="button" onClick={() => copy(row.address)} className="text-ink-2" title="Copy">
                  {copied === row.address ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => toggle(row)}
                  disabled={busy}
                  className="text-ink-2 disabled:opacity-40"
                  title={row.disabled_at ? 'Switch back on' : 'Switch off'}
                >
                  <Power className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(row)}
                  disabled={busy}
                  className="text-destructive/80 disabled:opacity-40"
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-[11px] text-ink-3">
        {active === 0
          ? 'No address is currently accepting mail.'
          : `${active} address${active === 1 ? ' is' : 'es are'} accepting mail.`}{' '}
        Mail arrives here, and a reply to it leaves from the same address — nobody you write back to learns
        your real one. A new message you start yourself goes from your real address unless you pick this one
        in the From row while composing.
      </p>

      {error && <p className="mt-1 text-[11px] text-destructive">{error}</p>}
    </section>
  )
}

export default AliasesSection
