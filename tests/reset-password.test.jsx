import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const resetWithToken = vi.fn()
vi.mock('@/api', () => ({ resetWithToken: (...args) => resetWithToken(...args) }))
vi.mock('@/crypto', () => ({ hashPassword: async (pw) => `$2a$10$fakehashfor${pw.length}` }))

import ResetPassword from '@/components/ResetPassword'

const renderPage = (token = 'a'.repeat(64)) =>
  render(
    <MemoryRouter initialEntries={[`/reset?t=${token}`]}>
      <ResetPassword />
    </MemoryRouter>
  )

describe('password reset page', () => {
  beforeEach(() => { resetWithToken.mockClear(); resetWithToken.mockImplementation(async () => ({ ok: true })) })

  it('refuses a short password without calling the server', async () => {
    renderPage()
    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'short' } })
    fireEvent.change(screen.getByLabelText(/repeat password/i), { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: /set new password/i }))

    expect(await screen.findByText(/at least 8 characters/i)).toBeTruthy()
    expect(resetWithToken).not.toHaveBeenCalled()
  })

  it('refuses mismatched passwords', async () => {
    renderPage()
    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'correct horse battery' } })
    fireEvent.change(screen.getByLabelText(/repeat password/i), { target: { value: 'correct horse batteru' } })
    fireEvent.click(screen.getByRole('button', { name: /set new password/i }))

    expect(await screen.findByText(/do not match/i)).toBeTruthy()
    expect(resetWithToken).not.toHaveBeenCalled()
  })

  it('sends the hashed password with the token and confirms', async () => {
    resetWithToken.mockResolvedValue({ message: 'ok' })
    renderPage('b'.repeat(64))

    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'a proper long password' } })
    fireEvent.change(screen.getByLabelText(/repeat password/i), { target: { value: 'a proper long password' } })
    fireEvent.click(screen.getByRole('button', { name: /set new password/i }))

    await waitFor(() => expect(resetWithToken).toHaveBeenCalledTimes(1))
    const [token, credentials] = resetWithToken.mock.calls[0]
    expect(token).toBe('b'.repeat(64))
    expect(credentials).toMatch(/^\$2a\$10\$/)
    expect(await screen.findByText(/your password is set/i)).toBeTruthy()
  })

  it('shows the server reason when the token is rejected', async () => {
    resetWithToken.mockRejectedValue({ response: { data: { error: 'That reset link is invalid or has expired' } } })
    renderPage()

    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'a proper long password' } })
    fireEvent.change(screen.getByLabelText(/repeat password/i), { target: { value: 'a proper long password' } })
    fireEvent.click(screen.getByRole('button', { name: /set new password/i }))

    await waitFor(() => expect(screen.getByText(/invalid or has expired/i)).toBeTruthy(), { timeout: 2000 })
  })

  it('does not submit at all without a token in the URL', async () => {
    render(
      <MemoryRouter initialEntries={['/reset']}>
        <ResetPassword />
      </MemoryRouter>
    )
    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'a proper long password' } })
    fireEvent.change(screen.getByLabelText(/repeat password/i), { target: { value: 'a proper long password' } })
    fireEvent.click(screen.getByRole('button', { name: /set new password/i }))

    expect(await screen.findByText(/missing its code/i)).toBeTruthy()
    expect(resetWithToken).not.toHaveBeenCalled()
  })
})
