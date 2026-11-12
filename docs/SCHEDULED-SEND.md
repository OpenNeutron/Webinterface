# Scheduled send

Write a message now, have it go out later. The compose window has a clock beside
Send: pick a time from the short list (an hour, this evening, tomorrow morning,
Monday morning) or type one.

## What actually happens

The message is **built and encrypted before it is queued**, exactly as an
immediate send is. What the server holds is the finished request: the per-recipient
ciphertext, the encrypted local copy, the envelope. So a scheduled message is no
more readable to this server than one sent by hand — it is the same bytes, waiting.

- **It does not exist on the wire until its time.** No SMTP session, no envelope,
  nothing for a recipient's server to see early.
- **The sent copy appears when it goes out**, not when it was written. Until then
  the message is in the "Waiting to go out" strip above Sent, with the time.
- **You can take it back** from that strip, right up until the sweep that sends it
  (every thirty seconds). After that it is gone in the ordinary way.
- **Sending limits are counted when you queue it.** Queueing cannot be used to
  send more later than the account is allowed to send now.

Two shapes are stored: the plain finish-a-MIME-body path, released directly over
SMTP, and the encrypted request the app uses, which is replayed through the same
`/email/sendencrypted` endpoint at release. The second one matters: encryption,
the sent copy and the disappearing rule are all the endpoint's work, so a
scheduled message cannot drift from an immediate one.

## Editing one that is still waiting

A held message can be reopened and changed instead of cancelled and retyped — but
only on the device that composed it.

The server stores the message as the client built it, sealed. It has no plaintext to
give back, so the composer keeps a tagged copy in the local draft store, and the
pencil appears in the Sent strip only where that copy exists. On another device you
get Cancel, because an Edit button that opened an empty composer would be a lie.

An edit is the same request shape as a first scheduling, plus `replace_id`. The
server replaces the pending item **in place and keeps its id**, so nothing else has
to be re-pointed. Refusals:

- `409 not_editable` — already sent, already cancelled, or not yours. One answer for
  all three, so message ids cannot be probed.
- `400 replace_needs_time` — an edit with no time. Without this the request would
  fall through to the ordinary send path and deliver a *second* copy while the first
  stayed queued, which is the worst outcome available: the sender believes they
  corrected it once.
- A time in the past or more than a year out is refused exactly as on a first send.

## If a release fails

The message is marked failed, the reason is kept, and the strip in Sent shows it
("couldn't send — …"). The body is dropped either way: a failed message does not
sit on disk with its ciphertext intact.

## Limits, stated plainly

- **A deadline is not a promise about clocks.** Releases happen on a thirty-second
  sweep, so a message set for 09:00 leaves at 09:00 plus up to half a minute.
- **Held messages live on this server** until they go out. If the server is down at
  the deadline, they are released when it comes back — late, not lost.
- **The clock is the server's**, not the phone's. A device with the wrong time
  chooses the wrong moment.
- **Fifty waiting messages per account.** Beyond that the compose window says so
  rather than silently swallowing one.
