import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChangePasswordModal } from '@/components/ChangePasswordModal'

beforeEach(() => { localStorage.clear() })

describe('changing a forgotten password', () => {
  it('offers the recovery path and does not demand the old password', async () => {
    const user = userEvent.setup()
    render(<ChangePasswordModal isOpen onClose={() => {}} />)

    expect(screen.getByPlaceholderText('Current password')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /don't know my current password/i }))

    // The old-password field is gone, replaced by an honest warning.
    expect(screen.queryByPlaceholderText('Current password')).toBe(null)
    expect(screen.getByText(/can set a new password without the old one/i)).toBeInTheDocument()

    // With a new password and confirmation, submit becomes possible without the old one.
    await user.type(screen.getByPlaceholderText('New password'), 'brand new pass')
    await user.type(screen.getByPlaceholderText('Confirm new password'), 'brand new pass')
    const submit = screen.getByRole('button', { name: /change password/i })
    expect(submit).not.toBeDisabled()
  }, 20000)
})
