/**
 * The Sloth Lee mark: a flat sloth face that reads at 16px (favicon) and at
 * 32px (sidebar and login). Colours are fixed rather than theme tokens so the
 * face keeps its warm fur tones against any background.
 */
export default function SlothMark({ className = 'w-6 h-6' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      role="img"
      aria-label="Sloth Lee"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="slothFur" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c8a17a" />
          <stop offset="1" stopColor="#a97f57" />
        </linearGradient>
      </defs>

      <circle cx="12" cy="12" r="11" fill="url(#slothFur)" />
      <path
        d="M12 5.2c3.9 0 6.6 2.9 6.6 6.9 0 4.3-2.9 7-6.6 7s-6.6-2.7-6.6-7c0-4 2.7-6.9 6.6-6.9Z"
        fill="#f4ead6"
      />
      <ellipse cx="8.6" cy="10.9" rx="2.7" ry="2.3" fill="#5c4632" transform="rotate(-14 8.6 10.9)" />
      <ellipse cx="15.4" cy="10.9" rx="2.7" ry="2.3" fill="#5c4632" transform="rotate(14 15.4 10.9)" />
      <circle cx="9.1" cy="11.1" r="0.95" fill="#10120f" />
      <circle cx="14.9" cy="11.1" r="0.95" fill="#10120f" />
      <circle cx="9.35" cy="10.75" r="0.3" fill="#ffffff" opacity="0.85" />
      <circle cx="15.15" cy="10.75" r="0.3" fill="#ffffff" opacity="0.85" />
      <ellipse cx="12" cy="14.9" rx="1.6" ry="1.15" fill="#5c4632" />
      <path
        d="M10.2 17c.6.8 3 .8 3.6 0"
        stroke="#5c4632"
        strokeWidth="1"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
}
