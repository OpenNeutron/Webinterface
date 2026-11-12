import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useState } from 'react'

// Reproduced against a local server before the fix: deleting a message from Sent posted
// /email/delete, the server answered 404 "Email not found" (it only looks in received
// mail), and the app's `catch {}` left the row on screen with nothing said.

const post = vi.fn()
vi.mock('@/api', () => ({ default: { post: (...args) => post(...args) } }))
const toast = vi.fn()
vi.mock('@/lib/toast', () => ({ toast: (...args) => toast(...args) }))

import { deleteEndpoint } from '@/lib/deleteMessage'
import { useEmailActions } from '@/hooks/useEmailActions'

const SENT = '79077153517879815893541103082182958680'
const INBOX = '11111111111111111111111111111111111111'

function useHarness() {
  const [uids, setUids] = useState([INBOX])
  const [sentUids, setSentUids] = useState([SENT])
  const [previews, setPreviews] = useState({ [INBOX]: {}, [SENT]: {} })
  const [emailMeta, setEmailMeta] = useState({})
  const [selectedUid, setSelectedUid] = useState(SENT)
  const [groups, setGroups] = useState([])
  const actions = useEmailActions({ emailMeta, setEmailMeta, setUids, setPreviews, setSelectedUid, setGroups, groups, sentUids, setSentUids })
  return { actions, uids, sentUids, previews, selectedUid, emailMeta }
}

beforeEach(() => {
  post.mockReset()
  toast.mockReset()
})

describe('which delete a message needs', () => {
  it('a sent copy goes to the sent delete, anything else to the inbox delete', () => {
    expect(deleteEndpoint(SENT, [SENT])).toBe('/email/sent/delete')
    expect(deleteEndpoint(BigInt(SENT), [SENT])).toBe('/email/sent/delete')
    expect(deleteEndpoint(INBOX, [SENT])).toBe('/email/delete')
    expect(deleteEndpoint(INBOX)).toBe('/email/delete')
  })
})

describe('deleting from Sent', () => {
  it('posts the sent delete with the uid as a string, and the row leaves Sent', async () => {
    post.mockResolvedValue({ data: { message: 'Email deleted' } })
    const { result } = renderHook(() => useHarness())
    let ok
    await act(async () => { ok = await result.current.actions.deleteEmail(SENT) })
    expect(ok).toBe(true)
    expect(post).toHaveBeenCalledWith('/email/sent/delete', `{"uid":"${SENT}"}`, expect.anything())
    expect(result.current.sentUids).toEqual([])
    expect(result.current.previews[SENT]).toBeUndefined()
    expect(result.current.selectedUid).toBe(null)
    expect(result.current.uids).toEqual([INBOX])
  })

  it('a refused delete keeps the row and says so', async () => {
    post.mockRejectedValue(Object.assign(new Error('404'), { response: { status: 404 } }))
    const { result } = renderHook(() => useHarness())
    let ok
    await act(async () => { ok = await result.current.actions.deleteEmail(SENT) })
    expect(ok).toBe(false)
    expect(result.current.sentUids).toEqual([SENT])
    expect(result.current.selectedUid).toBe(SENT)
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/not deleted/))
  })

  it('a mixed selection deletes each from its own list and returns what failed', async () => {
    post.mockImplementation(async (url) => {
      if (url === '/email/delete') throw new Error('refused')
      return { data: {} }
    })
    const { result } = renderHook(() => useHarness())
    let outcome
    await act(async () => { outcome = await result.current.actions.deleteMany([SENT, INBOX]) })
    expect(outcome).toEqual({ gone: [SENT], failed: [INBOX] })
    expect(result.current.sentUids).toEqual([])
    expect(result.current.uids).toEqual([INBOX])
  })
})

describe('no more silent refusals', () => {
  it('a refused star is put back and named', async () => {
    post.mockRejectedValue(new Error('refused'))
    const { result } = renderHook(() => useHarness())
    await act(async () => { await result.current.actions.toggleStar(INBOX) })
    expect(result.current.emailMeta[INBOX]?.starred).toBe(false)
    expect(toast).toHaveBeenCalledWith('Could not star that message.')
  })

  it('a refused read mark is put back', async () => {
    post.mockRejectedValue(new Error('refused'))
    const { result } = renderHook(() => useHarness())
    await act(async () => { await result.current.actions.markRead(INBOX) })
    expect(result.current.emailMeta[INBOX]?.unread).toBe(true)
  })
})
