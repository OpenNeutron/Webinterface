import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useState } from 'react'

// Reproduced against a local server before the fix: deleting a message from Sent posted
// /email/delete, the server answered 404 "Email not found" (it only looks in received
// mail), and the app's `catch {}` left the row on screen with nothing said.
// Since then, Delete moves to Trash (with Undo) for every folder; only Trash deletes for good.

const post = vi.fn()
vi.mock('@/api', () => ({ default: { post: (...args) => post(...args) } }))
const toast = vi.fn()
vi.mock('@/lib/toast', () => ({ toast: (...args) => toast(...args) }))

import { deleteEndpoint, isMissingRoute } from '@/lib/deleteMessage'
import { useEmailActions } from '@/hooks/useEmailActions'
import { useTrash } from '@/hooks/useTrash'

const SENT = '79077153517879815893541103082182958680'
const INBOX = '11111111111111111111111111111111111111'

function useHarness({ onRestored = vi.fn() } = {}) {
  const [uids, setUids] = useState([INBOX])
  const [sentUids, setSentUids] = useState([SENT])
  const [previews, setPreviews] = useState({ [INBOX]: {}, [SENT]: {} })
  const [emailMeta, setEmailMeta] = useState({})
  const [selectedUid, setSelectedUid] = useState(SENT)
  const [groups, setGroups] = useState([])
  const [trashed, setTrashed] = useState([])
  const actions = useEmailActions({
    emailMeta, setEmailMeta, setUids, setPreviews, setSelectedUid, setGroups, groups, setSentUids,
    onTrashed: (moved) => setTrashed((prev) => [...prev, ...moved]), onRestored,
  })
  return { actions, uids, sentUids, previews, selectedUid, emailMeta, trashed }
}

beforeEach(() => {
  post.mockReset()
  toast.mockReset()
})

describe('which permanent delete a message needs', () => {
  it('a sent copy goes to the sent delete, anything else to the inbox delete', () => {
    expect(deleteEndpoint(SENT, [SENT])).toBe('/email/sent/delete')
    expect(deleteEndpoint(BigInt(SENT), [SENT])).toBe('/email/sent/delete')
    expect(deleteEndpoint(INBOX, [SENT])).toBe('/email/delete')
  })

  it('a missing route is told apart from a missing message', () => {
    expect(isMissingRoute({ response: { status: 404, data: { code: 'not_found' } } })).toBe(true)
    expect(isMissingRoute({ response: { status: 404, data: { code: 'email_not_found' } } })).toBe(false)
  })
})

describe('Delete moves to Trash, from any folder', () => {
  it('a sent message moves to Trash, leaves Sent, and offers Undo', async () => {
    post.mockResolvedValue({ data: { message: 'Moved to trash', kind: 'sent' } })
    const { result } = renderHook(() => useHarness())
    let ok
    await act(async () => { ok = await result.current.actions.deleteEmail(SENT) })
    expect(ok).toBe(true)
    expect(post).toHaveBeenCalledWith('/email/trash', `{"uid":"${SENT}"}`, expect.anything())
    expect(result.current.sentUids).toEqual([])
    expect(result.current.selectedUid).toBe(null)
    expect(result.current.trashed).toEqual([expect.objectContaining({ uid: SENT, kind: 'sent' })])
    expect(toast).toHaveBeenCalledWith('Moved to Trash.', expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) }))
  })

  it('Undo restores and reloads the folders', async () => {
    const onRestored = vi.fn()
    post.mockResolvedValue({ data: { kind: 'inbox' } })
    const { result } = renderHook(() => useHarness({ onRestored }))
    await act(async () => { await result.current.actions.deleteEmail(INBOX) })
    const undo = toast.mock.calls.at(-1)[1].action.run
    await act(async () => { await undo() })
    expect(post).toHaveBeenLastCalledWith('/email/restore', `{"uid":"${INBOX}"}`, expect.anything())
    expect(onRestored).toHaveBeenCalledWith([INBOX])
  })

  it('a refused move keeps the row and says so', async () => {
    post.mockRejectedValue(Object.assign(new Error('500'), { response: { status: 500, data: {} } }))
    const { result } = renderHook(() => useHarness())
    let ok
    await act(async () => { ok = await result.current.actions.deleteEmail(SENT) })
    expect(ok).toBe(false)
    expect(result.current.sentUids).toEqual([SENT])
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/not deleted/))
  })

  // The live server had not been updated for Trash, so every delete answered "this mail server
  // needs its update" and nothing could be deleted at all. Now the caller is told there is no
  // Trash, and offers the delete the server can do — for good, after asking.
  it('a server without Trash moves nothing and says so to the caller, not as a dead end', async () => {
    post.mockRejectedValue(Object.assign(new Error('404'), { response: { status: 404, data: { code: 'not_found' } } }))
    const { result } = renderHook(() => useHarness())
    let outcome
    await act(async () => { outcome = await result.current.actions.deleteEmail(INBOX) })
    expect(outcome).toBe('no-trash')
    expect(result.current.uids).toEqual([INBOX])
    expect(toast).not.toHaveBeenCalled()
    let many
    await act(async () => { many = await result.current.actions.deleteMany([INBOX, SENT]) })
    expect(many.missingRoute).toBe(true)
    expect(many.gone).toEqual([])
  })

  it('forget takes a message off every list the screen holds', async () => {
    const { result } = renderHook(() => useHarness())
    act(() => { result.current.actions.forget([SENT, INBOX]) })
    expect(result.current.uids).toEqual([])
    expect(result.current.sentUids).toEqual([])
    expect(result.current.selectedUid).toBe(null)
  })

  it('a mixed selection moves what it can and returns what failed', async () => {
    post.mockImplementation(async (url, body) => {
      if (body.includes(INBOX)) throw new Error('refused')
      return { data: { kind: 'sent' } }
    })
    const { result } = renderHook(() => useHarness())
    let outcome
    await act(async () => { outcome = await result.current.actions.deleteMany([SENT, INBOX]) })
    expect(outcome.gone).toEqual([SENT])
    expect(outcome.failed).toEqual([INBOX])
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
})

describe('the Trash folder', () => {
  const trashList = { data: { items: [
    { uid: SENT, kind: 'sent', trashed_at: 1, deletes_at: 2 },
    { uid: INBOX, kind: 'inbox', trashed_at: 1, deletes_at: 2 },
  ], retention_days: 30 } }

  function useTrashHarness() {
    const [, setPreviews] = useState({})
    return useTrash({ fetchPreviewsFor: vi.fn(async () => {}), fetchSentPreviews: vi.fn(async () => {}), setPreviews, onRestored: vi.fn() })
  }

  it('lists what is in the trash, with the server’s retention', async () => {
    post.mockResolvedValue(trashList)
    const { result } = renderHook(() => useTrashHarness())
    await act(async () => { await result.current.fetchTrash() })
    expect(result.current.items.map((item) => item.uid)).toEqual([SENT, INBOX])
    expect(result.current.retentionDays).toBe(30)
  })

  it('delete for good uses the delete of the list each message came from', async () => {
    post.mockResolvedValueOnce(trashList).mockResolvedValue({ data: {} })
    const { result } = renderHook(() => useTrashHarness())
    await act(async () => { await result.current.fetchTrash() })
    await act(async () => { await result.current.deleteForever([SENT, INBOX]) })
    expect(post).toHaveBeenCalledWith('/email/sent/delete', `{"uid":"${SENT}"}`, expect.anything())
    expect(post).toHaveBeenCalledWith('/email/delete', `{"uid":"${INBOX}"}`, expect.anything())
    expect(result.current.items).toEqual([])
  })

  it('with no Trash, delete for good still finds each message’s own list', async () => {
    post.mockResolvedValue({ data: {} })
    const { result } = renderHook(() => useTrashHarness())
    let outcome
    await act(async () => { outcome = await result.current.deleteForever([SENT, INBOX], { sentUids: [SENT] }) })
    expect(post).toHaveBeenCalledWith('/email/sent/delete', `{"uid":"${SENT}"}`, expect.anything())
    expect(post).toHaveBeenCalledWith('/email/delete', `{"uid":"${INBOX}"}`, expect.anything())
    expect(outcome.gone).toEqual([SENT, INBOX])
  })

  it('a server without Trash marks the folder unavailable instead of empty', async () => {
    post.mockRejectedValue(Object.assign(new Error('404'), { response: { status: 404, data: { code: 'not_found' } } }))
    const { result } = renderHook(() => useTrashHarness())
    await act(async () => { await result.current.fetchTrash() })
    expect(result.current.available).toBe(false)
  })
})
