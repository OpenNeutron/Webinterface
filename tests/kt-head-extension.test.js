// The rule the send path follows when the key directory has grown since this browser
// last looked: prove it still contains what was pinned, or nothing is sent.

// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import { verifyHeadExtension } from '@/kt'

const BASE = 'https://mail.slothlee.xyz'
const fromB64 = (text) => Buffer.from(text, 'base64')

let head
let proof

beforeAll(async () => {
  head = await (await fetch(`${BASE}/api/kt/head`)).json()
  proof = await (
    await fetch(`${BASE}/api/kt/consistency`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ first: 3, second: head.size }),
    })
  ).json()
}, 30_000)

const fetchProof = (first, second) => (first === 3 && second === head.size ? proof : null)

describe('head extension', () => {
  it('accepts growth that the log can prove extends the pinned head', async () => {
    const pinned = { size: 3, root: proof.first_root }
    const result = await verifyHeadExtension(head, pinned, fetchProof)
    expect(result).toEqual({ ok: true, checked: true })
  })

  it('refuses growth when the proof is missing', async () => {
    const pinned = { size: 3, root: proof.first_root }
    const result = await verifyHeadExtension(head, pinned, async () => null)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('proof_unavailable')
  })

  it('refuses a proof that belongs to a different tree', async () => {
    const pinned = { size: 3, root: proof.first_root }
    const other = { ...head, root: 'AAAA' }
    const result = await verifyHeadExtension(other, pinned, async () => ({ ...proof, second_root: head.root }))
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('proof_is_for_another_tree')
  })

  it('refuses a pinned root that the current tree does not contain', async () => {
    const tampered = fromB64(proof.first_root)
    tampered[0] ^= 0xff
    const pinned = { size: 3, root: tampered.toString('base64') }
    const result = await verifyHeadExtension(head, pinned, fetchProof)
    expect(result.ok).toBe(false)
  })

  it('keeps the old verdicts for a shrink and a same-size change', async () => {
    expect((await verifyHeadExtension({ size: 2, root: 'x' }, { size: 3, root: 'y' }, fetchProof)).reason).toBe('shrank')
    expect(
      (await verifyHeadExtension({ size: 3, root: 'a' }, { size: 3, root: 'b' }, fetchProof)).reason
    ).toBe('changed_at_same_size')
  })

  it('does nothing when the browser has never seen a head', async () => {
    expect(await verifyHeadExtension(head, null, fetchProof)).toEqual({ ok: true, checked: false })
  })

  it('refuses when the proof request throws', async () => {
    const pinned = { size: 3, root: proof.first_root }
    const result = await verifyHeadExtension(head, pinned, async () => {
      throw new Error('offline')
    })
    expect(result.reason).toBe('proof_unavailable')
  })
})
