# Sloth Lee — interface plan

*Where everything belongs. Companion to `UI-CONCEPT.md` (the language); this is
the structure.*

## The problem being fixed

One modal titled **"OpenPGP"** currently holds nine unrelated things: encryption
keys, profile, two-factor, aliases, notifications, sessions, export, delete
account, recovery key. Nothing is findable, the back button does not work, a
phone gets a modal it cannot fill, and the admin panel is a separate page reached
from a row of small icons in the top bar.

Structure, not decoration, is the next thing to fix.

## 1. The shell

Three surfaces, each with one job:

```
┌──────────┬─────────────────────────────────────────────────────┐
│  rail    │  top bar:  [ search ……………………… ⌘K ]        (account)  │
│          ├─────────────────────────────────────────────────────┤
│ Sloth Lee│  optional one-line notice (setup gap / offline)      │
│          ├──────────────────────┬──────────────────────────────┤
│ + New    │  list  (filters,     │  reader (only when a message  │
│ Inbox    │  day groups, rows)   │  is open)                     │
│ Starred  │                      │                               │
│ Sent     │                      │                               │
│ Drafts   │                      │                               │
│          │                      │                               │
│ Groups   │                      │                               │
│  …       │                      │                               │
│          │                      │                               │
│ Settings │                      │                               │
│ Admin *  │                      │                               │
│ (account)│                      │                               │
└──────────┴──────────────────────┴──────────────────────────────┘
* admins only
```

Rules:

- **Rest state is one column.** No message open → the list takes the whole
  surface. A message open → list narrows to 400 px and the reader appears.
- **The rail ends deliberately**: Settings, Admin (if entitled), then the account
  block. Greyed "soon" items are forbidden.
- **Phone**: rail becomes a drawer; the list is the screen; opening a message
  pushes a full-screen reader with a back control; compose is a full-screen sheet
  (already built that way).
- **One notice at a time** above the list — setup gaps collapse into a single
  line with a count (already built).

## 2. Where each thing lives

| Thing | Today | Should live |
|---|---|---|
| Search | top bar, left | top bar, centred, `⌘K` |
| Compose | rail button | rail button + `C` |
| Folders | rail | rail |
| Groups | rail, below a divider | rail, below Folders, collapsible after 6 |
| Aliases | settings modal → "Addresses" | **Settings → Mail → Addresses**, and "Manage addresses" in the compose From row |
| Notifications (push) | settings modal | **Settings → Mail → Notifications** |
| OpenPGP keys | settings modal + top-bar lock icon | **Settings → Security → Encryption keys**; the top-bar lock goes away |
| Recovery key | settings modal | **Settings → Security → Recovery** |
| Recovery address | admin only | **Settings → Security → Recovery** (self-service; admin keeps override) |
| Two-factor | settings modal | **Settings → Account → Two-factor** |
| Sessions | settings modal | **Settings → Account → Signed-in devices** |
| Password | top-bar (admins only!) | **Settings → Account → Password** — everyone |
| Profile | settings modal | **Settings → Account → Profile** |
| Export (.mbox) | settings modal | **Settings → Data → Export** |
| Import (planned) | — | **Settings → Data → Import** |
| Delete account | settings modal, near top | **Settings → Data → Delete account**, last, destructive styling |
| Sealed-note status, withdraw | reader (Sent copy) | unchanged — it belongs to the message |
| Scheduled held mail | a panel above Sent | unchanged, but collapses to one line when nothing is held |
| Admin: users, approvals, waitlist, recipients | `/admin` page reached from a top-bar icon | **`/admin`**, in the account menu and rail (admins only) |

## 3. Settings becomes a page

Route `/settings`, with its own left sub-nav (on a phone: a list of sections that
opens into one). Four groups, in the order people need them:

**Account** — Profile · Password · Two-factor · Signed-in devices
**Mail** — Addresses (aliases) · Notifications · Appearance (theme, density)
**Security** — Encryption keys · Recovery
**Data** — Export · Import · Delete account

Why this order: identity before behaviour, behaviour before keys, and everything
that can destroy something at the bottom. "Appearance" is new — light/dark and
row density are the two settings a mail app is expected to have and this one
lacks.

Each section is a card: a title, one sentence of consequence, then the controls.
Dangerous controls sit alone, with the consequence stated, never beside a
friendly button of the same weight.

## 4. The admin panel

One route, `/admin`, four tabs. Not a second app — the same shell, the same
tokens.

- **People** — every account: created, last seen, storage used, admin flag,
  delete. Search by name or address.
- **Access** — the signup queue (approve/deny) and the waitlist. One row per
  request, decided in place, with an undo for five seconds.
- **Deliverability** — the recipient map Postfix is serving (`/etc/postfix/recipients`),
  its last sync time and entry count, alias totals, push subscriptions, and the
  last bounce reason seen. This is the tab that answers "why did mail not
  arrive".
- **System** — version, uptime, and the health of the sweepers (ephemeral, notes,
  scheduled, push last-delivery), read from what the server already reports.

Admin is reachable from the account menu and the rail, and nowhere else. The
top-bar icon row disappears entirely: search on the left, account on the right.

## 5. Screen inventory

| Screen | Entry | One primary action | States to build |
|---|---|---|---|
| Login | `/login` | Sign in | loading · wrong password · server unreachable · locked |
| Signup | `/signup` | Request access | queued · approved · denied |
| Account setup (keys) | after first sign-in | Generate keys | generating · failed · skipped-warning |
| Unlock | when key is locked | Unlock | wrong passphrase · locked out |
| Recover / Reset | `/recover`, `/reset` | Restore access | link invalid · expired |
| Mail | `/` | New message | skeleton · empty · error · full |
| Reader | selection | Reply | loading body · decrypt failed · deleted-on-read · sealed status |
| Compose | `C` / rail / reply | Send | encrypted/plain/sealed/held · sending · failed-with-reason |
| Settings | `/settings` | — | four groups, ten sections |
| Admin | `/admin` | Approve / create | empty queue · loading · error |
| Sealed note (public) | `/note?t=` | Open once | wrong passphrase · burnt · withdrawn · expired |

Every screen gets all four states wired before it is called done — the concept's
"better, as numbers" applies per screen.

## 6. Build order

*Status:* slice 1 (Settings page, light theme) and slice 3 (account flows) are
built and live. Slice 2 (admin) and slice 4 (mail polish) are next.


**Slice 1 — Settings becomes a page.** `/settings` with the sub-nav and all ten
sections moved, no behaviour changes; the "OpenPGP" modal and the top-bar icon
row are removed. This is the biggest structural win and it unblocks everything
else.

**Slice 2 — Admin, four tabs.** Restyle to the same shell, split the single page
into People / Access / Deliverability / System, add search and in-place decisions.

**Slice 3 — The account flows.** Login, signup, setup, unlock, recover, reset:
one layout (a centred card on a field of light), one set of states, one voice.

**Slice 4 — Mail surface polish.** Keyboard shortcuts and the `⌘K` palette,
compose alignment with the new tokens, the sent/scheduled panel collapse, and the
phone sweep of every screen at 320/390.

Each slice ends the same way: built, deployed, driven in a browser, screenshotted
at 390 and 1440, measured (no overflow, targets ≥ 44 px on phones, all four states
reachable), and committed.

## 7. What this plan refuses

- A second modal system for settings and admin.
- Settings for their own sake: nothing gets a control unless the control changes
  something the server actually enforces.
- A light theme before the dark one is finished (it is in Appearance, but last).
- Decorative illustration. The only graphics are the ones that carry an address,
  an identity, or a state.
