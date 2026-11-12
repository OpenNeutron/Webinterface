# New-mail notifications

The app used to tell you about mail only when you were looking at it. This is the
other half: the browser is told when a message lands.

## What the server can and cannot say

A notification body is drawn on a lock screen, where anybody standing nearby can
read it. So the payload carries **a sender and the words "New mail"** — never a
subject and never a body. The subject of an inbound message is plaintext on our
disk, so this is a choice, not a limit we hit: the lock screen is simply not a
place mail was meant to be read.

## How it works

1. The browser creates a subscription — an endpoint URL plus two keys it
   generates — and hands them over with `POST /api/push/subscribe`.
2. The server seals a small JSON payload to those keys (RFC 8291: ECDH over
   P-256, then AES-128-GCM) and POSTs it to the endpoint with a VAPID JWT saying
   which server is asking (`p256` crate for the ES256 signature).
3. The service worker receives it and draws the notification. Clicking it focuses
   the app or opens it.

Nothing on our side can read the payload after sealing it, and the push service
(the browser vendor) cannot either.

## Storage

- `data/push.json` — `{"subs": {"<id>": {username, endpoint, p256dh, auth, created_at, ua}}}`
- `data/vapid.json` — the server's signing key. **Losing this file invalidates
  every subscription already registered**, because the browsers have pinned the
  public key they subscribed with. It is in the offsite tar for that reason.

Both are sidecars: a `User` field would have made every existing account
unreadable (bincode, positional).

## The rules

- An endpoint must be one of the push services browsers actually use. Chrome
  hands out `<something>.google.com/fcm/send/<id>` — not `fcm.googleapis.com` as
  the documentation implies — so the check is on the (host, path) pair. Without
  that check, any signed-in account could aim this server at any host it named.
- One subscription per endpoint: re-registering the same browser does not stack.
- A push service answering 404 or 410 means that browser is gone, and the
  subscription is deleted on the spot.
- Deleting an account deletes its subscriptions.
- A test push exists (`POST /api/push/test`) so "it is broken" can be told apart
  from "no mail arrived".

## Limits, stated in the UI

- **iPhone**: Safari delivers web push only to an app added to the home screen.
  The settings section says so instead of offering a switch that would do nothing.
- A notification says who it is from, not what it says. That is on purpose.
- Notifications are per browser. Signing in somewhere else does not carry them.
