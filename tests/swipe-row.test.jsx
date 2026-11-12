import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { SwipeRow } from '@/components/email/SwipeRow'

// On a phone there is no hover, so a row's hover actions never appear: deleting meant opening
// every message first, and a conversation could not be deleted from the list at all. A finger now
// swipes a row left to delete it, and holds it to select it. A mouse is left alone.

function setup(props = {}) {
  const onSwipe = vi.fn(async () => {})
  const onLongPress = vi.fn()
  const onClick = vi.fn()
  render(
    <SwipeRow onSwipe={onSwipe} onLongPress={onLongPress} {...props}>
      <div onClick={onClick}>row</div>
    </SwipeRow>,
  )
  const surface = screen.getByTestId('swipe-surface')
  Object.defineProperty(surface.parentElement, 'offsetWidth', { value: 360 })
  return { surface, onSwipe, onLongPress, onClick }
}

const touch = (type, surface, x, y = 100, pointerType = 'touch') =>
  fireEvent[type](surface, { pointerType, clientX: x, clientY: y, pointerId: 1 })

describe('swiping a mail row', () => {
  it('a long swipe left deletes, and the click after it does not open the message', async () => {
    vi.useFakeTimers()
    const { surface, onSwipe, onClick } = setup()
    touch('pointerDown', surface, 300)
    touch('pointerMove', surface, 280)
    touch('pointerMove', surface, 120)
    touch('pointerUp', surface, 120)
    fireEvent.click(surface.firstChild)
    expect(onClick).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(200) })
    expect(onSwipe).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('a short swipe springs back and deletes nothing', async () => {
    vi.useFakeTimers()
    const { surface, onSwipe } = setup()
    touch('pointerDown', surface, 300)
    touch('pointerMove', surface, 285)
    touch('pointerMove', surface, 260)
    touch('pointerUp', surface, 260)
    await act(async () => { vi.advanceTimersByTime(500) })
    expect(onSwipe).not.toHaveBeenCalled()
    expect(surface.style.transform).toBe('')
    vi.useRealTimers()
  })

  it('a mostly vertical move is the list scrolling, not a swipe', async () => {
    vi.useFakeTimers()
    const { surface, onSwipe } = setup()
    touch('pointerDown', surface, 300, 100)
    touch('pointerMove', surface, 290, 140)
    touch('pointerMove', surface, 100, 400)
    touch('pointerUp', surface, 100, 400)
    await act(async () => { vi.advanceTimersByTime(500) })
    expect(onSwipe).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('holding still selects, and that press does not open the message', () => {
    vi.useFakeTimers()
    const { surface, onLongPress, onClick } = setup()
    touch('pointerDown', surface, 200)
    act(() => { vi.advanceTimersByTime(500) })
    touch('pointerUp', surface, 200)
    fireEvent.click(surface.firstChild)
    expect(onLongPress).toHaveBeenCalledTimes(1)
    expect(onClick).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('a mouse drag does nothing: a mouse has the hover actions', async () => {
    vi.useFakeTimers()
    const { surface, onSwipe, onLongPress, onClick } = setup()
    touch('pointerDown', surface, 300, 100, 'mouse')
    touch('pointerMove', surface, 50, 100, 'mouse')
    touch('pointerUp', surface, 50, 100, 'mouse')
    await act(async () => { vi.advanceTimersByTime(600) })
    fireEvent.click(surface.firstChild)
    expect(onSwipe).not.toHaveBeenCalled()
    expect(onLongPress).not.toHaveBeenCalled()
    expect(onClick).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
