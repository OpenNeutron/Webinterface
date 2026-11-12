// The setup strip has to do what its button says.
//
// "Set up" used to navigate to the top of Settings, leaving the reader to find the
// missing item among four groups. It now opens the first gap's own section, so the
// button lands on the thing it counted.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import SetupStrip from '@/components/SetupStrip'

const items = [
  { id: 'recovery', label: 'Recovery key', href: '/settings#recovery', note: 'Without one…' },
  { id: 'openpgp', label: 'OpenPGP key', href: '/settings#keys', note: 'An OpenPGP key…' },
]

afterEach(cleanup)

describe('SetupStrip', () => {
  it('says how many things are missing', () => {
    render(<SetupStrip items={items} onOpen={() => {}} onDismiss={() => {}} />)
    expect(screen.getByText(/2 things not set up yet/)).toBeTruthy()
  })

  it('opens the first gap rather than the settings index', () => {
    const onOpen = vi.fn()
    render(<SetupStrip items={items} onOpen={onOpen} onDismiss={() => {}} />)
    fireEvent.click(screen.getByText('Set up'))
    expect(onOpen).toHaveBeenCalledWith('/settings#recovery')
  })

  it('still works when a gap has no link of its own', () => {
    const onOpen = vi.fn()
    render(
      <SetupStrip
        items={[{ id: 'x', label: 'Something', note: 'no link' }]}
        onOpen={onOpen}
        onDismiss={() => {}}
      />,
    )
    fireEvent.click(screen.getByText('Set up'))
    expect(onOpen).toHaveBeenCalledWith(undefined)
  })

  it('names every gap when expanded', () => {
    render(<SetupStrip items={items} onOpen={() => {}} onDismiss={() => {}} />)
    fireEvent.click(screen.getByText(/things not set up yet/))
    expect(screen.getByText('Recovery key.')).toBeTruthy()
    expect(screen.getByText('OpenPGP key.')).toBeTruthy()
  })

  it('draws nothing when there is nothing to say', () => {
    const { container } = render(<SetupStrip items={[]} onOpen={() => {}} onDismiss={() => {}} />)
    expect(container.firstChild).toBeNull()
  })
})
