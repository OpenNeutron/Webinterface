# HTML mail on a phone: what is actually wrong, and the plan

Written after two rejected fixes. Both were guesses against fixtures I wrote myself —
fixtures that were tamer than real mail. This document is built the other way round:
measure real email first, then decide.

## 1. The complaint

> "I want this friendly for phone users emails at cutting out of page for phone users"
> "You didn't solve anything I want to see the entire email in one screen on phone"

Received HTML mail is cut off at the right edge on a phone.

## 2. Method

Real messages, not fixtures. SpamAssassin public corpus (`easy_ham`, `spam`,
`hard_ham` — 3,505 messages), from which 431 contain `text/html` and **287 declare a
fixed layout width of 500 px or more** (47 of them exactly 600). Twelve were imported
through `POST /api/import/message` into a throwaway account and opened in the reader
at 390×844:

| pick | selection rule | why |
| --- | --- | --- |
| 3 | widest fixed layout (≥900 px), ≥4 nested tables | worst case |
| 3 | 700–900 px, ≥5 tables | common marketing mail |
| 3 | exactly 600 px, ≥3 tables | the canonical newsletter width |
| 2 | 500–620 px | modern-ish transactional mail |
| 1 | <500 px | control: should never have a problem |

Measured per message, after load, with a low-level feature check rather than a
plausible summary:

- `clipRight` — the widest **painted** rectangle inside the reader minus the reader's
  own right edge. Uses `getBoundingClientRect`, so CSS transforms are included. This
  is what the eye sees; `scrollWidth` is not, and that is the mistake that made the
  last two fixes look green while the screen was still cut.
- `wholeOnScreen` — does the message end above the viewport bottom.
- `minFont` — the smallest rendered font size (computed px × applied scale).
- `docOverflow` — page-level horizontal overflow (this was always `false`; the clip
  lives inside the reader where this check cannot see it).

## 3. Results, 390×844, 12 real emails

Before = the build the user rejected (`f52a40c`). After = the same messages with the
two defects found in this research fixed (see §4).

| msg | layout | before: clip / min font | after: clip / min font | height |
| --- | --- | --- | --- | --- |
| 01 | 999 px, 6 tables | 0 / 32 px | 0 / 32 px | 6,317 |
| 02 | 999 px, 6 tables | 0 / 32 px | 0 / 32 px | 6,317 |
| 03 | 900 px, 5 tables | 0 / 10 px | 0 / 10 px | 1,872 |
| 04 | 810 px, 7 tables | 0 / **4.5 px** | 0 / **4.6 px** | 394 |
| 05 | 778 px, 10 tables | 0 / **7 px** | 0 / **7 px** | 394 |
| 06 | 775 px, 12 tables | **4 px** / 10 px | **4 px** / 10 px | 8,417 |
| 07 | 642 px, 3 tables | 0 / 13 px | 0 / 13 px | 1,120 |
| 08 | 627 px, 9 tables | **34 px** / 10 px | **34 px** / 10 px | 2,564 |
| 09 | 627 px, 9 tables | **4 px** / 10 px | **4 px** / 10 px | 2,856 |
| 10 | 620 px, 9 tables | 0 / 13 px | 0 / 13 px | 1,765 → 2,085 |
| 11 | 616 px, **40 tables** | **309 px** / 10 px | **148 px** / 10 px | 17,375 → 17,678 |
| 12 | 489 px, 7 tables | 0 / 10 px | 0 / 10 px | 1,771 |

Four of twelve still clip. Two of twelve are shrunk to between 4.6 px and 7 px type —
that is a regression I introduced, not a fix. And eight of twelve are thousands of
pixels tall, so "the entire email on one screen" is not achievable for them at a
readable size no matter how the scale is chosen.

## 4. What the research found (in the order it was found)

**Cause 1 — a phone-only rule turned every table into a block.** `src/index.css`, phone
media query: `.email-html-body table { display: block; overflow-x: auto }`. A block
table still lays its row-group out at the sender's width, so a 600 px message painted
its rows past the column edge; `overflow-x` then hid the overflow *inside* the reader.
Page-level overflow checks stayed green. Removed. Message 11: 309 px → 148 px.

**Cause 2 — `nowrap` is an attribute, not a style.** The sanitiser rewrite stripped
`width`/`height` attributes and `width:`/`white-space:` inline styles but never the
legacy `nowrap` attribute, which old mail puts on cells to hold a column open at any
screen width. One message carries it 15 times. Now stripped.

**Cause 3 — table min-content beats `width: 100%`.** Auto-layout tables cannot be
forced narrower than the sum of their columns' minimum widths, and images contribute
their intrinsic width to that minimum. Measured: the worst table computes
`display: table`, `max-width: 100%`, and still renders **490 px inside a 342 px
column** (148 px of clip).

**Cause 4 — `table-layout: fixed` cures the width and destroys the layout.** Tested on
the live DOM: it drives painted overflow from 153 elements to **0**, and inflates that
same message from 17,375 px to **107,914 px**, because 40 columns share 342 px and
every word breaks. It is not a fix; it is a different bug.

**Cause 5 — the fit scaled by height and produced unreadable text.** The current
safety net fits width *and* height so the whole message lands on one screen. On
messages 04 and 05 that meant scale 0.45–0.54, i.e. 4.6 px and 7 px body text. Fitting
the screen is not the same as being readable, and the trigger used `body.scrollWidth`,
which reported 342 px on a message that painted 148 px of overflow — so the safety net
did not even fire where it was needed.

**Cause 6 — the reader gives away 45 % of the screen.** The message starts at y=376 on
an 844 px viewport. Header, back bar, subject and actions take 376 px before the first
line of mail.

## 5. Options, with the numbers

**A. Reflow harder** (more CSS). Cannot win: cause 3 is a property of table layout and
cause 4 shows the only CSS lever that beats it wrecks the design. Expected result:
persistent 4–150 px clips on legacy mail.

**B. Render in a sandboxed iframe at the sender's layout width, scale to the column.**
The message gets its own 600 px (or its declared width) viewport — exactly what it was
designed for — so nothing is asked to reflow and nothing can clip. Then one uniform
transform fits it to the screen: 600 → 342 px = scale 0.57, 600 → 390 = 0.65. This is
how Apple Mail's zoom-out behaves, and it is the only option that is *guaranteed* by
construction rather than by a growing list of exceptions.

Spiked on the live site before writing this plan, because our CSP forbids inline
scripts and a plan that ignores that is fantasy:

- `frame-src 'self' blob:` is already in the security headers — a blob URL frame loads.
- `sandbox="allow-same-origin"` (with **no** `allow-scripts`) lets us read
  `contentDocument` to measure the message height, and a `<script>` injected into the
  test message **did not run** (page title unchanged). Verified.
- Height is read from the frame and applied to the wrapper so the reader scrolls
  normally; the frame itself is `transform: scale()` with `transform-origin: top left`.

**C. Hybrid: reflow by default, iframe + scale when reflow measurably fails.**
Best fidelity, two code paths, and the fallback can only trigger on a measurement —
which is honest, testable behaviour.

**Decision: C, on B's machinery.** Every message renders through the iframe renderer.
Reflow styling still applies inside it, so responsive mail looks like mail; the
difference is that the frame's viewport is set from the message's own layout width and
then scaled once, so clipping is structurally impossible rather than repaired
after the fact.

## 6. Rules the implementation must obey

1. **Clipping is a measurement, not a style.** Acceptance is `clipRight == 0` computed
   from painted rectangles at 320, 390 and 430 px. Nothing else counts as proof.
2. **Never scale below legibility.** Whole-message fit only when the resulting body text
   stays ≥ 11 px; otherwise fit the width and let the reader scroll. 4.6 px is a defect
   even when the geometry is perfect.
3. **"Whole message on one screen" is offered, not forced.** Shrinking an 8,000 px
   message to fit is a thumbnail, not reading. Default: fit width. Explicit control:
   fit whole, only for messages where it stays readable.
4. **No scripts in the frame, ever.** `sandbox="allow-same-origin"` alone; links get
   `target="_blank" rel="noopener noreferrer"`.
5. **The reader must stop eating half the screen.** A compact on-scroll header, so the
   message starts near the top where it does in every other mail client.
6. **A build stamp the user can read.** "Settings → About: build, renderer, last fit
   scale." Every round of this so far ended with a disagreement about what his phone was
   even running; that ends here.

## 7. Slices, in build order

1. **The lab is the gate — now automated.** `scripts/proof-phone-render.mjs` drives a
   real headless Chromium over CDP at **390x700, 360x640 and 412x760**, imports four
   shapes that break (600px newsletter, 2002-era four-column table with `nowrap`, a
   900px layout, and a verification mail with a logo header), and asserts on painted
   rectangles: nothing past the frame's right edge, frame inside the column, no page
   sideways scroll, smallest rendered text ≥ 8px, and the verification mail whole on
   one screen. 55 checks, part of `./scripts/run-all-proofs.sh` (15 proofs).
   `PHONE_PROOF_VIEWPORTS=390x300` makes it fail on demand — a proof that cannot fail
   is a decoration.
2. **Iframe renderer** beside the current one, behind the same `EmailBody` interface:
   blob URL, width = declared layout width clamped to 320–700, scale = column / width,
   height measured after load, `ResizeObserver` on the column to re-fit on rotation.
3. **Fit policy** — width-fit default, whole-fit control with the 11 px floor, and the
   scale shown to the user when a message cannot be shown at full size.
4. **Reader chrome** — compact header, so the message occupies the screen.
5. **Instrumentation — done.** The sidebar footer carries `<sha>[+] · <innerWidth>x<innerHeight>`
   (dirty trees are marked `+`), so any screenshot says which build and which viewport
   produced it. Deploys go through `scripts/deploy.sh`, which refuses to ship when the
   build has no entry point or no build stamp, and verifies the served asset is
   byte-identical to the build afterwards. It exists because a failed build once shipped
   the previous bundle: `npm run build | tail -2 && ...` takes its exit status from
   `tail`, and the symptom looked exactly like a client cache problem.
6. **On-device acceptance** — the user reads the same Instagram mail on his phone and
   sends one screenshot; the build stamp says which build produced it.

## 8. Result after slices 1–2

The renderer is an iframe; every width in the mark-up is dropped and the message reflows
inside its own document, where it cannot drag the reader's column about. Measured on the
same twelve real messages, after:

| width | messages | clip | smallest rendered text | page overflow |
| --- | --- | --- | --- | --- |
| 320 | 12 | 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 | 9.1–24 px | none |
| 390 | 12 | 0 × 12 | 10–24 px | none |
| 430 | 12 | 0 × 12 | 10–24 px | none |

All twelve now render at **scale 1.0** — nothing is shrunk, so nothing is a thumbnail.
The framing/scaling path still exists for mail that cannot reflow at all, but no message
in the corpus needed it once it had its own viewport.

The acceptance case — a 600 px Instagram verification mail, the message the user
photographed — measures at 390×844: message spans y=392 to **y=809** of 844, scale 1.0,
`insideClip 0`, the six-digit code present and legible, no page overflow. The whole email
is on one screen, not a reflowed slice of one.

### The frame must never be wider than the column

The first version of the renderer widened the iframe to the message's own width when it
could not reflow, and scaled the *element*. On the user's phone that produced a page
wider than the screen: the reader's scroll-area content wrapper is a table that sizes to
its widest child, so a 620px frame pushed the page to 620px — and the app's own header
timestamp was cut off with it, which is what the screenshot showed. A message is now laid
out at its own width *inside* a frame that is always exactly the column's width, and the
document body is scaled in place (`transform` on `<body>`, `overflow-x: hidden`).

Verified on a deliberately unreflowable 620px message at 390px: frame 342 = column 342,
`frameOutsideColumn 0`, page `scrollWidth 390`, header timestamp fully visible, message
shown at 55% with a one-line note underneath saying so.

## 9. Why "nothing is changing" — the viewport was the bug

The user reported no change after a deploy that provably served the new bundle (access
log: his Android client fetched `index-B3u-ANEm.js` at 04:08, right after logging in at
04:07:54). The failure was in my own test setup, not in delivery:

- I measured at **390x844**, the device's *screen* height.
- Chrome on Android reports about **700px** of usable viewport at that size, because the
  URL bar and the system navigation bar are subtracted.
- The reader spent **330px** before the message and left **370px** for it. The message
  was 527px tall, so it needed scale **0.70**; the auto-fit floor was 0.75, so it never
  fired and the message simply scrolled. At 844px of height the same message needed 0.91
  and did fit — which is why the emulator said "whole on screen" and the phone did not.

Fixes, all measured at 390x700 / 360x640 / 412x760:

| change | effect |
| --- | --- |
| merged the phone back bar into the reader's action bar | two stacked bars (100px) became one (48px) |
| compact header on phones: one-line subject cap, tighter gaps, the `to …` line dropped | header 330px → **252px** |
| auto-fit floor 0.75 → **0.65** | a 547px message on a 360x640 phone (needs 0.67) now fits |

Result: whole message on screen at **0.81** on 390x700, **0.67** on 360x640, **0.93** on
412x760 — all with no page overflow.

**The lesson, and the rule from now on:** a phone viewport is not the phone's screen
size. Every measurement in this repo is taken at 390x700, 360x640 and 412x760, not at the
nominal 844/932 heights, because those numbers include browser chrome the page never
gets. Also bump the service-worker cache name on every deploy: a shell cached under an
old name is how a phone runs last week's reader while the server serves this week's.

## 10. What this plan will not do

- It will not make an 8,000 px newsletter fit one screen at readable size. Nothing can;
  the choice is scroll or thumbnail, and the reader will offer the second explicitly.
- It will not stop a sender's 600 px design from looking like a 600 px design on a
  390 px screen — it will simply be a 600 px design scaled to 0.57, complete and uncut,
  which is what "see the entire email" means.
