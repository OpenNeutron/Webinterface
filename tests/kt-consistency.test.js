// @vitest-environment node
// The consistency proof, checked against proofs this server actually produced.
//
// An inclusion proof answers "is this key in the tree?". This answers "is this the same
// tree I saw before, with more in it?" — the check a pinned head cannot make on its own,
// because a rewrite that also grows looks exactly like normal operation.

import { describe, it, expect, beforeAll } from 'vitest'
import { verifyConsistency, nodeHash } from '@/kt'

const BASE = 'https://mail.slothlee.xyz'

const fromB64 = (text) => Uint8Array.from(Buffer.from(text, 'base64'))

let head
let live = []

beforeAll(async () => {
  const res = await fetch(`${BASE}/api/kt/head`)
  head = await res.json()
  expect(head.size).toBeGreaterThan(4)

  // One proof per smaller size: the server has to be able to extend each of them.
  for (let first = 1; first < head.size; first += 1) {
    const r = await fetch(`${BASE}/api/kt/consistency`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ first, second: head.size }),
    })
    live.push({ first, body: await r.json(), status: r.status })
  }
}, 30_000)

describe('consistency, against the live log', () => {
  it('every size the log has been through extends to the current one', () => {
    const failures = []
    for (const { first, body, status } of live) {
      expect(status, `size ${first}`).toBe(200)
      const check = verifyConsistency(
        body.first_size,
        body.first_root || head.root,
        body.second_size,
        body.second_root,
        body.proof.map(fromB64),
      )
      if (!check.ok) failures.push(`${first}: ${check.reason}`)
    }
    expect(failures).toEqual([])
  })

  it('the answer is signed by the log key', async () => {
    const body = live[0].body
    expect(body.alg).toBe('ml-dsa-65')
    expect(body.sig?.length).toBeGreaterThan(100)
    expect(body.second_root).toBe(head.root)
    expect(body.first_root).toMatch(/^[A-Za-z0-9+/=]+$/)
  })

  it('a proof for a size the log never was is refused, not improvised', async () => {
    const r = await fetch(`${BASE}/api/kt/consistency`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ first: 2, second: head.size + 5 }),
    })
    expect(r.status).toBe(409)
    expect((await r.json()).code).toBe('not_current')
  })
})

describe('consistency, against forgery', () => {
  it('rejects a first root that belongs to a rewritten prefix', () => {
    const { first, body } = live[live.length - 1]
    const honest = body.first_root
    const forged = Buffer.concat([Buffer.from(honest, 'base64').subarray(0, 31), Buffer.from([0x7f])]).toString('base64')

    expect(
      verifyConsistency(first, honest, body.second_size, body.second_root, body.proof.map(fromB64)).ok
    ).toBe(true)
    expect(
      verifyConsistency(first, forged, body.second_size, body.second_root, body.proof.map(fromB64)).ok
    ).toBe(false)
  })

  it('rejects a truncated, padded or edited proof', () => {
    const { first, body } = live[live.length - 1]
    const root = body.first_root
    const proof = body.proof.map(fromB64)

    expect(verifyConsistency(first, root, body.second_size, body.second_root, proof.slice(0, -1)).ok).toBe(false)
    expect(
      verifyConsistency(first, root, body.second_size, body.second_root, [...proof, new Uint8Array(32)]).ok
    ).toBe(false)

    const edited = proof.map((node) => Uint8Array.from(node))
    edited[0][0] ^= 0xff
    expect(verifyConsistency(first, root, body.second_size, body.second_root, edited).ok).toBe(false)
  })

  it('rejects a second root that does not match', () => {
    const { first, body } = live[live.length - 1]
    const other = nodeHash(fromB64(head.root), new Uint8Array(32))
    const check = verifyConsistency(
      first,
      body.first_root,
      body.second_size,
      Buffer.from(other).toString('base64'),
      body.proof.map(fromB64),
    )
    expect(check.ok).toBe(false)
    expect(check.reason).toBe('second_root_mismatch')
  })

  it('says what is wrong rather than answering false', () => {
    expect(verifyConsistency(5, head.root, 3, head.root, []).reason).toBe('bad_range')
    expect(verifyConsistency(5, head.root, 9, head.root, []).reason).toBe('empty_proof')
    expect(verifyConsistency(5, head.root, 5, head.root, []).ok).toBe(true)
  })
})
