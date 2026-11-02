import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// A recovery key made before 2026-11-02T06:20Z carries the RSA key only. A recovered
// account would sign in and then find every message sealed since then unreadable, with
// nothing on the screen explaining why. The section has to say it before that happens.

vi.mock('@/api', () => ({
  userRecoveryKeyStatus: vi.fn(),
}))

vi.mock('@/components/RecoveryKeySetup', () => ({
  default: () => <div data-testid="recovery-setup" />,
}))

import { userRecoveryKeyStatus } from '@/api'
import RecoveryKeySection from '@/components/RecoveryKeySection'

const respond = (status) => {
  userRecoveryKeyStatus.mockResolvedValue(status)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('recovery key section', () => {
  it('warns when the stored key predates quantum protection', async () => {
    respond({ set: true, set_at: 1761782400, used_at: 0 }) // 2025-10-30, before the format change
    render(<RecoveryKeySection />)

    expect(await screen.findByText(/before recovery covered your quantum key/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /replace recovery key/i })).toBeInTheDocument()
  })

  it('says nothing extra for a key made after the change', async () => {
    respond({ set: true, set_at: 1793664000, used_at: 0 }) // 2026-11-03, after it
    render(<RecoveryKeySection />)

    expect(await screen.findByText(/^Set /)).toBeInTheDocument()
    expect(screen.queryByText(/before recovery covered your quantum key/i)).toBe(null)
  })

  it('still says there is no key when there is none', async () => {
    respond({ set: false, set_at: 0, used_at: 0 })
    render(<RecoveryKeySection />)

    expect(await screen.findByText(/No recovery key/i)).toBeInTheDocument()
  })
})
