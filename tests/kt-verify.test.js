// The browser must accept the proof the Rust server produces, and reject any edit to it.
//
// tests/fixtures/kt-proof-tibs.json is a real response from
// POST https://mail.slothlee.xyz/api/kt/proof — a leaf for `tibs` at index 6 of a
// 9-leaf tree, with a head signed by the server's ML-DSA-65 key. If these tests pass,
// the browser's rules and the server's rules are the same rules; if the combiner or the
// leaf layout ever drifts on one side, this fails instead of a sender silently trusting
// an answer nobody checked.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  verifyProof,
  verifyHeadSignature,
  leafHash,
  rootFromPath,
  headRegressed,
} from '@/kt'

const fixture = (name) => JSON.parse(readFileSync(resolve(__dirname, 'fixtures', name), 'utf8'))
const proof = fixture('kt-proof-tibs.json')
const head = fixture('kt-head.json')

describe('a proof from the live server', () => {
  it('reaches its own signed root', () => {
    const result = verifyProof(proof)
    expect(result.ok, result.reason).toBe(true)
    expect(result.root).toBe(proof.head.root)
    expect(result.size).toBe(proof.head.size)
  })

  it('agrees with the separately published head', () => {
    expect(proof.head.root).toBe(head.root)
    expect(proof.head.size).toBe(head.size)
    expect(verifyHeadSignature(head)).toBe(true)
  })

  it('names the leaf after the account that owns the key', () => {
    expect(proof.leaf.account).toBe('tibs')
    expect(proof.leaf.rsa).toMatch(/^[A-Za-z0-9+/=]{44}$/)
  })
})

describe('an edited proof', () => {
  it('fails when a path node is swapped', () => {
    const tampered = structuredClone(proof)
    const swapped = Buffer.from(tampered.path[0], 'base64')
    swapped[0] ^= 0xff
    tampered.path[0] = swapped.toString('base64')
    const result = verifyProof(tampered)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('does_not_reach_the_root')
  })

  it('fails when the leaf claims a different key', () => {
    const tampered = structuredClone(proof)
    const rsa = Buffer.from(tampered.leaf.rsa, 'base64')
    rsa[0] ^= 0xff
    tampered.leaf.rsa = rsa.toString('base64')
    expect(verifyProof(tampered)).toMatchObject({ ok: false, reason: 'does_not_reach_the_root' })
  })

  it('fails when the head is re-signed by somebody else', () => {
    const tampered = structuredClone(proof)
    const sig = Buffer.from(tampered.head.sig, 'base64')
    sig[sig.length - 1] ^= 0xff
    tampered.head.sig = sig.toString('base64')
    expect(verifyProof(tampered)).toMatchObject({ ok: false, reason: 'head_signature_invalid' })
  })

  it('fails when the path is truncated', () => {
    const tampered = structuredClone(proof)
    tampered.path = tampered.path.slice(0, -1)
    expect(verifyProof(tampered)).toMatchObject({ ok: false, reason: 'path_length_mismatch' })
  })

  it('refuses a proof with no head at all', () => {
    expect(verifyProof({ leaf: proof.leaf, index: 0, path: [] })).toMatchObject({
      ok: false,
      reason: 'no_proof',
    })
  })

  it('says so when the tree size is impossible', () => {
    const tampered = structuredClone(proof)
    tampered.index = 99
    expect(verifyProof(tampered)).toMatchObject({ ok: false, reason: 'index_outside_tree' })
  })
})

describe('the tree maths', () => {
  const leaf = leafHash(proof.leaf)

  it('needs the size, not just the path — the odd-node case', () => {
    // In a 3-leaf tree leaf 2 is promoted at the first level, so its path is a single
    // node. Read as a 4-leaf tree that same single node leaves the fold unfinished.
    // A verifier that inferred promotion from index parity alone would confuse them.
    const sibling = new Uint8Array(32).fill(7)
    const three = rootFromPath(leaf, 2, 3, [sibling])
    const four = rootFromPath(leaf, 2, 4, [sibling])
    expect(three).not.toBeNull()
    expect(four).toBeNull()
    expect(rootFromPath(leaf, 2, 4, [sibling, sibling])).not.toBeNull()
  })

  it('rejects a path with spare nodes', () => {
    expect(rootFromPath(leaf, 0, 1, [new Uint8Array(32)])).toBeNull()
  })
})

describe('a pinned head', () => {
  const pinned = { size: head.size, root: head.root }

  it('is happy with the same head', () => {
    expect(headRegressed(head, pinned)).toBe(false)
  })

  it('is happy when the log only grew', () => {
    expect(headRegressed({ size: head.size + 3, root: 'other' }, pinned)).toBe(false)
  })

  it('notices a shorter history', () => {
    expect(headRegressed({ size: head.size - 1, root: head.root }, pinned)).toBe(true)
  })

  it('notices a different root at the same size', () => {
    expect(headRegressed({ size: head.size, root: 'not-the-same-root' }, pinned)).toBe(true)
  })

  it('says nothing when nothing was pinned', () => {
    expect(headRegressed(head, null)).toBe(false)
  })
})
