# Zero knowledge: what it takes here

This is the working plan for making Sloth Lee Mail zero-knowledge, and for
getting that claim independently audited. It records what is already true, what
must change, and — most importantly — what the service is allowed to say at each
stage.

## Where we actually stand (measured, not assumed)

| Property | Status |
|---|---|
| Private key generated in the browser | yes |
| Server stores private key only as ciphertext | yes |
| Auth token (`bcrypt(password)`) cannot derive the wrap key | yes — the wrap key derives from the raw password, the server only ever sees the bcrypt token |
| Message subject / body / attachment names inside the ciphertext | yes — verified by canary: `CANARY-SUBJECT-…` appears in no blob and not in `users.bin` |
| Server-seeded recovery cannot decrypt old mail | yes — reset replaces the wrapping key |
| Per-wrap random IV | **fixed** — was derived from the password, so every re-wrap reused the GCM nonce |
| Client code is verifiable by the user | **no** — served by the same origin as the data |
| Password never reaches the server in an offline-crackable form | **no** — bcrypt(password) is a password-equivalent |
| Mail from external senders stays sealed | **no** — arrives as plaintext at the SMTP edge |
| Metadata minimised | **no** — IP per session, signup address map, device strings |

## The claim we may make today

> "Mail stored on this service is encrypted with keys we do not hold. We cannot
> read your mailbox, and we cannot recover your key."

We may **not** say "zero knowledge". The server ships the client, so it could
capture a password at login; metadata is visible; inbound external mail is
plaintext at arrival.

## Phase 0 — cryptographic correctness (days)

- [x] Random 12-byte IV per wrap, `SLW1` envelope, legacy blobs still open.
- [ ] Re-wrap every existing key once the client is deployed everywhere.
- [ ] Review AES-GCM usage elsewhere (`encryptEmail`, attachment encryption) for
      nonce reuse and missing AAD binding.
- [ ] Bind the envelope to its context with AAD (username + salt), so a blob
      cannot be replayed onto another account.
- [ ] Document KDF parameters (bcrypt cost 10, argon2id 3 iterations / 64 MiB)
      and raise them on a schedule.

## Phase 1 — a client the server cannot lie to (the real blocker)

Nothing else in this document matters without this. Options, cheapest first:

1. **Publish the source + reproducible build**, and serve the hashes from
   somewhere the mail server does not control (GitHub release, DNS TXT).
   - [x] Client source published: https://github.com/SirTibbles666one/Sloth-Lee-Mail
   - [ ] Reproducible build + published hashes per release
2. **Split the origins**: `app.slothlee.xyz` (static, no API) serves the client;
   `mail.slothlee.xyz` serves only the API. A mail-server compromise no longer
   implies client compromise.
3. **Ship a signed native client** (Tauri desktop, Android) that performs all
   crypto locally. This is the only configuration that supports the full claim.

## Phase 2 — authentication that is not a password-equivalent (weeks)

- Adopt a PAKE — OPAQUE or SRP-6a — so the server never receives anything an
  attacker can grind offline.
- Keep a separate passphrase (or recovery key) for key unwrapping, so even a
  server-side auth compromise yields no decryption.
- Keep the recovery key as the only recovery path that can restore access to
  existing mail.

## Phase 3 — sealed mail from outside senders (weeks)

- Implement PGP/MIME (`multipart/encrypted`) so external clients can encrypt
  end to end, and so ours interoperate.
- For plaintext inbound: encrypt at rest immediately, delete the plaintext
  buffer, and label those messages in the UI as "not end-to-end encrypted".
- Never claim end-to-end for mail that arrived in the clear.

## Phase 4 — metadata minimisation (weeks)

- Truncate stored IPs (e.g. /24, /48) and drop them on session expiry.
- Stop persisting user-agent strings; derive device labels at display time.
- Retain the signup address map only for an abuse window, then purge.
- Remove any conversation metadata the server does not strictly need.

## Phase 5 — audit readiness (weeks, then external)

Deliverables to have in hand before an auditor starts:

- [ ] Public source repository for client **and** server.
- [ ] `docs/THREAT-MODEL.md`: assets, adversaries, trust boundaries, out-of-scope.
- [ ] `docs/CRYPTO.md`: key hierarchy, KDF parameters, envelope formats, rotation.
- [ ] A written statement of what the server stores, field by field.
- [ ] Reproducible build instructions + published hashes per release.
- [ ] Automated tests for each crypto property (round-trip, nonce uniqueness,
      legacy compatibility, wrong-password failure, cross-account blob replay).

Scope a first review at **client crypto + key management + authentication**;
that is where the claim lives and where reviews are cheapest to run. Budget for
a remediation round — the first report always finds something.

## Acceptance tests that must pass before the claim changes

1. A modified client served by the server cannot exfiltrate keys undetected
   (hash check fails and the client refuses to run).
2. Two wraps of the same key never share an IV.
3. A blob from account A cannot be restored onto account B.
4. The server database alone yields no plaintext body, subject or filename.
5. An external auditor reproduces the build from source and matches the hash.

## Sequencing

```
Phase 0 (done: IV)  →  Phase 1 (client integrity)  →  Phase 2 (PAKE)
                    →  Phase 3 (PGP/MIME)  →  Phase 4 (metadata)  →  Phase 5 (audit)
```

Phase 1 is the gate. Until a user can verify the code running on their machine,
everything downstream is a promise rather than a property.
