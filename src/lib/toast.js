/**
 * A very small toast channel.
 *
 * Copying a link, withdrawing a note, saving a setting: these used to answer
 * with an inline label that changed for 1.5 seconds somewhere in the corner of
 * a panel, or with nothing at all. One channel, one place on screen, one
 * sentence — and it says what happened, not "Success".
 */
let items = []
let seq = 0
const listeners = new Set()

const emit = () => listeners.forEach((fn) => fn(items))

/**
 * @param {string} message
 * @param {{ duration?: number, action?: { label: string, run: () => void } }} [options]
 *   action: one button beside the message ("Undo"). A toast with an action stays longer,
 *   because it asks for a decision the person may want to make.
 */
export function toast(message, { duration, action } = {}) {
  const id = ++seq
  items = [...items, { id, message, action: action ?? null }]
  duration = duration ?? (action ? 6000 : 2800)
  emit()
  setTimeout(() => dismissToast(id), duration)
  return id
}

export function dismissToast(id) {
  items = items.filter((item) => item.id !== id)
  emit()
}

export function subscribeToasts(fn) {
  listeners.add(fn)
  fn(items)
  return () => listeners.delete(fn)
}

/** Clipboard writes fail quietly in an insecure context; say so instead. */
export async function copyWithToast(text, message = 'Copied') {
  try {
    await navigator.clipboard.writeText(text)
    toast(message)
    return true
  } catch {
    toast('Could not reach the clipboard — select the text and copy it by hand')
    return false
  }
}
