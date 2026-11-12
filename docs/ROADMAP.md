# Roadmap, in the order things actually need doing

## Why this order

Verification first, because every delivery bug so far was found by a human noticing
a broken inbox rather than by a test. Then the crypto foundation, because a format
migration is the thing that cannot be done safely without tests. Polish last.

## 1. Prove internal delivery (in progress)
- `scripts/e2e-internal.py` — two real accounts, one real send, asserts the message
  was stored locally with its key attached
- Needs: credentials for two accounts in the environment, on a machine that can
  reach the server
- Done when: it exits 0, and it would have failed before the local-delivery fix

## 2. Post-quantum Phase 1 — crypto agility
- Version the at-rest record and the send payload: `{v, kem, aead}`
- Reader dispatches on `kem`; unknown versions fail loudly, never fall back
- Old messages keep opening, forever — additive only
- Done when: a v1 message written before the change still opens after it

## 3. Post-quantum Phases 2–3 — hybrid for new mail
- ML-KEM-768 keypair per account, in a sidecar (`users.bin` is bincode: never add
  fields to `struct User`)
- New sends wrap the AES key with X25519 + ML-KEM-768 when the recipient has PQ
  material; RSA otherwise; log which path each message took
- Done when: a new internal message reports `kem=x25519+mlkem768` and still decrypts

## 4. Post-quantum Phase 4 — re-wrap stored mail
- Re-wrap each stored `message_key` to the hybrid KEM without touching `raw_data`
- Requires a backup and a proven restore first
- Done when: a pre-migration message opens after its key is re-wrapped

## 5. Delivery correctness leftovers
- Per-mailbox WKD for `mastertibbles.co.uk`, so lookups resolve the right address
- Stop the keyserver publishing a stale key for `samsmith@` (owner action)
- Attachments inside the PGP/MIME envelope rather than inline armour

## 6. OpenPGP Phase 5 — one Encryption screen
- Fold keys, publish, backup, contacts, verification into one screen
- Only after a human has looked at the current panel; restructuring unread UI
  is guessing

## 7. Audit
- External review of the crypto design and the delivery path, with the threat model
  and the public source as inputs

## Standing rule
Nothing above is reported done without the evidence its change class requires
(see `ENGINEERING.md`).
