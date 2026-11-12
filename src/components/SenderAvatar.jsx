import { useMemo } from 'react'

/**
 * Who sent it, as two letters and a tint.
 *
 * The hue comes from the address, so the same person is always the same colour
 * and a crowded inbox becomes scannable. This used to fetch a favicon from a
 * third party, which identified the *domain* rather than the person and told
 * that third party about every correspondent — both wrong, so it is gone.
 */
function initialsOf(from) {
  const name = (from?.name || '').trim()
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    return name.slice(0, 2).toUpperCase()
  }
  const local = (from?.email || '?').split('@')[0]
  return local.slice(0, 2).toUpperCase()
}

function hueOf(from) {
  const key = (from?.email || from?.name || '?').toLowerCase()
  let hash = 0
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) % 360
  return hash
}

export function SenderAvatar({ from, variant = 'list', isSelected = false }) {
  const { initials, hue } = useMemo(
    () => ({ initials: initialsOf(from), hue: hueOf(from) }),
    [from],
  )
  const isLarge = variant === 'view'
  const box = isLarge ? 'size-11 rounded-xl text-[15px]' : 'size-8 rounded-lg text-[11.5px]'

  // Two tint strengths: resting is quiet ink on a dark wash of its own hue;
  // selected lifts the hue so the row reads as open without a green block.
  const style = isSelected
    ? { background: `hsl(${hue} 30% 26%)`, color: `hsl(${hue} 60% 92%)` }
    : { background: `hsl(${hue} 26% 17%)`, color: `hsl(${hue} 45% 76%)` }

  return (
    <div
      aria-hidden="true"
      className={`${box} shrink-0 flex items-center justify-center select-none font-semibold tracking-wide ${
        isLarge ? 'ring-1 ring-inset ring-white/5' : ''
      }`}
      style={style}
    >
      {initials}
    </div>
  )
}
