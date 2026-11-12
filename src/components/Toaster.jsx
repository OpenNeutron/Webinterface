import { useEffect, useState } from 'react'
import { subscribeToasts, dismissToast } from '@/lib/toast'

/**
 * Bottom centre, above the safe area, one line each. Nothing here is a dialog:
 * a toast is for something that already worked. The one exception is Undo: the
 * action already happened, and the button takes it back.
 */
export default function Toaster() {
  const [items, setItems] = useState([])
  useEffect(() => subscribeToasts(setItems), [])

  if (items.length === 0) return null

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 px-4"
      style={{ paddingBottom: 'calc(16px + env(safe-area-inset-bottom))' }}
      role="status"
      aria-live="polite"
    >
      {items.map((item) => (
        <div
          key={item.id}
          className="toast-in pointer-events-auto flex max-w-[92vw] items-center gap-1 rounded-lg border border-line-strong bg-card/95 py-1 pl-3.5 pr-1 text-[12.5px] text-ink-1 shadow-[0_10px_30px_rgba(0,0,0,.45)] backdrop-blur-sm sm:max-w-md"
        >
          <button type="button" onClick={() => dismissToast(item.id)} className="min-h-8 flex-1 py-1 pr-2 text-left">
            {item.message}
          </button>
          {item.action && (
            <button
              type="button"
              onClick={() => { dismissToast(item.id); item.action.run() }}
              className="min-h-8 shrink-0 rounded-md px-2.5 font-medium text-primary transition-colors duration-120 hover:bg-primary/10 max-sm:min-h-11"
            >
              {item.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
