import { useEffect, useState } from 'react'
import { User, Check } from 'lucide-react'
import { loadProfile, saveProfile } from '@/lib/profile'

// Display name and signature live on the device, not on the server: the point
// of this mailbox is that the server stores as little as possible about you.
export default function ProfileSection() {
  const [displayName, setDisplayName] = useState('')
  const [signature, setSignature] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const p = loadProfile()
    setDisplayName(p.displayName)
    setSignature(p.signature)
  }, [])

  function save() {
    saveProfile({ displayName, signature })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    // Settings already puts each section in a card under its own title; a second card and a
    // second heading inside it said the same thing twice.
    <section>
      <p className="mb-3 flex items-center gap-1.5 text-xs text-ink-3">
        <User size={13} className="shrink-0" aria-hidden="true" />
        Stored on this device only.
      </p>

      <label className="mb-1 block text-xs text-ink-2" htmlFor="profile-name">
        Display name
      </label>
      <input
        id="profile-name"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        placeholder="Your name"
        className="mb-3 w-full rounded-lg border border-line-strong bg-field px-3 py-2 text-sm text-ink-1 outline-none focus:border-line-strong"
      />

      <label className="mb-1 block text-xs text-ink-2" htmlFor="profile-signature">
        Signature
      </label>
      <textarea
        id="profile-signature"
        value={signature}
        onChange={(e) => setSignature(e.target.value)}
        placeholder="— sent from Sloth Lee Mail"
        rows={3}
        className="mb-3 w-full resize-none rounded-lg border border-line-strong bg-field px-3 py-2 text-sm text-ink-1 outline-none focus:border-line-strong sm:resize-y"
      />

      <button
        onClick={save}
        type="button"
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 max-sm:min-h-11"
      >
        {saved ? <Check size={14} /> : null}
        {saved ? 'Saved' : 'Save'}
      </button>
    </section>
  )
}
