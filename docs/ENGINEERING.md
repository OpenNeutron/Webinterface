# How changes get made here (so the same mistake happens once)

Every rule below exists because it was broken once and cost real time or a real
message. None of this is theory.

## 1. Reproduce before fixing

**Rule:** no fix ships until the failure is observed — in a test that fails, a
browser that shows it, or a log line that names it.

**Why:** three separate wrong theories in one session (keyserver pin, guard, status
line) each "seemed obvious" and each made something worse. The one that worked,
local delivery, was found by reading the send path and confirmed by logs.

## 2. Classify the change, then meet its proof bar

| Class | Examples | Required evidence |
|---|---|---|
| Cosmetic | copy, spacing, labels | served hash matches build |
| Client logic | parser, state, UI flow | failing-first test + render test where state is involved |
| Crypto / format | envelopes, key wrap, MIME | round-trip test both directions + old-format still opens |
| Delivery core | send, store, SMTP, auth | compile + deploy + a real message through it, logged |
| Auth / sessions | tokens, 2FA, recovery | exercised through the real login path, never a minted token |

A change may not be reported as done above its class's bar. "The build succeeded" is
never evidence of behaviour.

## 3. Never let the app lie

- **No unauthenticated bytes rendered as content.** If it cannot be decrypted, say
  so. Ciphertext shown as text is indistinguishable from corruption and hides cause.
- **No silent fallback that changes security properties.** Plaintext instead of
  encryption, RSA instead of the hybrid, "no key found" instead of "wrong key".
- **No silent key changes.** Show both fingerprints; make the human choose.
- **Feedback renders where the action is.** A confirmation inside a closed panel is
  not a confirmation.

## 4. Deploy is a verified act

`npm test` → `npm run build` → copy → **served hash equals local hash** → marker
string present in the shipped bundle → service worker version bumped and grepped.
The service worker has silently served a stale bundle for five deploys before.

Keep the previous `dist` tarball and the previous server binary until the new one is
confirmed working.

## 5. Prove it where it runs

Unit tests missed a `ReferenceError` that blanked the whole mail pane, because the
data function was tested and the component was not. Any UI change needs a render
test; any delivery change needs a message through the real path.

**The harness that does not exist yet and should:** two dedicated test accounts, a
script that logs in as each, sends internal mail, and asserts what the recipient's
browser receives. Right now that verification depends on a human noticing — which
is how a garbled inbox survived several deploys.

## 6. Migrations are additive and reversible

- Version the format before changing what is written
- The reader must open every older version, forever
- Take a backup and prove the restore before touching stored data
- One message must be re-readable after the migration, or it is not done

## 7. One variable at a time

When a change fails, undo it before trying the next idea. Two changes in flight turn
one unknown into two.

## 8. Say what was verified and what was assumed

Every report separates "proved" from "believed". A shipped hash is proved. "Should
work" is not. If a test could not be run, say which one and why.

## 9. A piped build can lie about failing

`npm run build 2>&1 | grep "built"` returns grep's exit status, not the build's, so a
broken build silently ships the previous `dist` — and the deploy looks successful
because the old bundle is served. Always run the build as its own command, check its
exit code, and only then deploy. The served hash not changing after a change is the
tell: identical hash after an edit means the build did not happen.
