import { useState } from 'react'
import { Lock, Loader2 } from 'lucide-react'
import { Modal, ModalHeader, ModalContent, ModalFooter } from '@/components/ui/Modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { decryptPrivateKey } from '@/crypto'
import { keySession } from '@/keySession'
import { storage } from '@/storage'
import { ensureStoredKey } from '@/lib/keyRecovery'

/**
 * Shown when the tab was reloaded (or reopened) and the private key is no longer
 * in the session. The key is deliberately never persisted in a recoverable form,
 * so the password is needed again — this is the prompt that makes that a small
 * step instead of a full logout.
 */
export function UnlockModal({ isOpen, onUnlocked }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const unlock = async () => {
    setError('')
    setBusy(true)
    try {
      await ensureStoredKey()
      const encrypted = storage.getEncryptedKey()
      const salt = keySession.getSalt() || storage.getLoginSalt()
      if (!encrypted || !salt) {
        setError('This session cannot be unlocked — please log in again')
        return
      }
      const key = await decryptPrivateKey(encrypted, password, salt)
      await keySession.set(key)
      setPassword('')
      onUnlocked()
    } catch {
      setError('That password did not unlock the mailbox')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={() => {}}>
      <ModalHeader title="Unlock mailbox" onClose={() => {}} />
      <ModalContent>
        <p className="text-sm text-foreground/70">
          Your messages are decrypted in this browser only. After closing or reloading
          the tab, enter your password once to unlock them again.
        </p>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && password) unlock()
          }}
          placeholder="Password"
          autoComplete="current-password"
          autoFocus
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
      </ModalContent>
      <ModalFooter>
        <Button size="sm" onClick={unlock} disabled={busy || !password}>
          {busy ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Lock className="w-3.5 h-3.5 mr-1.5" />}
          Unlock
        </Button>
      </ModalFooter>
    </Modal>
  )
}
