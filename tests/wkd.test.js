import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { zbase32, wkdHash, wkdUrl, lookupKey } from '@/lib/wkd'

describe('z-base-32', () => {
  // Vectors taken from GnuPG, which computed them when doing a real WKD lookup.
  // Self-consistent vectors from my own encoder hid a bit-order bug once already.
  it('matches the hashes GnuPG computes', async () => {
    expect(await wkdHash('tibs@slothlee.xyz')).toBe('7w37z6jcfzygr7pb1hwsy9g5np711afe')
    expect(await wkdHash('joe@example.com')).toBe('n4w4kuq9ejc3kmthngg8ccja7y5j8i97')
  })

  it('is case-insensitive on the local part, as the spec requires', async () => {
    expect(await wkdHash('TIBS@slothlee.xyz')).toBe(await wkdHash('tibs@slothlee.xyz'))
  })

  it('produces 32 characters from 20 bytes', () => {
    expect(zbase32(new Uint8Array(20).fill(7))).toHaveLength(32)
  })

  it('builds the advanced-method URL', async () => {
    expect(await wkdUrl('tibs@slothlee.xyz')).toBe(
      `https://openpgpkey.slothlee.xyz/.well-known/openpgpkey/slothlee.xyz/hu/7w37z6jcfzygr7pb1hwsy9g5np711afe?l=tibs`,
    )
  })
})

describe('key discovery', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('falls back to the keyserver when WKD is not available', async () => {
    const calls = []
    vi.stubGlobal('fetch', async (url) => {
      calls.push(String(url))
      if (String(url).includes('openpgpkey.')) return { ok: false, status: 404 }
      return { ok: false, status: 404 }
    })

    const found = await lookupKey('nobody@example.org')
    expect(found).toBe(null)
    expect(calls[0]).toContain('openpgpkey.example.org')
    expect(calls[1]).toContain('keys.openpgp.org')
  })

  it('returns no result for a non-address without touching the network', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    expect(await lookupKey('not-an-address')).toBe(null)
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('keyserver publishing', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uploads as JSON and then requests verification (the step that sends mail)', async () => {
    const calls = []
    vi.stubGlobal('fetch', async (url, opts) => {
      calls.push({ url: String(url), body: JSON.parse(opts.body), headers: opts.headers })
      if (String(url).endsWith('/upload')) {
        return { ok: true, text: async () => JSON.stringify({ token: 'tok-1', key_fpr: 'ABCD', status: { 'me@x.org': 'unpublished' } }) }
      }
      return { ok: true, text: async () => '{}' }
    })
    const { publishToKeyserver } = await import('@/lib/wkd')
    const result = await publishToKeyserver('-----BEGIN PGP PUBLIC KEY BLOCK-----\nx\n-----END PGP PUBLIC KEY BLOCK-----', ['me@x.org'])

    expect(calls[0].url).toContain('/vks/v1/upload')
    expect(calls[0].headers['Content-Type']).toBe('application/json')
    expect(calls[0].body.keytext).toContain('BEGIN PGP PUBLIC KEY BLOCK')
    expect(calls[1].url).toContain('/vks/v1/request-verify')
    expect(calls[1].body.token).toBe('tok-1')
    expect(calls[1].body.addresses).toEqual(['me@x.org'])
    expect(result.verificationSent).toBe(true)
  })

  it('skips verification when the key has no token left to redeem', async () => {
    const calls = []
    vi.stubGlobal('fetch', async (url) => {
      calls.push(String(url))
      return { ok: true, text: async () => JSON.stringify({ key_fpr: 'ABCD', status: { 'me@x.org': 'published' } }) }
    })
    const { publishToKeyserver } = await import('@/lib/wkd')
    const result = await publishToKeyserver('armored', ['me@x.org'])
    expect(calls).toHaveLength(1)
    expect(result.verificationSent).toBe(false)
  })

  it('turns a refusal into a readable error', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error_description: 'key too large' }),
    }))
    const { publishToKeyserver } = await import('@/lib/wkd')
    await expect(publishToKeyserver('x', [])).rejects.toThrow(/key too large/)
  })
})
