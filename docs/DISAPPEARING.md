# Disappearing messages

Status: **implemented** (server + web client), deployed 2026-10-28.

A sender can mark a message so the recipient's copy is deleted by the server —
either the moment it is opened, or after a timer, or both.

## What the server guarantees

The recipient's stored copy is removed from the disk and from every index that
pointed at it (their `emailIds` and group membership). After that, the message is
gone: a second open is a 404, and the row disappears from their mailbox on the
next fetch.

## What it does not guarantee

It cannot unsee the message. The reader has the plaintext in memory, can screenshot
it, or can copy it out. The promise is "this server no longer holds it", not
"nobody has it". The UI says so in those words.

Two further limits, both by design:

- **Only mailboxes on this server.** Another provider's copy is theirs; `ephemeral`
  is ignored for external recipients.
- **The sender's own copy stays** in Sent. Deleting it would destroy their record
  of what they wrote; instead they get a receipt ("Read by bob on … — their copy
  was deleted").

## Enforcement, not a request

The first design (see `SCHEDULED-AND-EXPIRING.md`) had the recipient's client call
`POST /email/opened` and asked the server to trust that. That is a request, not a
rule — any client could skip it.

What shipped instead:

- **`/email/bulk` never returns the body** of a message that deletes on read:
  `data` is empty and `message_key` is null. Previews still list it, labelled
  "Disappearing message" from the plaintext envelope (`from`), so the message is
  visible without being consumable.
- **`/email/get` deletes before it answers.** Blob, index entry, group membership —
  then the body is returned with `deleted: true`.
- **If the delete fails, the answer is `deleted: false`.** The message stays put and
  the reader is told the copy is still on the server. Claiming otherwise is the one
  lie this feature must never tell.
- **Timers are swept** by a thread in `main.rs` every 60 s, so unread messages also
  go. A message whose blob vanished another way is dropped from the queue instead of
  being re-deleted forever.

## Data

Sidecar `data/ephemeral.json` — never a field on `struct Email`, whose blob is
bincode and positional:

```json
{
  "entries": {
    "<recipient uid>": {
      "uid": 123,
      "owner": "bob",
      "owner_uid": 7,
      "sender": "alice@slothlee.xyz",
      "sender_uid": 456,
      "deletes_on_read": true,
      "expires_at": null,
      "created_at": 1793150000
    }
  },
  "receipts": {
    "<sender uid>": { "read_at": 1793151895, "recipient": "bob", "sender_uid": 456 }
  }
}
```

Receipts live 30 days. The file is in the off-site backup tar list: a restore
without it leaves messages on disk that were promised to delete themselves.

A damaged file reads as empty — messages stay. For a privacy feature that is the
safe direction: a lost queue can only fail to delete, never delete by accident.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/email/sendencrypted` | `ephemeral: { deletes_on_read }` and/or `{ expires_in_seconds }` |
| POST | `/api/email/ephemeral` | state of given uids from either side (`armed` / `read`) |

`expires_in_seconds` is clamped to 60 s – 90 days: a timer shorter than the next
fetch is an accidental deletion, not a feature.

If the rule cannot be recorded when the message is delivered, the delivery is
**rolled back** and reported as failed. A message that arrived under a promise the
server cannot keep is worse than one that never arrived.

## Client

- **Compose** — one control next to Send: `Keeps` / `Deletes after reading` /
  `Deletes in 1 hour` / `1 day` / `7 days`. Disabled while sending.
- **Recipient** — the row reads "Disappearing message / Deletes when you open it";
  opening shows the body plus a strip: "This message was deleted from the server as
  it opened. There is no copy left to reopen." The row leaves the list immediately;
  the open message stays on screen, because that is the last time it can be read.
- **Sender** — opening the sent copy shows "Read by bob on <time> — their copy was
  deleted. This is your sent copy", or "Waiting: it deletes when bob opens it".

## Tests

- 5 unit tests on the store (round trip, read→receipt, idempotent removal, damaged
  file, bounds).
- `proof-ephemeral.py` (25 checks, live server): withhold, open+delete, 404 on
  reopen, row gone, receipt to sender, sender copy intact, timer deletion without a
  read, ordinary mail untouched.
- Browser proof as two real accounts: compose → recipient's inbox label → open →
  strip → inbox empty after reload → sender's receipt.
