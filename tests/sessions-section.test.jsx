import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const listSessions = vi.fn()
const revoke = vi.fn()
const revokeAll = vi.fn()

vi.mock('@/api', () => ({
  userSessions: (...a) => listSessions(...a),
  userRevokeSession: (...a) => revoke(...a),
  userRevokeAllSessions: (...a) => revokeAll(...a),
}))

import SessionsSection, { describeAgent, describeWhen } from '@/components/SessionsSection'

const now = 1_800_000_000_000

const rows = [
  { id: 'aaa', current: true, user_agent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/131', ip: '1.2.3.4', created_at: now / 1000 - 600, last_seen_at: now / 1000 - 5 },
  { id: 'bbb', current: false, user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604.1', ip: '5.6.7.8', created_at: now / 1000 - 90000, last_seen_at: now / 1000 - 7200 },
]

describe('agent and time labels', () => {
  it('names the browser and platform', () => {
    expect(describeAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/131')).toBe('Chrome on Windows')
    expect(describeAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604.1')).toBe('Safari on iOS')
    expect(describeAgent('Mozilla/5.0 (X11; Linux x86_64) Firefox/133')).toBe('Firefox on Linux')
    expect(describeAgent('')).toBe('Unknown device')
  })

  it('describes freshness', () => {
    expect(describeWhen(now / 1000 - 10, now)).toBe('just now')
    expect(describeWhen(now / 1000 - 600, now)).toBe('10 min ago')
    expect(describeWhen(now / 1000 - 7200, now)).toBe('2 h ago')
    expect(describeWhen(now / 1000 - 172800, now)).toBe('2 d ago')
  })
})

describe('SessionsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listSessions.mockResolvedValue({ sessions: rows, count: rows.length })
  })

  it('lists devices and marks the current one', async () => {
    render(<SessionsSection />)
    await waitFor(() => expect(screen.getAllByTestId('session-row')).toHaveLength(2))
    expect(screen.getByText('this device')).toBeTruthy()
    // the current row offers no sign-out button; the other one does
    expect(screen.getAllByText('Sign out')).toHaveLength(1)
    expect(screen.getByText(/Chrome on Windows/)).toBeTruthy()
    expect(screen.getByText(/Safari on iOS/)).toBeTruthy()
  })

  it('signs a single device out and reloads the list', async () => {
    revoke.mockResolvedValue({ message: 'Signed out', current: false })
    listSessions
      .mockResolvedValueOnce({ sessions: rows, count: 2 })
      .mockResolvedValueOnce({ sessions: [rows[0]], count: 1 })
    render(<SessionsSection />)
    await waitFor(() => expect(screen.getAllByTestId('session-row')).toHaveLength(2))
    fireEvent.click(screen.getByText('Sign out'))
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('bbb'))
    await waitFor(() => expect(screen.getAllByTestId('session-row')).toHaveLength(1))
  })

  it('confirms before signing out everywhere', async () => {
    revokeAll.mockResolvedValue({ message: 'ok', revoked: 2 })
    render(<SessionsSection />)
    await waitFor(() => expect(screen.getByText('Sign out everywhere')).toBeTruthy())
    expect(revokeAll).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Sign out everywhere'))
    expect(screen.getByText(/including this one/)).toBeTruthy()
    fireEvent.click(screen.getByText('Yes, sign out all'))
    await waitFor(() => expect(revokeAll).toHaveBeenCalled())
  })

  it('reports a failure instead of silently dropping the row', async () => {
    revoke.mockRejectedValue({ response: { data: { error: 'That session is no longer signed in' } } })
    render(<SessionsSection />)
    await waitFor(() => expect(screen.getAllByTestId('session-row')).toHaveLength(2))
    fireEvent.click(screen.getByText('Sign out'))
    await waitFor(() => expect(screen.getByTestId('sessions-error').textContent).toBe('That session is no longer signed in'))
    expect(screen.getAllByTestId('session-row')).toHaveLength(2)
  })
})
