import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const status = vi.fn()
const start = vi.fn()
const confirm = vi.fn()
const disable = vi.fn()

vi.mock('@/api', () => ({
  userTwoFactorStatus: (...a) => status(...a),
  userTwoFactorStart: (...a) => start(...a),
  userTwoFactorConfirm: (...a) => confirm(...a),
  userTwoFactorDisable: (...a) => disable(...a),
}))

import TwoFactorSection from '@/components/TwoFactorSection'

const onStatus = { enabled: true, pending: false, enabled_at: 1793000000, recovery_codes_remaining: 7 }
const offStatus = { enabled: false, pending: false, enabled_at: 0, recovery_codes_remaining: 0 }

describe('TwoFactorSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    status.mockResolvedValue(offStatus)
  })

  it('shows the off state and offers setup', async () => {
    render(<TwoFactorSection />)
    await waitFor(() => expect(screen.getByText('off')).toBeTruthy())
    expect(screen.getByText('Set up two-factor')).toBeTruthy()
  })

  it('shows the on state with the remaining recovery codes', async () => {
    status.mockResolvedValue(onStatus)
    render(<TwoFactorSection />)
    await waitFor(() => expect(screen.getByText('on')).toBeTruthy())
    expect(screen.getByText(/7 recovery codes left/)).toBeTruthy()
    expect(screen.getByText('Turn off')).toBeTruthy()
  })

  it('start reveals the secret and does not enable until a code is entered', async () => {
    start.mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      otpauth_url: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP',
      recovery_codes: ['AAAAA-BBBBB'],
    })
    render(<TwoFactorSection />)
    await waitFor(() => expect(screen.getByText('Set up two-factor')).toBeTruthy())
    fireEvent.click(screen.getByText('Set up two-factor'))

    await waitFor(() => expect(screen.getByTestId('totp-secret')).toBeTruthy())
    expect(screen.getByTestId('totp-secret').textContent).toContain('JBSW Y3DP EHPK 3PXP')
    // the enable button stays disabled until six digits exist
    const submit = screen.getByText('Turn on')
    expect(submit.disabled).toBe(true)

    fireEvent.change(screen.getByPlaceholderText('123456'), { target: { value: '123456' } })
    expect(screen.getByText('Turn on').disabled).toBe(false)

    confirm.mockResolvedValue({ recovery_codes: ['AAAAA-BBBBB', 'CCCCC-DDDDD'] })
    fireEvent.click(screen.getByText('Turn on'))
    await waitFor(() => expect(screen.getByTestId('recovery-codes')).toBeTruthy())
    expect(screen.getByTestId('recovery-codes').textContent).toContain('CCCCC-DDDDD')
    expect(confirm).toHaveBeenCalledWith('123456')
  })

  it('surfaces a rejected code instead of pretending it worked', async () => {
    start.mockResolvedValue({ secret: 'AAAA', otpauth_url: 'otpauth://x', recovery_codes: [] })
    confirm.mockRejectedValue({ response: { data: { error: 'That code is not valid' } } })
    render(<TwoFactorSection />)
    await waitFor(() => expect(screen.getByText('Set up two-factor')).toBeTruthy())
    fireEvent.click(screen.getByText('Set up two-factor'))
    await waitFor(() => expect(screen.getByPlaceholderText('123456')).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('123456'), { target: { value: '000000' } })
    fireEvent.click(screen.getByText('Turn on'))
    await waitFor(() => expect(screen.getByTestId('two-factor-error').textContent).toBe('That code is not valid'))
  })

  it('disabling requires a code', async () => {
    status.mockResolvedValue(onStatus)
    render(<TwoFactorSection />)
    await waitFor(() => expect(screen.getByText('Turn off')).toBeTruthy())
    fireEvent.click(screen.getByText('Turn off'))
    const submit = screen.getByText('Turn off two-factor')
    expect(submit.disabled).toBe(true)

    disable.mockResolvedValue({ message: 'off' })
    status.mockResolvedValue(offStatus)
    fireEvent.change(screen.getByPlaceholderText('123456 or A1B2C-3D4E5'), { target: { value: '123456' } })
    fireEvent.click(screen.getByText('Turn off two-factor'))
    await waitFor(() => expect(disable).toHaveBeenCalledWith('123456'))
    await waitFor(() => expect(screen.getByText('Set up two-factor')).toBeTruthy())
  })
})
