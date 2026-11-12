import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { ChangePasswordModal } from '@/components/ChangePasswordModal'

export default function PasswordSection() {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <p className="text-[12.5px] leading-relaxed text-ink-2">
        Your password unlocks this account and the key that decrypts your mail. Changing it re-wraps
        that key — your messages are not re-encrypted, and nothing becomes unreadable.
      </p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 inline-flex items-center gap-2 rounded-lg border border-line-strong px-3 py-2 text-[12.5px] text-ink-2 transition-colors duration-120 hover:border-line-strong hover:text-ink-1"
      >
        <KeyRound className="size-3.5" /> Change password
      </button>
      <ChangePasswordModal isOpen={open} onClose={() => setOpen(false)} />
    </div>
  )
}
