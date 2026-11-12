import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { KeyRound, Timer, EyeOff } from 'lucide-react'
import SlothMark from '@/components/SlothMark'

const FACTS = [
  {
    icon: KeyRound,
    title: 'The key never leaves your device',
    body: 'Your mail is encrypted with a key generated in this browser. The server stores ciphertext it cannot open.',
  },
  {
    icon: Timer,
    title: 'Notes that close behind you',
    body: 'Send something that deletes itself on first read, on a timer, or with a passphrase.',
  },
  {
    icon: EyeOff,
    title: 'No ads, no tracking, no reading',
    body: 'No analytics scripts, no pixels in your mail, nothing sold to anyone. Ever.',
  },
]

/**
 * One shell for every door into the app: sign in, sign up, reset, recover.
 *
 * The left half says what this service is and why it is worth a password; the
 * right half is the one thing you came to do. On a phone the left half reduces to
 * the wordmark — a claim is not worth a screen you have to scroll past.
 */
export default function AuthShell({ children, aside = true }) {
  return (
    <div className="auth-scope grid min-h-screen md:grid-cols-[1.02fr_1fr]">
      {aside && (
        <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-line px-12 py-10 md:flex">
          {/* The only decoration in the app: light through a canopy. It carries
              no information, so it is flat, static, and sits behind everything. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(760px_420px_at_18%_-8%,color-mix(in_srgb,var(--color-primary)_16%,transparent),transparent_62%),radial-gradient(620px_380px_at_96%_12%,color-mix(in_srgb,var(--color-sand)_13%,transparent),transparent_60%)]"
          />

          <div className="relative flex items-center gap-2.5">
            <SlothMark className="size-7" />
            <span className="display text-[19px] text-ink-1">
              Sloth <span className="text-sand">Lee</span>
            </span>
          </div>

          <div className="relative flex-1 flex flex-col justify-center max-w-[46ch]">
            <h1 className="display text-[32px] leading-[1.14] text-ink-1">
              Mail that stays yours.
            </h1>
            <p className="mt-3 max-w-[36ch] text-[13.5px] leading-relaxed text-ink-2">
              A mailbox where the encryption happens on your device, not on our server.
            </p>

            <ul className="mt-9 space-y-5">
              {FACTS.map(({ icon: Icon, title, body }) => (
                <li key={title} className="flex gap-3">
                  <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                  <div>
                    <p className="text-[12.5px] font-medium text-ink-1">{title}</p>
                    <p className="mt-0.5 max-w-[42ch] text-[12px] leading-relaxed text-ink-3">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <p className="relative mono text-[11px] text-ink-4">slothlee.xyz</p>
        </aside>
      )}

      <main className="flex flex-col justify-center px-5 py-10 sm:px-8">
        <div className="mx-auto w-full max-w-[352px]">
          {/* Phone: the wordmark, once, at the top of the form. */}
          <div className="mb-8 flex items-center gap-2.5 md:hidden">
            <SlothMark className="size-6" />
            <span className="display text-[17px] text-ink-1">
              Sloth <span className="text-sand">Lee</span>
            </span>
          </div>

          {children}
        </div>
      </main>
    </div>
  )
}

/** A password field with a way to read what you typed. */
export function PasswordInput({ id, value, onChange, placeholder = '••••••••', ...rest }) {
  const [shown, setShown] = useState(false)
  return (
    <div className="relative">
      <Input
        id={id}
        type={shown ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="pr-16"
        {...rest}
      />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? 'Hide password' : 'Show password'}
        className="pw-toggle absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-[11px] text-ink-3 transition-colors duration-120 hover:text-ink-1"
      >
        {shown ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}

/** A labelled field, so every auth screen lines up the same way. */
export function Field({ label, id, hint, children }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[12px] font-medium text-ink-2">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-3">{hint}</p>}
    </div>
  )
}
