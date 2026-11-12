import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const userRecoveryKeyStatus = vi.fn()
vi.mock('@/api', () => ({ userRecoveryKeyStatus: (...a) => userRecoveryKeyStatus(...a) }))

const getKey = vi.fn()
vi.mock('@/keySession', () => ({ keySession: { get: () => getKey() } }))
vi.mock('@/storage', () => ({ storage: { getUsername: () => 'tibs' } }))

import RecoveryKeySection from '@/components/RecoveryKeySection'

describe('recovery key settings section', () => {
  beforeEach(() => {
    userRecoveryKeyStatus.mockReset()
    getKey.mockReset()
  })

  it('warns when the account has no recovery key', async () => {
    userRecoveryKeyStatus.mockResolvedValue({ set: false, set_at: 0, used_at: 0 })
    render(<RecoveryKeySection />)
    expect(await screen.findByText(/no recovery key/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /create recovery key/i })).toBeTruthy()
  })

  it('shows when a recovery key was set, and offers to replace it', async () => {
    userRecoveryKeyStatus.mockResolvedValue({ set: true, set_at: 1793050000, used_at: 0 })
    render(<RecoveryKeySection />)
    expect(await screen.findByText(/set /i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /replace recovery key/i })).toBeTruthy()
  })

  it('says to create a new one when the old key has been used', async () => {
    userRecoveryKeyStatus.mockResolvedValue({ set: true, set_at: 1793050000, used_at: 1793060000 })
    render(<RecoveryKeySection />)
    expect(await screen.findByText(/last used/i)).toBeTruthy()
  })

  it('refuses to start when the mailbox is locked', async () => {
    userRecoveryKeyStatus.mockResolvedValue({ set: false, set_at: 0, used_at: 0 })
    getKey.mockResolvedValue(null)
    render(<RecoveryKeySection />)
    const button = await screen.findByRole('button', { name: /create recovery key/i })
    fireEvent.click(button)
    expect(await screen.findByText(/unlock your mailbox first/i)).toBeTruthy()
  })

  it('opens the setup screen when a private key is available', async () => {
    userRecoveryKeyStatus.mockResolvedValue({ set: false, set_at: 0, used_at: 0 })
    getKey.mockResolvedValue({ fake: 'key' })
    render(<RecoveryKeySection />)
    fireEvent.click(await screen.findByRole('button', { name: /create recovery key/i }))
    await waitFor(() => expect(screen.getByText(/save your recovery key/i)).toBeTruthy())
  })

  it('reports a status failure instead of silently showing nothing', async () => {
    userRecoveryKeyStatus.mockRejectedValue({ response: { data: { error: 'Unauthorized' } } })
    render(<RecoveryKeySection />)
    expect(await screen.findByText(/unauthorized/i)).toBeTruthy()
  })
})
