# Post-quantum readiness

## What is vulnerable today, exactly

Two public-key systems carry this service:

| Where | Primitive | Quantum status |
|---|---|---|
| At-rest mail encryption (`message_key`) | RSA-4096 OAEP | **Broken** by Shor |
| Internal send payloads | RSA-OAEP + AES-256-GCM | **Broken** by Shor (key wrap) |
| OpenPGP user keys | curve25519 (ECDH/EdDSA) | **Broken** by Shor |
| Symmetric layer | AES-256-GCM | Safe (Grover halves only) |
| Hashing / KDF | SHA-256, argon2id, bcrypt | Safe |

So the confidentiality of every message rests on RSA and curve25519 — both fall to a
sufficiently large quantum computer, and ciphertext captured today can be decrypted
later. That is the real deadline: not "when quantum arrives", but "what has already
been recorded".

## Target design

**Key establishment (the part that matters):** hybrid X25519 + ML-KEM-768
(FIPS 203). Hybrid means an attacker must break both; a flaw in the new scheme
does not weaken today's guarantee, and a quantum adversary still faces X25519
until ML-KEM is trusted.

**Signatures:** hybrid Ed25519 + ML-DSA-65 (FIPS 204) for OpenPGP-side identity,
if and when OpenPGP.js and interoperating clients support it. This is lower
priority than key establishment: a forged signature is bad, but a broken key
exchange leaks the mail itself.

**Symmetric:** unchanged. AES-256-GCM and SHA-256 remain the right choices.

## Phases

### Phase 1 — Crypto agility (no new algorithms)
Nothing can be swapped safely until the formats carry an algorithm identifier.
- Version the at-rest record: `{v: 2, kem: "x25519+mlkem768", aead: "aes-256-gcm"}`
- Version the send payload the same way, beside the existing packed envelope
- Reader dispatches on `kem`; unknown versions fail loudly, never fall back
- Keep the current RSA path readable forever (old mail must still open)

Starting here is deliberate: a migration that cannot be rolled back per-message is
not a migration, it is a bet.

### Phase 2 — PQ key material per account
- Generate an ML-KEM-768 keypair alongside the existing RSA key
- Publish both; keep the RSA public key for compatibility with old senders
- Store the PQ private key wrapped exactly like the RSA one (SLW1 envelope, argon2id)
- Users.bin is bincode: **do not add fields to `struct User`** — put PQ state in a
  sidecar (`data/pqkeys.json`) keyed by username

### Phase 3 — New sends use the hybrid, old mail keeps opening
- `sendencrypted` wraps the AES key with X25519+ML-KEM-768 when the recipient has PQ
  material, RSA otherwise
- Inbound stores whichever it receives; the reader unwraps by `kem`
- Log which path each message took, so the migration is measurable

### Phase 4 — Re-wrap what is stored
The stored `message_key` is what a quantum adversary would attack. Re-wrap it per
message with the hybrid KEM, without touching `raw_data`: decrypt is unnecessary,
the AES key is re-wrapped from the account's private key to the new KEM.
This is the phase that actually protects mail already in the mailbox.

### Phase 5 — OpenPGP side
- `@noble/post-quantum` (WASM/pure-JS ML-KEM) behind the existing pgp.js boundary
- Publish a hybrid OpenPGP key where clients support it; label clearly in the UI
  when a recipient's key is classical-only, because that mail is not future-proof
- Do not invent a "PQ OpenPGP" variant: use what interoperates, or wait

## Rules

- **No home-grown cryptography.** ML-KEM and ML-DSA come from a vetted
  implementation, never from a spec transcription.
- **Hybrid, never PQ-only.** A novel scheme with no track record must not be the
  only thing standing between an attacker and the mail.
- **Never silently downgrade.** If the hybrid fails, the message fails; it does not
  quietly fall back to RSA.
- **Old mail must keep opening.** Every phase is additive; nothing removes a
  decrypt path.
- **Measure it.** Count messages per `kem` so "we migrated" is a number, not a claim.

## Honest assessment

Phases 1–3 are a few days of focused work plus tests, mostly mechanical once the
formats carry versions. Phase 4 touches every stored message and needs a backup
taken first and a verified rollback. Phase 5 depends on what other mail clients
support and is the least controllable part.

The largest risk is not the maths — it is doing this fast enough that the ciphertext
already on disk is still worth protecting when the migration lands.
