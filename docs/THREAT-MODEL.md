# Threat model

Written to be argued with. Anything not listed as in scope should be assumed
out of scope until it appears here.

## Assets

1. **Message content** — bodies, subjects, attachment names and bytes.
2. **Private keys** — the RSA-OAEP key that opens a mailbox; the recovery-key
   secret that unwraps it.
3. **Credentials** — the password and the auth token derived from it.
4. **Account existence and metadata** — who has a mailbox, who writes to whom,
   when, message sizes, session networks.
5. **Domain reputation** — deliverability of `slothlee.xyz`.

## Adversaries

| # | Adversary | Capability | Goal |
|---|---|---|---|
| A1 | Network attacker | Sees and can modify traffic | Read or alter mail |
| A2 | Server operator (honest-but-curious) | Full read of stored data and logs | Read mail content |
| A3 | Server compromise | Code execution on the host, may modify the client bundle | Read mail, harvest passwords |
| A4 | Database theft | Copies `users.bin`, blobs, sidecars, backups | Offline cracking, content recovery |
| A5 | Other user | Authenticated account | Read another mailbox |
| A6 | Spammer / abuser | Can register and send | Burn domain reputation |
| A7 | Device thief | Physical access to an unlocked or locked device | Read mail |

## Trust boundaries

- **Browser ↔ server.** Content crosses this boundary only as ciphertext.
  Credentials cross as `bcrypt(password)`; keys never cross unwrapped.
- **Server ↔ storage.** Everything at rest is ciphertext, except metadata and
  sidecars (sessions, 2FA secrets, recovery blobs, waitlist).
- **Server ↔ SMTP edge.** Mail from external senders arrives **plaintext** and
  is encrypted after acceptance. This is the one place content is visible to
  the server, and it is unavoidable without refusing non-E2EE mail.
- **Client delivery.** The server provides the JavaScript that performs all
  crypto. This is the weakest boundary in the system.

## In scope (mitigated, with the control named)

- A1: TLS 1.2+ on SMTP, MTA-STS `enforce`, HTTPS with HSTS; content encrypted
  before transmission.
- A2: content is ciphertext; the operator holds no key that unwraps it.
- A4: wrapped keys are useless without the password; auth tokens are bcrypt, and
  the OPAQUE migration removes even that.
- A5: per-account authorisation checked server-side; cross-account session
  revocation returns 404 and does nothing.
- A6: invite-only signup, proof of work, rate limits, 20/day send cap for the
  first 24 hours, 50 recipients per message.
- A7: keys live in session memory, not on disk; the recovery key exists so a
  lost device does not mean a lost mailbox.

## Out of scope (stated plainly)

- **A3 cannot be fully mitigated while the client is served same-origin.** A
  compromised server can serve a client that exfiltrates a password. Published
  hashes make tampering *detectable after the fact*, not prevented. A signed
  native client is the only real fix.
- **Metadata is not hidden.** A2 sees envelope, timing and size.
- **Plaintext inbound.** Mail from non-E2EE senders is visible at the edge.
- Compromised endpoints, keyloggers, malicious extensions.
- Denial of service against the host or network.
- Coercion of the operator; there is no warrant canary yet.
- Insider with root: they can read sidecars (2FA secrets, session metadata) and
  substitute the client.

## Assumptions that, if false, break the model

- The browser's WebCrypto and the vendored `hash-wasm`/`openpgp.js` behave as
  documented and are not backdoored.
- Users keep their recovery key somewhere the server cannot reach.
- DNS and certificate issuance for `slothlee.xyz` are not controlled by an
  attacker.
- Backups remain encrypted; the GitHub copy is private.

## Residual risks, ranked

1. Same-origin client delivery (A3) — architectural, needs a native client.
2. Offline cracking of `bcrypt(password)` from a database theft (A4) — fixed by
   OPAQUE.
3. Metadata disclosure (A2) — reduced by `/24` truncation and dormant signup
   maps; not eliminated.
4. Plaintext inbound from external senders — reduced by PGP/MIME interop.
5. Recovery-key loss — mitigated by the UI prompt, not by technology.
