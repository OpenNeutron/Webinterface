import { describe, it, expect, beforeEach } from 'vitest'
import { loadProfile, saveProfile, formatSender } from '@/lib/profile'

describe('profile', () => {
  beforeEach(() => localStorage.clear())

  it('starts empty', () => {
    expect(loadProfile()).toEqual({ displayName: '', signature: '' })
  })

  it('round-trips through storage', () => {
    saveProfile({ displayName: 'Tibs', signature: '— sent from Sloth Lee' })
    expect(loadProfile()).toEqual({ displayName: 'Tibs', signature: '— sent from Sloth Lee' })
  })

  it('survives junk in storage', () => {
    localStorage.setItem('sloth.profile.v1', 'not json')
    expect(loadProfile()).toEqual({ displayName: '', signature: '' })
  })

  it('formats the sender as "Name <address>"', () => {
    expect(formatSender('tibs@slothlee.xyz', 'Tibs')).toBe('"Tibs" <tibs@slothlee.xyz>')
  })

  it('falls back to the bare address with no name', () => {
    expect(formatSender('tibs@slothlee.xyz', '')).toBe('tibs@slothlee.xyz')
    expect(formatSender('tibs@slothlee.xyz', '   ')).toBe('tibs@slothlee.xyz')
  })

  it('strips quotes that would break the header', () => {
    expect(formatSender('a@b.c', 'He said "hi"')).toBe('"He said hi" <a@b.c>')
  })
})
