# Sloth Lee — interface concept

*One page. Decided once, then applied screen by screen and measured.*

## The idea

**Quiet field, sharp ink.** Mail is a stack of other people's words; the interface
should get out of the way and still feel tended. Deep forest ground, cream ink,
one moss accent that means *act*, one sand tint that means *attention*. No
gradients on controls, no glass, no glow. What makes it feel designed is rhythm,
type and restraint — not decoration.

The test for any new element: *if it were removed, would the screen lose
information or only lose ornament?* Ornament loses.

## Voice

Plain, specific, second person. Say what will happen and what it costs.

- "Nothing here yet — mail to this address lands here." not "Your inbox is empty!"
- "Held until Thursday 09:00. Nothing has gone out yet." not "Scheduled!"
- Refusals name the fix: "No key for sam@… — find a key" not "Cannot encrypt".
- Never an exclamation mark. Never "Oops". Never a count where a mark will do.

## Type

| Role | Face | Size / weight | Notes |
|---|---|---|---|
| Brand, screen titles | serif stack (`ui-serif, Iowan Old Style, Palatino, Georgia`) | 20–28 / 500 | tracking −0.01em, line-height 1.1 |
| Body, rows | system sans (`ui-sans-serif, system-ui`) | 14 / 400–550 | line-height 1.45 |
| Meta, labels | system sans, uppercase | 11 / 550 | tracking 0.08em |
| Addresses, times, tokens | `ui-monospace` | 12–13 / 400 | digits align in columns |

Serif is the voice: it appears on the wordmark, the reader's subject, and the
empty states. Everything the user operates is sans. A serif heading on a button
would blend the two registers — don't.

## Ink ramp (no opacity for text)

Secondary text is a *colour*, never `opacity`. Stacked opacity was measured below
4.5:1 in the dark theme.

| Token | Value | Use |
|---|---|---|
| `--ink-1` | `#e9eee0` | primary text |
| `--ink-2` | `#b6c2ab` | secondary (snippets, values) |
| `--ink-3` | `#8d9a84` | tertiary (timestamps, meta) |
| `--ink-4` | `#65725c` | disabled only, never for reading |

Moss `#86bf6a` = act (primary button, unread mark, focus). Sand `#c8a17a` =
attention that is not an error (setup gaps). Rust `#e0593f` = destructive only.
A destructive press gets *colour*, never size or fill — a dangerous action must
not feel rewarding.

## Space and rhythm

4 / 8 / 12 / 20 / 32. Rows are 64 px tall on desktop (two lines: who + what),
72 px on a phone. List rows are hairline-separated — not cards. Panels are a 1 px
`--line` border and 10 px radius; the only shadow in the app is the compose sheet.

## Motion (closed vocabulary)

Four durations, each with one job. Nothing animates on load; data refreshes swap
in place with no movement at all.

| Token | ms | Job |
|---|---|---|
| `--m-press` | 90 | a control acknowledges the press |
| `--m-state` | 120 | a state changes (hover, selected, unread→read) |
| `--m-enter` | 180 | an element arrives (row menu, banner expand) |
| `--m-panel` | 240 | a panel or route replaces another |

Easing: `cubic-bezier(0.2, 0, 0, 1)` — fast out, settled in. Only two keyframe
names exist in the app: `rise` (8 px up + fade, for panel enter) and
`breathe` (skeleton opacity, and it is frozen at rest under reduced motion).
`prefers-reduced-motion: reduce` collapses every duration to 1 ms and disables
both keyframes.

Destructive actions get no flourish. Nothing bounces, nothing springs, no
parallax, no animated background gradient.

## Graphics that carry information

- **Initials avatar, tinted per sender.** Two letters from the name, hue derived
  from the address. It identifies a person; a remote favicon fetch identified a
  domain *and* leaked every sender to a third party, so that is gone.
- **One unread mark, not a count** in the row. Counts live in the sidebar, where
  the question is "how many", not "which".
- **A left rule marks the open row** — 2 px moss. Selection is position plus a
  slightly raised ground, never a green block behind the text.
- **Dates are grouped** (Today / Yesterday / Earlier this week) so the eye reads
  recency as structure rather than parsing a column of times.

## Card anatomy

```
┌ hairline ─────────────────────────────────────────────┐
│ [avatar]  Sender name            ·          14:32    │  ← mono time, right
│           Subject line, one line, truncates           │
│           Body snippet — two lines max, never bold    │
└───────────────────────────────────────────────────────┘
```

Full state only. Hover reveals star + more at the row's right edge without
moving anything. Checked rows show a 1 px moss border and the avatar is replaced
by the checkbox — the row never gains height.

## The four states, per screen

1. **Loading** — a skeleton of the loaded shape: same row count, same heights, no
   jump when data lands. A component that renders `null` while fetching is a
   layout shift, not a loading state.
2. **Empty** — a reason and a next action, in serif: "No mail yet. Messages to
   uidemo@slothlee.xyz land here." + the one action that makes sense.
3. **Error** — what failed, in the user's terms, and the retry. Never stale data
   presented as current.
4. **Full** — the design above.

## Composition rules

- **The rest state of the mail surface is one column.** With nothing open, the
  list takes the full width; the reader appears only when a message is chosen.
  An empty reading pane on a resting screen is half the app showing nothing.
- **One accent per screen.** If two things are moss, one of them is wrong.
- **Banners do not stack.** At most one strip above the list; several setup gaps
  collapse into one line with a count and an expand.
- **The sidebar ends deliberately** — a footer with the account and settings, not
  a void below the last group.

## "Better", as numbers

A pass is done when, on the deployed build:

- 0 horizontal overflow and the primary action inside the viewport at 320, 390,
  768 and 1440 wide (measured bounding rects, not screenshots).
- every text pair ≥ 4.5:1 against its own background, both at 14 px and 11 px.
- every screen has all four states reachable and rendered (skeleton, empty,
  error, full) — asserted, not assumed.
- no raw hex outside the token block; no text painted with `opacity`.
- touch targets ≥ 44 px on phones, ≥ 32 px on desktop.
- loading swap produces no measurable layout shift (CLS = 0 on a cold load).

## Motion

Four moments move; everything else is still. A mailbox you open every day
should not perform for you, so each animation had to answer "what does this
tell me?":

- **A row arriving** — `row-in`, 340 ms. It says *this is new*. Fires only for
  messages that appear after the first paint; a folder switch or a refresh
  is not an arrival.
- **The unread dot settling** — 200 ms opacity. It says *you have read it*.
- **The compose sheet rising** — 260 ms from the bottom on a phone, 200 ms
  scale-and-fade above 640 px. It says *this came from the bottom*.
- **The sealed note opening** — 420 ms. It says *the wait is over*, once.

All four are cancelled under `prefers-reduced-motion`.

## Icons and drawings

- The mark is one piece of geometry, drawn four ways: `favicon.svg` (any size),
  `icon-192/512.png` (home screen), `icon-512-maskable.png` (Android, face
  inside the 80 % safe circle), `apple-touch-icon.png` (opaque, because iOS
  renders transparency as black). `scripts/make-icons.py` draws them from the
  same numbers the app uses; nothing is hand-exported.
- Empty states are line drawings (`EmptyArt.jsx`) at one stroke weight, 1.4,
  no fills: inbox, search, queue, sealed note, groups. Illustration appears
  nowhere else — a mail app that decorates its own furniture is a mail app
  you stop trusting.
