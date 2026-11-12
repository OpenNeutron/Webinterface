/**
 * Conversation grouping.
 *
 * Two messages belong together when the mail headers say so: `References` and
 * `In-Reply-To` name the messages a reply descends from, and `Message-ID`
 * identifies the message itself. Header links are authoritative.
 *
 * When no headers connect two messages (some clients drop them, and our own
 * composer only started sending them recently), fall back to the subject plus
 * the people involved, within a window of time. That fallback is deliberately
 * conservative: the same subject from a different set of people, or months
 * apart, is two conversations, not one.
 */

const REPLY_PREFIX = /^\s*(?:(?:re|fw|fwd|aw|sv|vs|antwort|wg|tr)\s*(?:\[\d+\])?\s*:\s*)+/i

export function normalizeSubject(subject = '') {
  let value = String(subject || '')
  let previous
  do {
    previous = value
    value = value.replace(REPLY_PREFIX, '')
  } while (value !== previous)
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function idsFrom(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.flatMap(idsFrom)
  return String(value)
    .split(/[\s,]+/)
    .map((id) => id.trim().replace(/^<|>$/g, '').toLowerCase())
    .filter(Boolean)
}

function addressKey(from) {
  if (!from) return ''
  if (typeof from === 'string') return from.trim().toLowerCase()
  return String(from.address || from.email || from.name || '').trim().toLowerCase()
}

export function threadKeyOf(message) {
  const ids = idsFrom(message?.messageId)
  return ids[0] || null
}

/**
 * Group messages into conversations.
 *
 * @param {Array} messages each with { uid, messageId, inReplyTo, references, subject, date, from }
 * @param {{ windowDays?: number, unreadByUid?: Record<string, boolean> }} options
 * @returns {Array<{key, uids, subject, participants, latestUid, latestDate, count, unreadCount}>}
 *          ordered newest conversation first, messages inside each oldest first.
 */
export function buildThreads(messages = [], options = {}) {
  const windowMs = (options.windowDays ?? 30) * 24 * 60 * 60 * 1000
  const unreadByUid = options.unreadByUid || {}

  const items = messages.filter(Boolean).map((message, index) => ({
    index,
    uid: message.uid,
    messageId: idsFrom(message.messageId)[0] || null,
    parents: [...idsFrom(message.references), ...idsFrom(message.inReplyTo)],
    subject: message.subject || '',
    normalized: normalizeSubject(message.subject),
    from: addressKey(message.from),
    date: message.date instanceof Date ? message.date : new Date(message.date || 0),
  }))

  const parent = items.map((_, i) => i)
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  const union = (a, b) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }

  // 1. Header links: a message and any message it references share a thread.
  const byMessageId = new Map()
  items.forEach((item, i) => {
    if (item.messageId) byMessageId.set(item.messageId, i)
  })
  items.forEach((item, i) => {
    item.parents.forEach((id) => {
      const target = byMessageId.get(id)
      if (target !== undefined) union(i, target)
    })
  })

  // 2. Fallback: identical subject, overlapping participants, close in time.
  //    Grouped transitively, so a long exchange whose subjects drift still
  //    stays together through the links that do match.
  const bySubject = new Map()
  items.forEach((item, i) => {
    if (!item.normalized) return
    const bucket = bySubject.get(item.normalized) || []
    bucket.push(i)
    bySubject.set(item.normalized, bucket)
  })
  bySubject.forEach((bucket) => {
    for (let a = 0; a < bucket.length; a += 1) {
      for (let b = a + 1; b < bucket.length; b += 1) {
        const left = items[bucket[a]]
        const right = items[bucket[b]]
        const close = Math.abs(left.date - right.date) <= windowMs
        // Header-linked already? Then they are one thread regardless.
        const alreadyLinked = find(bucket[a]) === find(bucket[b])
        const samePeople = left.from && right.from && left.from === right.from
        if (alreadyLinked || (close && samePeople)) union(bucket[a], bucket[b])
      }
    }
  })

  const groups = new Map()
  items.forEach((item, i) => {
    const root = find(i)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(item)
  })

  const threads = [...groups.values()].map((group) => {
    const ordered = [...group].sort((a, b) => a.date - b.date || a.index - b.index)
    const latest = ordered[ordered.length - 1]
    const participants = [...new Set(ordered.map((m) => m.from).filter(Boolean))]
    return {
      // Stable across reloads: the id of the oldest message in the thread.
      key: ordered[0].messageId || `subject:${ordered[0].normalized}` || `uid:${ordered[0].uid}`,
      uids: ordered.map((m) => m.uid),
      subject: ordered[0].subject || '(no subject)',
      participants,
      latestUid: latest.uid,
      latestDate: latest.date,
      count: ordered.length,
      unreadCount: ordered.filter((m) => unreadByUid[m.uid]).length,
    }
  })

  threads.sort((a, b) => b.latestDate - a.latestDate)
  return threads
}
