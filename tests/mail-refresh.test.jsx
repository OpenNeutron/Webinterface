import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, render, fireEvent, screen } from '@testing-library/react'
import { useRef } from 'react'

// New mail used to need a tap on Refresh, and Refresh itself started the list over from the
// newest page while leaving "Load older mail" pointing past where it had got to. Now new mail is
// checked for on a timer and whenever the app comes back, without disturbing what is loaded,
// and a finger can pull the list down to refresh.

const post = vi.fn()
vi.mock('@/api', () => ({ default: { post: (...args) => post(...args) } }))
vi.mock('@/keySession', () => ({ keySession: { get: async () => null } }))

import { useEmailFetch } from '@/hooks/useEmailFetch'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'

const page = (uids) => ({ data: { uids } })
const bulk = (uids) => ({ data: { emails: uids.map((uid) => ({ uid, data: '', message_key: '', received_at: null })) } })
const bulkUids = (body) => (typeof body === 'string' ? JSON.parse(body).uids : [])

beforeEach(() => post.mockReset())

describe('checking for new mail', () => {
  it('adds only what arrived, keeps older pages, and decrypts only the new ones', async () => {
    post.mockImplementation(async (url, body) => {
      if (url === '/email/recent') return page(['b', 'a'])
      return bulk(bulkUids(body))
    })
    const { result } = renderHook(() => useEmailFetch())
    await act(async () => { await result.current.fetchEmails(0) })
    // An older page is on screen too.
    act(() => { result.current.setUids((prev) => [...prev, 'old1']) })

    post.mockReset()
    post.mockImplementation(async (url, body) => {
      if (url === '/email/recent') return page(['c', 'b', 'a'])
      return bulk(bulkUids(body))
    })
    let arrived
    await act(async () => { arrived = await result.current.checkNew() })
    expect(arrived).toBe(1)
    expect(result.current.uids).toEqual(['c', 'b', 'a', 'old1'])
    const bulkCalls = post.mock.calls.filter(([url]) => url === '/email/bulk')
    expect(bulkCalls).toHaveLength(1)
    expect(bulkUids(bulkCalls[0][1])).toEqual(['c'])
  })

  it('nothing new changes nothing and decrypts nothing', async () => {
    post.mockImplementation(async (url, body) => (url === '/email/recent' ? page(['a']) : bulk(bulkUids(body))))
    const { result } = renderHook(() => useEmailFetch())
    await act(async () => { await result.current.fetchEmails(0) })
    const before = result.current.uids
    post.mockClear()
    await act(async () => { await result.current.checkNew() })
    expect(result.current.uids).toBe(before)
    expect(post.mock.calls.filter(([url]) => url === '/email/bulk')).toHaveLength(0)
  })

  it('reload starts Load older mail from the top again', async () => {
    post.mockImplementation(async (url, body) => {
      if (url === '/email/recent') return page(Array.from({ length: 20 }, (_, i) => `${body.offset}-${i}`))
      return bulk(bulkUids(body))
    })
    const { result } = renderHook(() => useEmailFetch())
    await act(async () => { await result.current.fetchEmails(0) })
    await act(async () => { result.current.loadMore() })
    await act(async () => { await result.current.reload() })
    post.mockClear()
    await act(async () => { result.current.loadMore() })
    const recent = post.mock.calls.find(([url]) => url === '/email/recent')
    expect(recent[1].offset).toBe(20)
  })
})

function Pullable({ onRefresh }) {
  const ref = useRef(null)
  const { pull, busy, ready } = usePullToRefresh(ref, onRefresh)
  return (
    <div ref={ref} data-testid="list">
      <span data-testid="state">{busy ? 'busy' : ready ? 'ready' : pull > 0 ? 'pulling' : 'idle'}</span>
    </div>
  )
}

const touches = (y, x = 100) => ({ touches: [{ clientY: y, clientX: x }] })

describe('pull to refresh', () => {
  it('a long pull from the top refreshes', async () => {
    const onRefresh = vi.fn(async () => {})
    render(<Pullable onRefresh={onRefresh} />)
    const list = screen.getByTestId('list')
    fireEvent.touchStart(list, touches(100))
    fireEvent.touchMove(list, touches(180))
    expect(screen.getByTestId('state').textContent).toBe('pulling')
    fireEvent.touchMove(list, touches(300))
    expect(screen.getByTestId('state').textContent).toBe('ready')
    await act(async () => { fireEvent.touchEnd(list) })
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('state').textContent).toBe('idle')
  })

  it('a short pull, a sideways swipe, or a list not at its top does nothing', async () => {
    const onRefresh = vi.fn(async () => {})
    render(<Pullable onRefresh={onRefresh} />)
    const list = screen.getByTestId('list')
    fireEvent.touchStart(list, touches(100))
    fireEvent.touchMove(list, touches(140))
    await act(async () => { fireEvent.touchEnd(list) })
    fireEvent.touchStart(list, touches(100, 100))
    fireEvent.touchMove(list, touches(300, 400))
    await act(async () => { fireEvent.touchEnd(list) })
    list.scrollTop = 50
    Object.defineProperty(list, 'scrollTop', { value: 50, configurable: true })
    fireEvent.touchStart(list, touches(100))
    fireEvent.touchMove(list, touches(400))
    await act(async () => { fireEvent.touchEnd(list) })
    expect(onRefresh).not.toHaveBeenCalled()
  })
})
