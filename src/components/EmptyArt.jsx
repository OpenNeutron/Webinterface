/**
 * The empty states, drawn.
 *
 * A sentence alone in a large panel reads as a failure. These are five small
 * line drawings — one stroke weight, no fills, no people — so an empty mailbox,
 * an empty search and an empty queue each look deliberate instead of broken.
 * Current colour only: the caller decides whether it sits in ink or moss.
 */
const ART = {
  // An inbox with nothing in it: the tray, and two lines settling into it.
  inbox: (
    <>
      <path d="M14 30.5h10.5l2.5 4h10l2.5-4H50" />
      <path d="M14 30.5 19.5 16h25L50 30.5v9a3 3 0 0 1-3 3H17a3 3 0 0 1-3-3v-9Z" />
      <path d="M27 10.5h10M31 5.5h2" opacity=".55" />
    </>
  ),
  // Nothing found: a lens over a line of text that isn't there.
  search: (
    <>
      <circle cx="29" cy="22" r="11.5" />
      <path d="m38 31 7 7" />
      {/* the message that isn't there: three lines of it */}
      <path d="M23 18.5h12M23 22.5h12M23 26.5h7" opacity=".65" />
    </>
  ),
  // A queue nobody is waiting in: a stack of cards, the top one settled.
  queue: (
    <>
      <rect x="17" y="9.5" width="30" height="9" rx="2.5" opacity=".45" />
      <rect x="14" y="21" width="36" height="9" rx="2.5" opacity=".7" />
      <rect x="17.5" y="32.5" width="29" height="9" rx="2.5" />
      <path d="m27.5 37 2.6 2.6 4.6-4.8" />
    </>
  ),
  // A sealed note: an envelope whose seal is a keyhole.
  seal: (
    <>
      <rect x="12" y="15" width="40" height="27" rx="3.5" />
      <path d="m12 18 20 14 20-14" opacity=".55" />
      <circle cx="32" cy="28" r="2.6" />
      <path d="M32 30.6v3.2" />
    </>
  ),
  // Groups: two addresses that do not overlap yet.
  groups: (
    <>
      <circle cx="24" cy="24" r="9.5" />
      <circle cx="41" cy="24" r="9.5" opacity=".55" />
      <path d="M20 24h8" opacity=".7" />
    </>
  ),
}

export default function EmptyArt({ kind = 'inbox', className = '' }) {
  const art = ART[kind] ?? ART.inbox
  return (
    <svg
      viewBox="0 0 64 48"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {art}
    </svg>
  )
}
