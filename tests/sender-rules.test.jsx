import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'

// Groups could always file mail by sender on the server (filter_addresses), but nothing in the
// app could set a rule, so the feature did not exist for anyone. These pin the rules screen, the
// call it makes, and the quoting every group call now uses for 128-bit ids.

const post = vi.fn()
vi.mock('@/api', () => ({ default: { post: (...args) => post(...args) } }))
const toast = vi.fn()
vi.mock('@/lib/toast', () => ({ toast: (...args) => toast(...args) }))

import { cleanAddresses, useGroupActions } from '@/hooks/useGroupActions'
import { useEmailActions } from '@/hooks/useEmailActions'
import { SenderRulesModal } from '@/components/SenderRulesModal'

const GROUP = '193457712871299466312345678901234567890'
const EMAIL = '79077153517879815893541103082182958680'

beforeEach(() => {
  post.mockReset()
  toast.mockReset()
})

describe('sender addresses', () => {
  it('are bare, lowercased and unique; anything that is not an address is dropped', () => {
    expect(cleanAddresses(['Root <Root@SlothLee.xyz>', 'root@slothlee.xyz', ' alerts@example.com ', 'not an address', ''])).toEqual(['root@slothlee.xyz', 'alerts@example.com'])
  })
})

function useGroups(initial) {
  const [groups, setGroups] = useState(initial)
  const actions = useGroupActions({ setGroups, setSelectedFolder: vi.fn(), setModalState: vi.fn() })
  return { groups, ...actions }
}

describe('saving sender rules', () => {
  it('sends the cleaned list with a quoted id and keeps what the server answered', async () => {
    post.mockResolvedValue({ data: { uid: GROUP, title: 'Alerts', email_uids: [], filter_addresses: ['root@slothlee.xyz'] } })
    const { result } = renderHook(() => useGroups([{ uid: GROUP, title: 'Alerts', email_uids: [], filter_addresses: [] }]))
    await act(async () => { await result.current.setSenderRules(GROUP, ['Root <root@slothlee.xyz>']) })
    expect(post).toHaveBeenCalledWith('/group/update', `{"uid":"${GROUP}","filter_addresses":["root@slothlee.xyz"]}`, expect.anything())
    expect(result.current.groups[0].filter_addresses).toEqual(['root@slothlee.xyz'])
  })

  it('a refusal says so and changes nothing', async () => {
    post.mockRejectedValue(new Error('500'))
    const { result } = renderHook(() => useGroups([{ uid: GROUP, title: 'Alerts', email_uids: [], filter_addresses: [] }]))
    let out
    await act(async () => { out = await result.current.setSenderRules(GROUP, ['a@b.c']) })
    expect(out).toBe(null)
    expect(result.current.groups[0].filter_addresses).toEqual([])
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/not saved/))
  })

  it('creating, renaming and deleting a group no longer fail in silence', async () => {
    post.mockRejectedValue(new Error('500'))
    const { result } = renderHook(() => useGroups([]))
    await act(async () => { await result.current.createGroup('Receipts') })
    await act(async () => { await result.current.renameGroup(GROUP, 'Bills') })
    await act(async () => { await result.current.deleteGroup(GROUP) })
    expect(toast).toHaveBeenCalledTimes(3)
  })
})

describe('the rules screen', () => {
  it('starts from the saved rules, flags what is not an address, and saves the rest', () => {
    const onSave = vi.fn()
    render(<SenderRulesModal isOpen group={{ uid: GROUP, title: 'Alerts', filter_addresses: ['root@slothlee.xyz'] }} onSave={onSave} onClose={vi.fn()} />)
    const box = screen.getByLabelText(/Sender addresses/)
    expect(box.value).toBe('root@slothlee.xyz')
    fireEvent.change(box, { target: { value: 'root@slothlee.xyz\nDNS Watch <dns-watch@slothlee.xyz>\nnonsense' } })
    expect(screen.getByRole('status').textContent).toMatch(/nonsense/)
    fireEvent.click(screen.getByRole('button', { name: 'Save 2 rules' }))
    expect(onSave).toHaveBeenCalledWith(['root@slothlee.xyz', 'dns-watch@slothlee.xyz'])
  })
})

describe('moving a message to a group', () => {
  it('quotes both ids, so a 38-digit id survives', async () => {
    post.mockResolvedValue({ data: {} })
    const { result } = renderHook(() => {
      const [groups, setGroups] = useState([{ uid: GROUP, title: 'Alerts', email_uids: [] }])
      return useEmailActions({ emailMeta: {}, setEmailMeta: vi.fn(), setUids: vi.fn(), setPreviews: vi.fn(), setSelectedUid: vi.fn(), setGroups, groups })
    })
    await act(async () => { await result.current.moveToGroup(EMAIL, GROUP) })
    expect(post).toHaveBeenCalledWith('/group/add-email', `{"group_uid":"${GROUP}","email_uid":"${EMAIL}"}`, expect.anything())
  })
})

describe('a server from before quoted group ids', () => {
  it('is asked again with bare digits, so filing still works whichever is deployed first', async () => {
    post.mockRejectedValueOnce(Object.assign(new Error('400'), { response: { status: 400 } })).mockResolvedValue({ data: {} })
    const { groupEmail } = await import('@/lib/groupEmail')
    await groupEmail('add', GROUP, EMAIL)
    expect(post).toHaveBeenLastCalledWith('/group/add-email', `{"group_uid":${GROUP},"email_uid":${EMAIL}}`, expect.anything())
  })
})
