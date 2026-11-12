# Disposable addresses

Hand out an address that is not your real one, watch what arrives, and kill it
when it starts getting sold. Mail to an alias lands in your normal inbox — it is
one mailbox with several doors, not several mailboxes.

## What a person does

Settings → Addresses:

- **New address** — leave the name empty for something readable
  (`quiet-otter-418`) or type one (`shop-8f2k`). A label is optional.
- **Copy** puts the address on the clipboard.
- **Switch off** (the power button) stops it working: from the next few seconds,
  senders are refused at SMTP time with a normal 550 rather than having their
  mail accepted and dropped. Everything already delivered stays in the inbox.
- **Delete** (the bin) removes the address for good.
- Ten per account. The list shows how many messages each address has carried.

## How it works

`data/aliases.json` maps a local part to an owning account. On delivery the SMTP
loop resolves the local part through `core::aliases::resolve` when no account
answers to the name, then treats the message exactly as it would for the owner's
real address — same blob, same encryption, same groups.

Postfix decides what it accepts *before* the message reaches the app, from
`/etc/postfix/recipients`. That map is rebuilt every five seconds by
`sync-recipients.py` from `GET /api/admin/recipients`, which returns real
accounts (pending signups excluded) plus switched-on aliases. A name missing from
the map is refused at RCPT, which is why switching an alias off produces a clean
bounce instead of silence. If the endpoint fails, the script leaves the old map
alone: an empty map would reject all real mail.

Deleting an account removes its aliases too, so no address is left accepting
mail for a mailbox nobody can read.

## Limits, stated plainly

- **One direction.** Incoming mail arrives at the alias, but replies you send go
  out from your real address. Sending *as* an alias is not implemented.
- **Not anonymity.** Your provider still runs the server; an alias hides your
  address from a shop, not your account from the service.
- **Not retroactive.** Mail already delivered to the inbox stays there when the
  address dies.
- **Five seconds of lag.** The recipient map refreshes on a timer, so a brand-new
  address can bounce for a few seconds right after it is created.

## A way out as well as a way in

Mail that arrives at an alias is remembered as having arrived *there*. That
association cannot live on the message: `Email` is bincode and positional, and a
new field would make every existing message unreadable. It lives in
`data/arrival.json`, keyed by message uid, and is pruned after 180 days.

The inbox and the reader carry that fact as `alias` on the message, and the
compose window turns it into a default: **reply to a message that came to an
alias and the reply leaves from the alias.** The From row lists the real address
and every switched-on alias, so the choice is visible and reversible — an account
with no aliases never sees the row at all.

Sending from an alias is checked on the server, not in the browser: the local part
must belong to the caller and must not be switched off.

- someone else's alias → `400 unknown_alias`
- your own alias, switched off → `409 alias_disabled`
- no alias asked for → the account address, unchanged

A refusal is deliberate rather than a silent fallback. A message that goes out
under the wrong name cannot be recalled, and quietly swapping the sender would
make a bounced alias look like a normal send.

The From header has to name the alias as well, and on the encrypted path the
server never sees it — the headers are inside the ciphertext. So the compose
window writes the header and the server sets the envelope; both have to agree or
SPF and the visible sender would disagree with each other.

The settings copy says what is true: mail arrives at the alias, replies leave
from it, and a message you start yourself still goes from the real address unless
you pick the alias in the From row.
