import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import OpenPgpGuide from '@/components/OpenPgpGuide'

describe('OpenPgpGuide', () => {
  it('starts collapsed with a one-line summary', () => {
    render(<OpenPgpGuide />)
    expect(screen.getByText('How encryption works here')).toBeTruthy()
    expect(screen.queryByText('1. Create your key (once)')).toBeNull()
  })

  it('lists all seven steps when opened', () => {
    render(<OpenPgpGuide />)
    fireEvent.click(screen.getByText('How encryption works here'))
    expect(screen.getByText('1. Create your key (once)')).toBeTruthy()
    expect(screen.getByText('7. If you lose your password')).toBeTruthy()
  })

  it('reveals a step body on click', () => {
    render(<OpenPgpGuide />)
    fireEvent.click(screen.getByText('How encryption works here'))
    fireEvent.click(screen.getByText('5. What is NOT encrypted'))
    expect(screen.getByText(/sent as ordinary mail/)).toBeTruthy()
  })
})

describe('OpenPgpGuide self-test', () => {
  it('shows immediate progress when started', () => {
    render(<OpenPgpGuide />)
    fireEvent.click(screen.getByText('Run a quick self-test'))
    // Key generation is too slow to complete under happy-dom, so assert the
    // feedback that matters here: pressing the button reports state instead of
    // doing nothing visible. The pass/fail path is exercised in a real browser.
    expect(screen.getByText(/Generating a throwaway key/)).toBeTruthy()
  })
})
