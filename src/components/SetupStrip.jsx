import { useState } from 'react'
import { ChevronDown, ChevronRight, ShieldAlert } from 'lucide-react'

/**
 * Several setup gaps, one strip.
 *
 * These used to stack — a full banner per missing key — which pushed the mail
 * down and made two warnings compete. One line states the count, the expand says
 * what each one costs, and the row is sand because this is attention, not danger.
 */
export default function SetupStrip({ items, onOpen, onDismiss }) {
  const [open, setOpen] = useState(false)
  if (!items || items.length === 0) return null

  return (
    <div className="border-b border-line">
      <div className="mx-auto flex w-full max-w-[1040px] items-center gap-2 px-4 py-1.5 max-sm:min-h-[36px] max-sm:items-start max-sm:py-2">
        <ShieldAlert className="size-3.5 shrink-0 text-sand" aria-hidden="true" />

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 items-start gap-1.5 text-left text-[12px] text-ink-2 hover:text-ink-1 max-sm:min-h-11"
        >
          {open ? <ChevronDown className="mt-[3px] size-3.5 shrink-0 text-ink-3" /> : <ChevronRight className="mt-[3px] size-3.5 shrink-0 text-ink-3" />}
          <span className="truncate max-sm:line-clamp-2 max-sm:whitespace-normal">
            {items.length === 1 ? 'One thing not set up yet' : `${items.length} things not set up yet`}
            {/* Two names and a count, never a comma list clipped mid-word: the strip is
                one line on a phone, and "Recovery key, OpenPGP key,..." told the reader
                neither what the third thing was nor that there was a third thing. */}
            {/* On a phone there is room for the count only; two names plus "and 1 more"
                still ran to "…an…" at 390px, and a clipped word is worse than no names.
                The names are already one tap away in the expanded list. */}
            <span className="hidden text-ink-3 sm:inline">
              {' — '}
              {items.slice(0, 2).map((i) => i.label).join(', ')}
              {items.length > 2 ? ` and ${items.length - 2} more` : ''}
            </span>
          </span>
        </button>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onOpen(items[0]?.href)}
            className="rounded-md px-2 py-1 text-[11.5px] font-medium text-sand transition-colors duration-120 hover:bg-sand/10 max-sm:min-h-11 max-sm:px-2.5"
          >
            Set up
          </button>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="flex items-center justify-center rounded p-1 text-ink-3 transition-colors duration-120 hover:text-ink-1 max-sm:min-h-11 max-sm:min-w-11"
          >
            ×
          </button>
        </div>
      </div>

      {open && (
        <ul className="animate-rise space-y-1.5 px-4 pb-3 pl-10">
          {items.map((item) => (
            <li key={item.id} className="text-[12px] leading-relaxed text-ink-2">
              {item.href ? (
                // Each gap opens the section that fixes it: a strip that only
                // says "something is missing" makes the reader hunt for where.
                <a href={item.href} className="underline decoration-line-strong/60 underline-offset-2 hover:text-ink-1">
                  <span className="font-medium text-ink-1">{item.label}.</span>
                </a>
              ) : (
                <span className="font-medium text-ink-1">{item.label}.</span>
              )}{' '}
              {item.note}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
