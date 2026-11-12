import { useEffect, useState } from 'react'
import { Sun, Moon, Monitor, Rows3, Rows4, Check } from 'lucide-react'
import { readTheme, setTheme, readDensity, setDensity } from '@/lib/appearance'

function Choice({ active, onClick, children, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[12.5px] transition-colors duration-120 ${
        active
          ? 'border-primary bg-primary/15 text-ink-1'
          : 'border-line-strong text-ink-2 hover:border-ink-4 hover:text-ink-1'
      }`}
      title={label}
    >
      {children}
      {active && <Check className="ml-1 size-3.5 text-primary" strokeWidth={3} />}
    </button>
  )
}

export default function AppearanceSection() {
  const [theme, setThemeChoice] = useState(readTheme)
  const [density, setDensityChoice] = useState(readDensity)

  useEffect(() => {
    const sync = () => {
      setThemeChoice(readTheme())
      setDensityChoice(readDensity())
    }
    window.addEventListener('sloth:appearance', sync)
    return () => window.removeEventListener('sloth:appearance', sync)
  }, [])

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-[12.5px] font-medium text-ink-1">Theme</p>
        <div className="flex flex-wrap gap-2">
          <Choice active={theme === 'dark'} onClick={() => setTheme('dark')} label="Dark">
            <Moon className="size-3.5" /> Dark
          </Choice>
          <Choice active={theme === 'light'} onClick={() => setTheme('light')} label="Light">
            <Sun className="size-3.5" /> Light
          </Choice>
          <Choice active={theme === 'system'} onClick={() => setTheme('system')} label="Follow the system">
            <Monitor className="size-3.5" /> Follow system
          </Choice>
        </div>
        <p className="mt-2 text-[12px] text-ink-3">
          Dark is the default. Nothing about mail changes with the theme — only the ground it sits on.
        </p>
      </div>

      <div>
        <p className="mb-2 text-[12.5px] font-medium text-ink-1">Row density</p>
        <div className="flex flex-wrap gap-2">
          <Choice
            active={density === 'comfortable'}
            onClick={() => setDensity('comfortable')}
            label="Comfortable"
          >
            <Rows3 className="size-3.5" /> Comfortable
          </Choice>
          <Choice active={density === 'compact'} onClick={() => setDensity('compact')} label="Compact">
            <Rows4 className="size-3.5" /> Compact
          </Choice>
        </div>
        <p className="mt-2 text-[12px] text-ink-3">
          Compact drops the preview line and tightens each row. Sender, subject and time stay.
        </p>
      </div>
    </div>
  )
}
