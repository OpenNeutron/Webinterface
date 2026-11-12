import { useState } from 'react'
import { Modal, ModalHeader, ModalContent, ModalFooter } from '@/components/ui/Modal'
import { Button } from '@/components/ui/button'
import { cleanAddresses } from '@/hooks/useGroupActions'

/**
 * A group's sender rules: one address per line. Mail from any of them is filed into the group
 * as it arrives (the server matches the From address and the envelope sender). Saving also files
 * the messages from those senders that are already loaded here.
 */
export function SenderRulesModal({ isOpen, group, onSave, onClose }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      {/* Keyed, so each opening starts from the group's saved rules. */}
      {group && <RulesForm key={group.uid} group={group} onSave={onSave} onClose={onClose} />}
    </Modal>
  )
}

function RulesForm({ group, onSave, onClose }) {
  const [text, setText] = useState(() => (group?.filter_addresses ?? []).join('\n'))

  const lines = text.split(/[\n,;]+/).map((line) => line.trim()).filter(Boolean)
  const addresses = cleanAddresses(lines)
  const rejected = lines.filter((line) => !cleanAddresses([line]).length)

  return (
    <>
      <ModalHeader title={`Sender rules — ${group?.title ?? ''}`} onClose={onClose} />
      <ModalContent>
        <p className="text-[13px] leading-relaxed text-ink-2">
          Mail from these addresses is filed in <span className="text-ink-1">{group?.title}</span> as it arrives.
          It stays in the inbox too. One address per line.
        </p>
        <textarea
          autoFocus
          aria-label="Sender addresses, one per line"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder={'alerts@example.com\nnewsletter@example.org'}
          className="w-full resize-y rounded-md border border-border bg-input px-3 py-2 font-mono text-[13px] text-foreground outline-none focus:ring-2 focus:ring-ring/50 placeholder:text-muted-foreground/60"
        />
        {rejected.length > 0 && (
          <p className="text-[12px] text-sand" role="status">
            Not an address, so it will be left out: {rejected.slice(0, 3).join(', ')}{rejected.length > 3 ? '…' : ''}
          </p>
        )}
      </ModalContent>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={() => onSave(addresses)}>
          {addresses.length ? `Save ${addresses.length} rule${addresses.length === 1 ? '' : 's'}` : 'Remove all rules'}
        </Button>
      </ModalFooter>
    </>
  )
}
