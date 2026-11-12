/**
 * Re-sealing mail that was stored before post-quantum protection existed.
 *
 * The work has to happen in the browser: the server holds no private key, so it
 * can see that a message is in the old envelope but cannot put it in the new one.
 * The loop here therefore does, per message, exactly what the reader does —
 * fetch, open, seal again — and the plaintext never leaves the machine.
 *
 * Two properties this is built around:
 *  - **Resumable.** Progress is whatever the server reports still pending, so
 *    stopping and starting again is safe and never re-does finished work.
 *  - **Fail-soft per message.** A single message that will not open is counted
 *    and skipped; it must never abort the run and strand the rest in a half state.
 *
 * `io` is injected so the same loop can be driven from a proof without a browser.
 */

const MAX_FAILURES = 5

export async function runReseal({ keys, io, onProgress = () => {}, shouldStop = () => false }) {
  const { rsaPublicKey, pqPublicKey, pqSecretKey, username, privateKey } = keys
  if (!rsaPublicKey || !pqPublicKey) {
    throw new Error('this session does not hold the account keys — sign out and back in, then try again')
  }

  let resealed = 0
  let failed = []
  let consecutiveFailures = 0

  for (;;) {
    if (shouldStop()) return { resealed, failed, stopped: true }

    const status = await io.status()
    if (!status?.enabled) throw new Error('post-quantum protection is not enabled')
    if (!status.uids || status.uids.length === 0) break

    onProgress({ done: status.sealed, total: status.total, resealed, failed: failed.length })

    for (const uid of status.uids) {
      if (shouldStop()) return { resealed, failed, stopped: true }
      try {
        const message = await io.fetchMessage(uid)
        // Already in the new envelope (another tab may have beaten us here).
        if (message.messageKey && isHybridEnvelopeB64(message.messageKey)) continue
        const bytes = await io.open(message)
        const sealed = await io.seal(bytes)
        await io.store(uid, sealed)
        // Counted only once the write is confirmed. A message written but reported
        // back as failed is picked up by the next run's envelope check, not lost.
        resealed += 1
        consecutiveFailures = 0
      } catch (err) {
        const reason = err?.response?.status === 401
          ? 'your session ended — sign in again and the run picks up where it stopped'
          : err?.message || String(err)
        failed.push({ uid, reason })
        consecutiveFailures += 1
        // Something systemic (no key, wrong key) fails for every message. Stop
        // rather than grind through a mailbox turning nothing into failures.
        if (consecutiveFailures >= MAX_FAILURES) {
          return { resealed, failed, stopped: true, error: failed[failed.length - 1].reason }
        }
      }
      onProgress({ done: status.sealed + resealed, total: status.total, resealed, failed: failed.length })
    }

    // The batch can contain only already-sealed messages; without this the loop
    // would fetch the same uids forever.
    if (status.uids.length > 0 && resealed === 0 && failed.length === 0) break
  }

  return { resealed, failed, stopped: false }
}

export function isHybridEnvelopeB64(messageKeyB64) {
  try {
    const bin = atob(messageKeyB64)
    return (
      bin.length > 6 &&
      bin.charCodeAt(0) === 0x53 && // S
      bin.charCodeAt(1) === 0x4c && // L
      bin.charCodeAt(2) === 0x51 && // Q
      bin.charCodeAt(3) === 0x01
    )
  } catch {
    return false
  }
}
