import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/api', () => ({ userDeleteAccount: vi.fn(async () => ({ message: 'Account deleted' })) }))
vi.mock('@/crypto', () => ({ hashPassword: vi.fn(async () => 'hashed-token') }))

import DeleteAccountSection from '@/components/DeleteAccountSection'
import { userDeleteAccount } from '@/api'

describe('DeleteAccountSection', () => {
  it('stays behind a button until opened', () => {
    render(<DeleteAccountSection />)
    expect(screen.queryByPlaceholderText('Type DELETE to confirm')).toBeNull()
    fireEvent.click(screen.getByText('Delete account…'))
    expect(screen.getByPlaceholderText('Type DELETE to confirm')).toBeTruthy()
  })

  it('refuses to delete without the typed confirmation', async () => {
    render(<DeleteAccountSection />)
    fireEvent.click(screen.getByText('Delete account…'))
    fireEvent.change(screen.getByPlaceholderText('Your password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByText('Permanently delete'))
    expect(await screen.findByText('Type DELETE to confirm')).toBeTruthy()
    expect(userDeleteAccount).not.toHaveBeenCalled()
  })

  it('calls the API once DELETE is typed', async () => {
    render(<DeleteAccountSection />)
    fireEvent.click(screen.getByText('Delete account…'))
    fireEvent.change(screen.getByPlaceholderText('Your password'), { target: { value: 'pw' } })
    fireEvent.change(screen.getByPlaceholderText('Type DELETE to confirm'), { target: { value: 'delete' } })
    fireEvent.click(screen.getByText('Permanently delete'))
    await vi.waitFor(() => expect(userDeleteAccount).toHaveBeenCalledWith('hashed-token'))
  })
})
