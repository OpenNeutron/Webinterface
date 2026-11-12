# Signup without codes: request, then approve

**Status: implemented.** Registration no longer requires an invite code. A new
account is created in a **pending** state, cannot log in, and appears in the
admin panel for approval.

## Why a sidecar, not a field

`users.bin` is bincode and positional: adding a field to `struct User` makes
every existing record unreadable. Pending state lives in
`data/pending_users.json`, keyed by lowercase username:

    { "entries": { "alice": { "username": "alice", "requested_at": 1761..., "ip": "1.2.3.4", "user_agent": "..." } } }

Deleting the entry *is* the activation — there is no second flag to keep in sync.

## Server

1. `src/core/pending_users.rs` — `add`, `contains`, `list`, `count`, `remove`,
   plus `*_at` variants the tests drive with temp files. Read-modify-write is
   serialised by a mutex and written temp+rename, so two simultaneous signups
   cannot drop each other and a crash cannot leave a truncated queue.
2. `user.rs` `register` — the approval gate in one place (`admission()`):
   - no `registration_requires_approval` → immediate, 201
   - a claimed invite code → immediate, 201 (existing invites keep working)
   - no code → **pending**, 202 `{"pending":true}`, no session token
   - a code that does not claim → 403 `invite_required`, not queued
   The queue entry is written **before** the account, and rolled back if the
   account fails to save: a crash then fails closed (entry with no account) and
   a pending account is never created as an administrator.
3. `auth_controller.rs` `authenticate_with_client` — after the password check and
   **before** any token is issued: `pending_users::contains(username)` returns
   `403 account_pending`. After the password (so it does not confirm which names
   are queued), before the token (so logging in cannot smuggle an approval).
4. `admin.rs` — `GET /api/admin/pending`, `POST /api/admin/pending/approve`,
   `POST /api/admin/pending/deny`, all Admin-only. Approve logs
   `[Admin] Approved account '<username>'`. Deny deletes the account through the
   same `erase_account()` the delete route uses (mail, sessions, 2FA, recovery,
   address claim).
5. `UserDto.pending` marks queued accounts in `/api/admin/users`, so
   `sync-recipients.py` can skip them: an unapproved address must not accept
   mail nobody can read.

## Client

- Signup (`public/signup.html`): the code field is optional; on `202` it says the
  account is waiting for approval and does not redirect to login.
- Login (`src/components/Login.jsx`): `403 account_pending` shows
  "waiting for approval", never "wrong password".
- Admin panel: a **Pending accounts** list with Approve and deny, showing the
  request time and the source address.

## Operator

- Panel → Admin → **Pending accounts** → Approve.
- Shell: `mail-pending` (list), `mail-pending approve <name>`,
  `mail-pending deny <name>`.
- Or delete the entry from `/opt/on/data/pending_users.json` on the host — that
  is the same activation, and is the way out of a bootstrap deadlock.

## Proof bar

Sign up with no code → login refused as pending (not as bad password) → approve
in the panel → login succeeds. Anything short of that four-step sequence does not
prove it, because two of the three failure modes look identical from outside.

## Keep the anti-abuse work

Proof of work still prices each signup, and the per-address limit still applies
when enabled. Removing the code must not remove the cost of registering. A
pending account is also never a recipient: mail to it is rejected at RCPT time
until approval, so a queue of unapproved names cannot be used as free storage.
