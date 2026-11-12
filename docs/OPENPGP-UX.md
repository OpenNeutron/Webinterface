# Making OpenPGP usable by people who have never used OpenPGP

The cryptography works. The problem is that the interface asks the user to make
decisions they have no basis for: which key, from where, and whether to trust
it. Every one of those decisions should either be made by the app or explained
in one sentence at the moment it matters.

## What is wrong today (observed, not theoretical)

1. **Silent wrong-key sends.** A keyserver key was pinned automatically and the
   message was sealed to a key its owner does not hold. The recipient saw armour
   and could never open it. Fixed by source-aware lookup, but the lesson stands:
   *never install a key the user did not ask for without saying so.*
2. **Three competing ways to get a key** — automatic lookup, paste-by-hand, and
   keys attached to incoming mail — with no visible order of preference. The
   user is left guessing which one applies.
3. **Feedback rendered where nobody can see it.** "Using the published key for
   x" appeared only inside a panel that is closed when the action is taken.
   Fixed; the general rule is *feedback must render wherever the button is.*
4. **No status for "what will happen if I press send".** The lock icon is the
   only signal, and it is small, low-contrast, and shows nothing about *which*
   key is in play.
5. **Recovery is invisible until it is needed.** Keys live in one browser. The
   backup now exists, but nothing prompts for it, so nobody has one until they
   have already lost the keys.

## Plan

### Phase 1 — Say what will happen (no new machinery) — DONE
- A single line above Send, always present, in plain words:
  `Encrypted to Sam (68D3…CF4A)` / `Not encrypted — no key for Sam` /
  `Encrypted to 2 of 3 recipients`.
- Tapping it opens the recipient list with a key state per address: *verified,
  from their message, published, none*.
- Remove the passphrase field from the default view; ask at send.

### Phase 2 — One path, ordered — DONE
- Present key sources as one ranked list with the app choosing:
  1. key from their own message (Autocrypt)
  2. key published by their domain (WKD)
  3. key published by them (keyserver) — offered, never auto-pinned
  4. paste by hand — last resort, hidden behind "advanced"
- Whenever 4 is needed, say why the first three failed, per address.

### Phase 3 — Make trust a first-class concept — DONE
- Each contact shows a state: *unverified* (imported automatically) or
  *verified* (you compared the fingerprint and confirmed).
- One action: "verify" → shows the fingerprint in large type with instructions
  to read it aloud to the person, and a confirm button.
- Conflicts (already implemented) stay a hard stop, never auto-resolved.

### Phase 4 — Make losing keys impossible to do by accident — DONE
- After first key creation, one prompt: "Save your key backup" with the
  download inline, dismissible but shown again after 7 days until done.
- Warn on the delete-account card and on browser-storage-clearing paths.

### Phase 5 — Reduce the surface for everyone else
- Default a new account to "encrypt when I can, tell me when I can't" with no
  jargon anywhere in the compose path.
- Move everything else — keys, publish, revocation, backup — into one
  "Encryption" screen with the guide at the top.

## Rules to hold to
- Never silently change the key for an address.
- Never encrypt to a key whose source the user has not seen named.
- Every action that changes state must render its own confirmation where the
  action was taken.
- If the app cannot encrypt, it must say so *before* send, in the words the
  user would use, not in OpenPGP's.
