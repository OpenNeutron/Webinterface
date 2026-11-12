# Cryptography in Sloth Lee Mail

What is implemented today, and what changes when authentication moves to a PAKE.
Written to be read by an auditor and to be checked against the code.

## 1. Key hierarchy (implemented)

```
password ──bcrypt(salt="OpenNeutronAuth1")──► auth token  ──► sent to server (never stored plain)
    │
    └──bcrypt(salt=serverSalt)──► argon2id(3 it, 64 MiB, 32 B) ──► wrap key
                                                   │
                        RSA-OAEP-4096 private key ─┴─► AES-256-GCM ──► "SLW1"|IV|ct  (stored by server)
```

- The private key is generated in the browser and never leaves it unencrypted.
- The server stores the public key and the wrapped private key blob only.
- The wrap key derives from the **raw password**, not from the auth token, so the
  token the server receives is not the key.
- A password reset replaces the wrap key and therefore the private key: old mail
  becomes unreadable, which is the proof the server cannot recover it.
- Recovery keys wrap the *same* private key client-side; the server holds an
  opaque blob plus a one-way verifier hash.

### Envelope format

| version | layout | note |
|---|---|---|
| legacy | `ct` | IV derived from password + salt — **nonce reuse**, deprecated |
| v1 | `"SLW1" \| IV(12) \| ct` | random IV per wrap, current |

Legacy blobs still open; they are re-wrapped on next successful login.

## 2. Message encryption (implemented)

- `buildEmail()` assembles the full RFC822 message — headers, `Subject`, MIME
  parts, attachment filenames.
- That whole string is encrypted with the recipient's RSA public key before it
  leaves the browser. Verified by canary: a distinctive subject and body appear
  in no stored blob and not in `users.bin`.
- Attachments are encrypted as separate blobs with the same key material.
- OpenPGP is layered on top for interop (curve25519, `openpgp.js` 6.3.2).

## 3. What the server can still see

- envelope sender and recipients, timestamps, message sizes
- per-session IP and user-agent, and an address→username map from signup
- mail arriving from external senders **in plaintext** at the SMTP edge, before
  it is encrypted for storage

Content is sealed; metadata is not. Any claim must say so.

## 4. Phase 2 — moving authentication to OPAQUE

Today the server receives `bcrypt(password)`, an offline-crackable
password-equivalent: a database theft permits an untargeted cracking campaign.

OPAQUE (RFC 9807) removes that: the client proves knowledge of the password
through an oblivious exchange; the server stores an envelope it cannot invert.

### Registration

1. Client derives `randomized_password = KSF(password)` (argon2id, client-side).
2. OPAQUE registration request → server returns `RegistrationResponse`.
3. Client stores `RegistrationRecord` payload:
   `{client_public_key, masking_key, envelope, server_public_key, server_id}`.
4. Server stores `{credential_identifier = username, client_public_key,
   masking_key, envelope, server_private_key}`.

### Login

1. `KE1` (credential request) → server `KE2` (credential response + server MAC).
2. Client verifies the server MAC, recovers its export key, sends `KE3`.
3. Server verifies the client MAC, then issues the session JWT as today.

The export key becomes the **wrap key** for the private key, replacing the
password-derived wrap key. This is the point of the migration: the server can
never reconstruct it.

### Migration for existing accounts

Cannot be done server-side — the server has no password. Sequence:

1. Ship clients that speak both protocols; keep `bcrypt` login as fallback.
2. On each successful password login, the client runs OPAQUE registration in the
   same request, storing the OPAQUE record alongside the legacy hash.
3. Re-wrap the private key under the OPAQUE export key.
4. When all active accounts have an OPAQUE record (or a cutoff date passes),
   disable legacy login.

Accounts that never log in again keep working through password reset, which
already destroys their old key — acceptable and documented.

### Tests required before shipping

- OPAQUE registration → login round-trip against the Rust server.
- Wrong password fails with an indistinguishable error.
- A stolen server database yields no offline-verifiable password material.
- Wrapped key survives re-wrap: old mail still decrypts after migration.
- Legacy login still works during the transition window.

## 5. Non-goals

- Hiding metadata from the server operator.
- Sealing mail from external senders, which arrives plaintext at the edge.
- Protecting a user whose device is compromised.
