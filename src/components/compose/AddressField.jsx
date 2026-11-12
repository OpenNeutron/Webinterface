import { useState, useRef, useCallback } from 'react'
import { X } from 'lucide-react'
import { isValidEmail } from '@/lib/utils'
import { addressBook } from '@/addressBook'

function Chip({ addr, onRemove }) {
  const valid = isValidEmail(addr)
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-sm max-w-[220px] truncate border ${
        valid
          ? 'bg-primary/10 border-primary/25 text-foreground/90'
          : 'bg-destructive/10 border-destructive/30 text-destructive'
      }`}
      title={addr}
    >
      <span className="truncate">{addr}</span>
      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  )
}

export function AddressField({ label, chips, onChipsChange }) {
  const [inputVal, setInputVal] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [activeSuggestion, setActiveSuggestion] = useState(-1)
  const inputRef = useRef(null)

  const commit = useCallback(
    (raw) => {
      const val = raw.trim().replace(/,+$/, '').trim()
      if (!val) return
      onChipsChange([...chips, val])
      setInputVal('')
      setSuggestions([])
      setActiveSuggestion(-1)
    },
    [chips, onChipsChange],
  )

  const handleKeyDown = (e) => {
    if (suggestions.length > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      setActiveSuggestion((prev) =>
        e.key === 'ArrowDown'
          ? Math.min(prev + 1, suggestions.length - 1)
          : Math.max(prev - 1, 0)
      )
      return
    }
    if (suggestions.length > 0 && e.key === 'Escape') {
      setSuggestions([])
      setActiveSuggestion(-1)
      return
    }
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      if (activeSuggestion >= 0 && suggestions[activeSuggestion]) {
        commit(suggestions[activeSuggestion].email)
      } else {
        commit(inputVal)
      }
    } else if (e.key === 'Tab' && inputVal.trim()) {
      e.preventDefault()
      if (activeSuggestion >= 0 && suggestions[activeSuggestion]) {
        commit(suggestions[activeSuggestion].email)
      } else {
        commit(inputVal)
      }
    } else if (e.key === 'Backspace' && inputVal === '' && chips.length > 0) {
      onChipsChange(chips.slice(0, -1))
    }
  }

  const handlePaste = (e) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text')
    const parts = pasted.split(/[,;\s\n]+/).filter(Boolean)
    if (parts.length > 1) {
      onChipsChange([...chips, ...parts])
    } else {
      setInputVal((prev) => prev + pasted)
      setSuggestions(addressBook.search(pasted))
      setActiveSuggestion(-1)
    }
  }

  return (
    <div
      className="relative flex flex-wrap items-center gap-1 px-3 py-1.5 min-h-[34px] border-b border-border/60 cursor-text"
      onClick={() => inputRef.current?.focus()}
    >
      <span className="text-xs font-semibold text-foreground/40 w-7 shrink-0">{label}</span>
      {chips.map((addr, i) => (
        <Chip
          key={i}
          addr={addr}
          onRemove={() => onChipsChange(chips.filter((_, j) => j !== i))}
        />
      ))}
      <input
        ref={inputRef}
        type="text"
        value={inputVal}
        onChange={(e) => {
          const val = e.target.value
          setInputVal(val)
          const hits = val.trim() ? addressBook.search(val) : []
          setSuggestions(hits)
          setActiveSuggestion(-1)
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          commit(inputVal)
          setTimeout(() => { setSuggestions([]); setActiveSuggestion(-1) }, 150)
        }}
        onPaste={handlePaste}
        className="flex-1 min-w-[80px] bg-transparent outline-none text-sm text-foreground placeholder:text-foreground/30 max-sm:min-h-11"
        placeholder={chips.length === 0 ? 'Email address…' : ''}
      />
      {suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-50 bg-popover border border-border rounded-md shadow-lg mt-0.5 overflow-hidden">
          {suggestions.map((s, i) => (
            <button
              key={s.email}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); commit(s.email) }}
              className={`w-full text-left px-3 py-1.5 text-sm flex items-baseline gap-2 ${
                i === activeSuggestion ? 'bg-accent text-foreground' : 'hover:bg-accent/60 text-foreground/80'
              }`}
            >
              {s.name && s.name !== s.email ? (
                <>
                  <span className="font-medium text-foreground">{s.name}</span>
                  <span className="text-foreground/50 text-xs truncate">{s.email}</span>
                </>
              ) : (
                <span>{s.email}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
