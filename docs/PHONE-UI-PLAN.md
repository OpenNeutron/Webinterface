# Phone plan for the mail client

Written after driving the live site at 320×640, 390×844 and 430×932 with a real
touch-emulated browser, measuring every control's own bounding rect and reading
screenshots. Numbers below are measured, not estimated.

---

## 1. What the audit found

### The one defect class that mattered

**Thirty-one controls on the inbox were below the 44 px thumb floor** at every phone
width — the same 31 at 320, 390 and 430, because these were desktop sizes that no
breakpoint touched: folder button 36×36, search field 36 tall, account chip 58×36,
filter chips 38×34 / 66×34 / 53×34, refresh 34×34, per-row select 36×36, star 34×34,
overflow 34×34. Nothing overflowed, so no screenshot looked broken, and no overflow
check would ever have caught it. A thumb landing three pixels wide hits the row
behind the button and opens a message instead.

### What the screenshots caught that geometry could not

| Screen | Defect |
|---|---|
| Inbox banner | "2 things not set up yet — Recovery …" truncated **the answer** at 390: the one line that tells you what is missing hid the list of what is missing |
| Settings strip | 14 sections in a 1403 px horizontal strip; the last tab sat past the edge, the strip had 16 px of trailing padding so it could not be scrolled clear, and the active section was usually off-screen |
| Folder drawer | No close control at all — the only exit was a tap on a 100 px dimmed strip or the system back gesture |
| Reader | Reply sat above the subject, mobile actions were 32×32, and the reader had no bottom action area at all |
| Compose | At 320 px the formatting toolbar pushed "Add Link" **fully off-screen** (left 320, right 364) |
| Compose | The self-delete control was labelled **"Keeps"** — a word that names nothing, on the control that decides whether the message survives |
| Settings | The signature textarea showed a desktop resize grip on a phone |
| Reader (HTML mail) | **Mail cut off at the right edge.** A 600 px-wide email widened the reader column to 648 px inside a 390 px viewport and had its right side clipped — and no `scrollWidth` check on the document could see it, because the overflow was hidden inside the reader's scroll area |

### Structural findings (not fixable by padding)

1. **The settings strip is not a tab bar and pretends to be one.** It scrolls like
   tabs, highlights like tabs, and then shows every section stacked below — so the
   selected pill contradicts the page. Fourteen items in a scroller with no index is
   the single worst navigation surface on the phone.
2. **Card-in-card.** The profile form sits in a bordered card inside a bordered
   section card; the double border reads as a rendering mistake at 390 px.
3. **Duplicate heading.** The active tab ("Profile") repeats the section heading
   immediately below it.
4. **Unread is colour-only** (a green dot), and the dot aligns to the subject line
   rather than the sender line, so it reads as a bullet.

---

### The HTML-mail cut, in detail

The reader sits inside a Radix scroll area, whose content wrapper is
`<div style="min-width:100%; display:table">` — a table box sizes to its widest child,
so a 600 px message made the *column* 648 px wide. The page never overflowed, so every
"no horizontal overflow" check passed while the message was cut off.

Three fixes were needed, in this order, and the first two were wrong on their own:

1. **Strip the fixed widths** — `width`/`height` attributes and `width:`/`nowrap` in
   inline styles are removed after sanitising, so the mail reflows to its column.
2. **Cap the body block** — `max-width: calc(100vw - 3rem)` (the reader's own padding).
   `100%` is useless here: inside the scroll area's content wrapper a percentage
   resolves against the message's own width.
3. **Stop blocking tables** — `display: block` on a table left its row-group laying out
   at content width (400 px) and scrolling *inside* the column. Tables stay tables,
   get `width: 100%`, and their cells break words instead.

Verified with four shapes at 320/390/430 — fixed-width marketing mail, a 700 px table
with numbers, a 300-character unbroken string, and a 160-character URL — all now sit
exactly at the column width (272/342/382) with nothing overflowing inside and the right
edge inside the viewport. Desktop unchanged: 672 px column, cells split 236/236/200.

## 2. What changed in this pass

All of it deployed and re-measured; the numbers are the post-change values.

- **One rule for icon targets instead of twenty patches.** Phones get
  `button:has(> svg:only-child) { min-width: 44px; min-height: 44px }`, so a control
  whose only content is an icon is a thumb target everywhere — including screens
  written after this pass. Controls with a label are untouched.
- **Text, link and input controls that the rule cannot reach** were lifted
  individually: search field, account chip, filter chips (min-width too, so "All"
  is not a 38 px target), row select checkbox, setup-strip disclosure and dismiss,
  reader reply, compose send, sidebar rows on the drawer, the settings "Mail" back
  link, the profile Save button.
- **The banner wraps instead of truncating** on phones (two lines, chevron aligned to
  the first line), because the only line that says what is missing must not hide it.
- **The settings strip** got 40 px trailing padding (the last tab now clears the edge
  at 350 of 390), 44 px link rows, and a follow-the-scroll behaviour so the active
  section is always on screen.
- **The drawer has a close button** (44×44, top right).
- **The compose toolbar wraps** below the breakpoint rather than clipping its last
  control, and the recipient/subject fields, the expiry select and Send are full
  thumb targets.
- **"Keeps" → "No expiry"**, which is what the control actually decides.

### Measured result

| Screen | Before (390) | After (320/390/430) |
|---|---|---|
| Inbox | 31 controls < 44 px | **0** · no overflow |
| Reader | 6 controls < 44 px | **0** · no overflow |
| Compose | 49 < 44 px, 5 under-sized fields, "Add Link" off-screen at 320 | **0** · no overflow |
| Drawer | no close control | **0** · close present |
| Settings | 4 < 44 px, last tab unreachable | **1**, and it is prose |
| Last settings tab | past the edge | right edge **350** < 390 after scrolling |

The one remaining sub-44 target is the word "Import" inside an export sentence — an
inline link in running text. It is deliberately not padded: a 44 px box inside a
sentence breaks the paragraph. It keeps hover underline and is not a primary path.

---

## 3. What is left, in build order

Each slice below is independently shippable and ends with the same proof: measured
at 320/390/430, screenshotted at 390 and 1440, no overflow, targets at 44.

**Slice 1 — Settings navigation. DONE** (`3e45726`, `60446af`).
The strip is gone on phones. A grouped two-column index replaces it — Account / Mail /
Security / Data — and tapping a tile opens that one section with an "All settings"
control back to the index. A `#hash` deep link opens the section directly on a phone
instead of scrolling a page that is not there. Tiles are labels only: two columns
truncated every description to an ellipsis, which reads as broken, and the opened
section carries the full note above its controls. "Delete account" spans both columns
and sits on its own row.
*Measured:* 14 tiles at 390×700 and 320×640, **0 below 44 px**, page `scrollWidth`
equals the viewport at both, rail `offsetParent` null (hidden), tapping Delete account
mounts **1** section with the back control present. Desktop unchanged (rail, all
sections stacked).

**Slice 2 — Flatten the settings cards. DONE** (`3d75fbb`, `bfbe98c`, `50c0865`).
Nine sections put a bordered panel inside the bordered section card — a box in a box on
a 390 px screen. Each inner panel keeps its surface and loses the outline; form fields
keep their borders, because a field without one stops looking like something you can
type in. The panel surface is `bg-secondary/60`, not `bg-background/50`: measured, the
page colour at half opacity is nearly invisible in the light theme (#f6f6f0 on #ffffff)
while the secondary token is one step from the card in both (#1f261d on #161c15,
#eaede2 on #ffffff). The phone also stops naming the section twice — the app bar
carries it, so the `h2` is suppressed there and the note stays.
*Measured:* all 14 sections report **0** bordered panels inside the section card
(inputs, buttons and links excluded from the count), **0** `h2` on a phone, page
`scrollWidth` equals the viewport. Dark and light both resolve a visible panel surface.

**Slice 3 — Reader action bar. DONE** (`42af792`…`c2a28db`).
Three things were wrong, and only the first was in the plan:

1. **Reply-all and Forward did not exist.** The reader had one Reply button. Reply-all
   keeps the sender, the other To's and the Cc list minus yourself; Forward is the same
   quoted body with no threading, because it starts a conversation rather than continuing
   one.
2. **The bar rendered above the message.** It sat before the scroll area in the column,
   so "Reply sits where the message ends" was true of the comment and false of the screen:
   the verbs were pinned under the top bar and pushed the message further down. It now
   follows the scroll area, and on a phone it is `fixed` to the bottom above the safe-area
   inset, with the message padded so its last line clears the bar.
3. **A long message could not be scrolled at all.** The `ScrollArea` is a flex child, and
   a flex child's default `min-height` is its content: the viewport grew to the message's
   7,985 px, the reader's `overflow-hidden` cut it at the fold, and nothing scrolled —
   the message simply stopped. `min-h-0` on the root fixes it. This was found while
   measuring the bar, and it is the more serious of the three.

*Measured at 390×700:* viewport `scrollHeight` 7,985 / `clientHeight` 652, `scrollTop`
reaches 7,333 and the message ends with its own last line visible; the bar stays at
**646–690 of 700** at every scroll position; all three buttons **44 px**. Reply-all opens
compose with subject `Re: …` and exactly the three other recipients (not me); Forward
opens `Fwd: …` with no recipients and the quoted original in the body. The proof suite
now asserts bar position, height and on-screen-ness per viewport.

**Slice 4 — Unread state. DONE** (`71f3e16`).
The dot and the semibold sender already existed, but the dot was centred in a
three-line row — floating between lines rather than marking the sender — and a checked
row was tinted the same hue as the open one, so two different states read as one. The
dot now sits in the sender's line; checked is `sand/10` while open stays
`primary/9%`; each unread row carries sr-only "Unread" so the state has a name.
*Measured at 390×700:* opened row weight **400**, untouched row **600**, dot opacity
**1**, "Unread" in the row's text. A colour screenshot converted to luminance
(`unread-gray-390.png`) still separates read from unread by dot and weight alone.
*In the suite:* the phone proof now keeps one fixture it never opens as the unread
reference — comparing against "some other row" passed on the first viewport and failed on
the third, when every row it had visited was read. It asserts weight, dot and the
accessible name per viewport.

**Slice 5 — List rhythm. DONE** (`50f3355`, `fa569c7`).
Measured on a mixed inbox at 390, the date cell was **36 px** for `14:34`, **43** for
`Oct 17` and **72** for `Sep 24, 25`, in an auto-sized column — so the sender's
truncation point moved row to row and the dates started at three different x positions.
The cell is now a fixed **72 px**, right-aligned, `tabular-nums`.
Then the fix produced its own bug: at exactly the column width, `Sep 24, 25` broke after
the comma and dropped the year to a second line, which the screenshot caught and the
number did not. `whitespace-nowrap` is part of the fix, not a detail.
*Measured:* 390 and 320 → date widths `[72]`, heights `[18]`, left edges `[292]` /
`[222]`, **zero** wrapped dates, no page overflow; desktop grid columns identical on every
row (`180px 634px 72px`). Row height uniform at 81 px on a phone.
*In the suite:* each fixture now carries a different date (today, −12 d, −400 d, −800 d),
and the proof asserts one width and no wrap per viewport.

**Slice 6 — Phone-specific affordances. DONE** (2026-11-12).
Started from a real report: mail could not be deleted on a phone. A row's Delete lived in
its hover actions, which a phone never shows; a conversation had no select box and its
delete was hidden below 640 px; and a server without Trash answered every delete with a
dead end. Now:

- **Swipe left to delete, hold to select** (`SwipeRow`). Touch only; the row slides back
  if the server refuses, and Delete moves to Trash with Undo, so the swipe has its undo.
  Hover actions are hidden on coarse pointers, where they were invisible but tappable.
- **Conversations select as one** (all / some / none), and swipe away as one.
- **No Trash on the server** offers "delete for good?" instead of doing nothing.
- **Pull to refresh** on the list (`usePullToRefresh`), with `overscroll-contain` so the
  browser's own pull does not reload the app and drop the unlocked key.
- **New mail without a tap**: checked once a minute while visible and on return to the
  app; only new messages are fetched and decrypted, older pages stay loaded.
- **Refresh reads the folder on screen** (it read the inbox in Sent and Trash too), and
  starts Load older mail from the top again (it used to skip a page).
- **Compose follows the visual viewport**, so Send rides on top of the keyboard instead of
  under it; its footer and the drawer clear the safe-area insets; title-bar buttons 44 px.
- The selection bar says "Delete" in words on a phone; its buttons and the reader's are 44 px.

**Slice 7 — The proof, in CI. PARTLY DONE.**
Today's measurements were run by hand. Add a `phone` leg to the proof runner: a
headless Chromium at 390×844 with `isMobile: true, hasTouch: true` that loads
inbox / reader / compose / settings / drawer, asserts `scrollWidth <= innerWidth`,
asserts every interactive element's rect is ≥44 in both dimensions (with an explicit
allow-list for inline prose links), and asserts the compose Send button's own rect is
inside the viewport. Ten minutes of automation to make every future slice answerable
by one command — the audit above cost an hour precisely because this did not exist.

*Status:* the reader half exists as `scripts/proof-phone-render.mjs` (headless Chromium
over CDP, 390×700 / 360×640 / 412×760, painted-rect measurement, 55 checks, judged by
exit status). Still to add: inbox, compose, settings index and drawer — this slice's own
screens — and the 44 px sweep with an allow-list for inline prose links.

---

## 4. What "phone friendly" means here

- 320×640 is the constraint, not 390. Everything above was measured there first.
- No horizontal document overflow on any screen; a control that needs more width
  wraps or scrolls inside its own container.
- Every tap target ≥44×44, except links inside running text (named above).
- The primary action of a screen is inside the viewport, reachable without scrolling
  where the platform allows it.
- Nothing that carries meaning is truncated on a phone. Decorative truncation
  (previews, subjects) is fine; the setup banner was not.
- A drawer, sheet or overlay always has a visible way out.
