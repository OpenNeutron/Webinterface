# Scheduled send, expiry, and burn-after-read

## Why one mechanism, not three

Send-at and expire-at are the same job: a timestamp acted on by the server. Build
the timer once and both fall out of it. Burn-after-read is different — it needs the
recipient's client to report an open — so it comes second.

## Data

Sidecar `data/scheduled.json` (never on `struct User`; `users.bin` is bincode):

```
{ "entries": { "<uid>": {
    "sender": "tibs",
    "send_at": 1793200000,          // when the timer dispatches it
    "expires_at": null,             // or a unix time; null = keep
    "recipients": ["a@x", "b@y"],   // envelope only, no plaintext
    "payload": { "<addr>": { "aes_encrypted": "...", "data_encrypted": "...", "e2ee": true } },
    "localcopy": { "...": "..." },
    "created_at": 1793190000,
    "cancelled": false
} } }
```

The payload is already encrypted for each recipient before it is queued. The server
schedules ciphertext it cannot read — this is the property that makes the feature
acceptable at all.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/email/scheduled/create` | queue a message; same body as `sendencrypted` plus `send_at`, `expires_at` |
| POST | `/api/email/scheduled/list` | sender's queued messages (uid, to, send_at, expires_at) |
| POST | `/api/email/scheduled/cancel` | mark `cancelled` — never delete, so the timer can log it |

## The timer

A single thread in `main.rs`, waking every 30 s:

1. For each entry with `send_at <= now` and `!cancelled` → dispatch through the same
   local-delivery path as a normal send, then set `sent_at` and keep the record for
   one hour for auditing.
2. For each stored message whose `expires_at <= now` → delete the blob and its
   `emailIds` entry.
3. Persist after each pass; a restart must not lose or duplicate work — the
   `sent_at` field is what makes a pass idempotent.

Missed windows: if the server was down when `send_at` passed, send immediately on
startup and log the lateness. Never silently drop.

## Client

- Compose gets "Send later" with a date/time picker; the message appears under
  **Scheduled** with a countdown and a cancel button
- An unlocked PGP key is not needed at send time — it is needed at *queue* time,
  because encryption happens before the payload is stored. Say so in the UI
- Expiry is set per message: off, 1 day, 7 days, 30 days

## Burn after read (implemented — see DISAPPEARING.md)

Built differently from the sketch below, which asked the recipient's client to
report an open (`POST /email/opened`) and trusted it. That is a request, not a rule.
The shipped design withholds the body from the preview path and deletes inside
`POST /email/get`, so a client cannot read a message without consuming it. Details,
data shape and limits: `DISAPPEARING.md`.

The sketch is kept for the reasoning: an "opened" report has to handle the case
where the delete fails, and must never mark a message deleted until the blob is
gone. That part survived — the response reports `deleted: false` in exactly that
case.

## Honesty rules

- **"Auto-deletes after N days"**, never "self-destructs". A recipient can screenshot;
  what the server guarantees is that *it* no longer holds a copy
- Expiry and burn are enforced server-side from stored timestamps — a client asking
  nicely is not enforcement
- The scheduling server reads ciphertext only; if a future change needs plaintext at
  send time, the feature is wrong, not the crypto
- A scheduled message that fails to send must notify the sender, not vanish

## Tests

- Schedule +2 minutes, confirm arrival and that the log line names local delivery
- Cancel before send_at, confirm nothing is delivered
- Expire a message, confirm the blob is gone and the list no longer returns it
- Restart the server mid-window, confirm no duplicate and no loss
