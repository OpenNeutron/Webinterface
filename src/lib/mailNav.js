/**
 * Small, pure rules for moving through the list — kept here so they can be tested without
 * rendering the app.
 */

/**
 * Which message to open after some are removed from the list: the first one below the last
 * removed row, else the nearest one above, else none. This is what a reader expects after
 * deleting the message in front of them: the next one, not an empty pane.
 *
 * @param {Array<string|number>} order the list as shown, top to bottom
 * @param {Array<string|number>} removed what just left it
 */
export function neighbourAfterRemoval(order, removed) {
  const gone = new Set(removed.map(String))
  const ids = order.map(String)
  const positions = ids.map((id, index) => (gone.has(id) ? index : -1)).filter((index) => index >= 0)
  if (!positions.length) return null
  const last = Math.max(...positions)
  for (let i = last + 1; i < ids.length; i += 1) if (!gone.has(ids[i])) return order[i]
  for (let i = Math.min(...positions) - 1; i >= 0; i -= 1) if (!gone.has(ids[i])) return order[i]
  return null
}

/** The next (step 1) or previous (step -1) message from the current one, or the first. */
export function stepThrough(order, current, step) {
  if (!order.length) return null
  const index = order.map(String).indexOf(String(current))
  if (index < 0) return order[step > 0 ? 0 : order.length - 1]
  const next = index + step
  return next >= 0 && next < order.length ? order[next] : order[index]
}

/** True when a key press belongs to a text field, not to the page. */
export function isTypingTarget(element) {
  if (!element) return false
  if (element.isContentEditable) return true
  return /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName ?? '')
}

/**
 * The list shortcut a key press means, or null.
 *   Delete or #  delete (to Trash; for good inside Trash, which asks)
 *   z            undo the last delete
 *   j / k        next / previous message
 * Never with Ctrl, Cmd or Alt (those belong to the browser), never while typing.
 */
export function listShortcut(event, activeElement) {
  if (event.ctrlKey || event.metaKey || event.altKey) return null
  if (isTypingTarget(activeElement)) return null
  if (event.key === 'Delete' || event.key === '#') return 'delete'
  if (event.key === 'z' || event.key === 'Z') return event.shiftKey ? null : 'undo'
  if (event.key === 'j') return 'next'
  if (event.key === 'k') return 'prev'
  return null
}
