import { describe, it, expect } from 'vitest'
import { isTypingTarget, listShortcut, neighbourAfterRemoval, stepThrough } from '@/lib/mailNav'

describe('the next message after a delete', () => {
  const order = ['a', 'b', 'c', 'd']
  it('opens the one below', () => expect(neighbourAfterRemoval(order, ['b'])).toBe('c'))
  it('opens the one above when the last is deleted', () => expect(neighbourAfterRemoval(order, ['d'])).toBe('c'))
  it('skips past a whole removed block', () => expect(neighbourAfterRemoval(order, ['b', 'c'])).toBe('d'))
  it('opens nothing when the list is now empty', () => expect(neighbourAfterRemoval(['a'], ['a'])).toBe(null))
  it('opens nothing when the removed message was not in the list', () => expect(neighbourAfterRemoval(order, ['x'])).toBe(null))
  it('compares 128-bit uids as text', () => expect(neighbourAfterRemoval(['1', '2'], [1])).toBe('2'))
})

describe('J and K', () => {
  const order = ['a', 'b', 'c']
  it('steps down and up', () => {
    expect(stepThrough(order, 'a', 1)).toBe('b')
    expect(stepThrough(order, 'b', -1)).toBe('a')
  })
  it('stays at the ends', () => {
    expect(stepThrough(order, 'c', 1)).toBe('c')
    expect(stepThrough(order, 'a', -1)).toBe('a')
  })
  it('starts at the top (J) or bottom (K) when nothing is open', () => {
    expect(stepThrough(order, null, 1)).toBe('a')
    expect(stepThrough(order, null, -1)).toBe('c')
  })
})

describe('list shortcuts', () => {
  const key = (k, extra = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra })
  const body = { tagName: 'BODY' }
  it('reads Delete, #, Z, J and K', () => {
    expect(listShortcut(key('Delete'), body)).toBe('delete')
    expect(listShortcut(key('#'), body)).toBe('delete')
    expect(listShortcut(key('z'), body)).toBe('undo')
    expect(listShortcut(key('j'), body)).toBe('next')
    expect(listShortcut(key('k'), body)).toBe('prev')
  })
  it('never fires while typing, or with a browser modifier', () => {
    expect(listShortcut(key('Delete'), { tagName: 'INPUT' })).toBe(null)
    expect(listShortcut(key('z'), { tagName: 'DIV', isContentEditable: true })).toBe(null)
    expect(listShortcut(key('z', { metaKey: true }), body)).toBe(null)
    expect(listShortcut(key('Delete', { ctrlKey: true }), body)).toBe(null)
    expect(listShortcut(key('Backspace'), body)).toBe(null)
  })
  it('knows a text field when it sees one', () => {
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true)
    expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})
