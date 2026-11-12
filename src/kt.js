// Key transparency, checked rather than believed.
//
// The server hands every recipient's public key to the sender. Until now the sender
// had no way to tell an honest answer from a substituted one, and a substituted key
// reads the mail while every envelope and signature still checks out.
//
// Each key now arrives with a proof: a leaf in an append-only Merkle log, the audit
// path that binds it to a root, and that root signed with ML-DSA-65. This module
// recomputes the root and verifies the signature, so the sender is checking the
// directory instead of trusting it.
//
// The rules are the server's, deliberately duplicated: leaf = SHA-256("kt/v1/leaf" |
// u32be(seq) | u16be(len) | account | sha256(rsa) | sha256(pq)), node = SHA-256(
// "kt/v1/node" | left | right) with an odd node promoted, head message =
// "kt/v1/head" | u64be(size) | root. A test opens a proof produced by the Rust server,
// so the two implementations are pinned to each other rather than assumed equal.

import { sha256 } from '@noble/hashes/sha2.js'
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js'

export const KT_HEAD_STORAGE = 'sloth.kt.head'

const enc = new TextEncoder()

function equalBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function concat(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

function u32be(n) {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff])
}

function u64be(n) {
  const out = new Uint8Array(8)
  const high = Math.floor(n / 2 ** 32)
  const low = n >>> 0
  out.set(u32be(high), 0)
  out.set(u32be(low), 4)
  return out
}

function u16be(n) {
  return new Uint8Array([(n >>> 8) & 0xff, n & 0xff])
}

function fromB64(text) {
  const binary = atob(text)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

function pad32(bytes) {
  const out = new Uint8Array(32)
  out.set(bytes.subarray(0, Math.min(32, bytes.length)))
  return out
}

export function leafHash(leaf) {
  const name = enc.encode(leaf.account)
  const rsa = pad32(fromB64(leaf.rsa))
  const pq = leaf.pq ? pad32(fromB64(leaf.pq)) : new Uint8Array(32)
  return sha256(concat(enc.encode('kt/v1/leaf'), u32be(leaf.seq), u16be(name.length), name, rsa, pq))
}

export function nodeHash(left, right) {
  return sha256(concat(enc.encode('kt/v1/node'), left, right))
}

/** Fold a leaf and its audit path up to a root. The size is required: at an odd level
 *  the last node is promoted without hashing, and guessing that from the index alone
 *  rejects valid proofs at odd sizes. */
export function rootFromPath(leaf, index, size, path) {
  let acc = leaf
  let idx = index
  let width = size
  let cursor = 0
  while (width > 1) {
    const promoted = idx + 1 === width && width % 2 === 1
    if (!promoted) {
      if (cursor >= path.length) return null
      const sibling = path[cursor]
      cursor += 1
      acc = idx % 2 === 0 ? nodeHash(acc, sibling) : nodeHash(sibling, acc)
    }
    idx = Math.floor(idx / 2)
    width = Math.ceil(width / 2)
  }
  return cursor === path.length ? acc : null
}

/**
 * Consistency: does the tree at `secondSize` still contain the tree at `firstSize`?
 *
 * An inclusion proof says "this key is in the tree". This says "the tree I am showing you
 * is the same tree I showed you before, plus more" — which is the only way a browser can
 * tell a normal append from a server that rewrote an old leaf and grew past it.
 *
 * Ported from the reference implementation (transparency-dev/merkle, proof/verify.go).
 * The parity walk that looks obvious from the RFC rejects valid proofs, so the rule here
 * is the one CT logs actually use, pinned by tests over every size pair.
 */
const bitLen = (x) => {
  let n = 0
  let v = x >>> 0
  while (v > 0) {
    n += 1
    v = Math.floor(v / 2)
  }
  return n
}

const ones = (x) => {
  let n = 0
  let v = x >>> 0
  while (v > 0) {
    if (v % 2 === 1) n += 1
    v = Math.floor(v / 2)
  }
  return n
}

const trailingZeros = (x) => (x === 0 ? 32 : bitLen(x & -x) - 1)

const chainInner = (seed, proof, index) => {
  let acc = seed
  for (let i = 0; i < proof.length; i += 1) {
    acc = (index >> i) % 2 === 0 ? nodeHash(acc, proof[i]) : nodeHash(proof[i], acc)
  }
  return acc
}

const chainInnerRight = (seed, proof, index) => {
  let acc = seed
  for (let i = 0; i < proof.length; i += 1) {
    if ((index >> i) % 2 === 1) acc = nodeHash(proof[i], acc)
  }
  return acc
}

const chainBorderRight = (seed, proof) => proof.reduce((acc, node) => nodeHash(node, acc), seed)

function rootFromSubtreeConsistency(start, end, size, proof, subRoot) {
  if (end === size) {
    const level = bitLen((end - 1) ^ start)
    const index = Math.floor(start / Math.pow(2, level))
    if (proof.length !== ones(index)) return null
    return chainBorderRight(subRoot, proof)
  }

  const forkLevel = bitLen((end - 1) ^ (size - 1))
  const border = ones(Math.floor((end - 1) / Math.pow(2, forkLevel)))
  const shift = trailingZeros(end - start)
  const inner = forkLevel - shift

  let seed = proof[0]
  let pStart = 1
  if (end - start === Math.pow(2, shift)) {
    seed = subRoot
    pStart = 0
  }
  if (seed === undefined) return null
  if (proof.length !== pStart + inner + border) return null
  const nodes = proof.slice(pStart)
  const mask = Math.floor((end - 1) / Math.pow(2, shift))

  if (pStart === 1) {
    // The nodes that belong to the first tree have to chain to the root we pinned.
    const h = bitLen((end - 1) ^ start)
    const subInner = Math.min(h, forkLevel) - shift
    const subBorder = Math.max(0, border - ones(Math.floor((end - 1) / Math.pow(2, h))))
    if (subInner < 0 || nodes.length < inner + subBorder) return null
    let hash1 = chainInnerRight(seed, nodes.slice(0, subInner), mask)
    hash1 = chainBorderRight(hash1, nodes.slice(inner, inner + subBorder))
    if (!equalBytes(hash1, subRoot)) return null
  }

  let hash2 = chainInner(seed, nodes.slice(0, inner), mask)
  hash2 = chainBorderRight(hash2, nodes.slice(inner))
  return hash2
}

/** Verify a consistency proof. `proof` is an array of Uint8Array hashes. */
export function verifyConsistency(firstSize, firstRoot, secondSize, secondRoot, proof) {
  if (!Number.isInteger(firstSize) || !Number.isInteger(secondSize)) {
    return { ok: false, reason: 'sizes_not_integers' }
  }
  if (firstSize <= 0 || firstSize > secondSize) {
    return { ok: false, reason: 'bad_range' }
  }
  if (firstSize === secondSize) {
    return proof.length === 0 && firstRoot === secondRoot
      ? { ok: true }
      : { ok: false, reason: 'same_size_different_root' }
  }
  if (!Array.isArray(proof) || proof.length === 0) return { ok: false, reason: 'empty_proof' }

  const root = rootFromSubtreeConsistency(0, firstSize, secondSize, proof, fromB64(firstRoot))
  if (!root) return { ok: false, reason: 'proof_does_not_fit' }
  if (root.length !== 32) return { ok: false, reason: 'proof_does_not_fit' }
  return equalBytes(root, fromB64(secondRoot))
    ? { ok: true }
    : { ok: false, reason: 'second_root_mismatch' }
}

/**
 * Does the head this send saw still contain the head this browser pinned?
 *
 * A bigger tree used to be accepted on trust. Now it has to prove it extends the pinned
 * one, because "bigger" is exactly what a rewritten history looks like. `fetchProof` is
 * injected so the rule can be tested without a server.
 */
export async function verifyHeadExtension(sawHead, pinned, fetchProof) {
  if (!pinned) return { ok: true, checked: false }
  if (sawHead.size < pinned.size) return { ok: false, reason: 'shrank' }
  if (sawHead.size === pinned.size) {
    return sawHead.root === pinned.root ? { ok: true, checked: true } : { ok: false, reason: 'changed_at_same_size' }
  }

  let body
  try {
    body = await fetchProof(pinned.size, sawHead.size)
  } catch {
    return { ok: false, reason: 'proof_unavailable' }
  }
  if (!body || !Array.isArray(body.proof)) return { ok: false, reason: 'proof_unavailable' }
  if (body.second_root !== sawHead.root) return { ok: false, reason: 'proof_is_for_another_tree' }

  const check = verifyConsistency(
    pinned.size,
    pinned.root,
    sawHead.size,
    sawHead.root,
    body.proof.map(fromB64),
  )
  return check.ok ? { ok: true, checked: true } : { ok: false, reason: check.reason }
}

/** Verify the ML-DSA-65 signature over a head. */
export function verifyHeadSignature(head) {
  try {
    const pk = fromB64(head.pk)
    const sig = fromB64(head.sig)
    const root = fromB64(head.root)
    const message = concat(enc.encode('kt/v1/head'), u64be(head.size), root)
    return ml_dsa65.verify(sig, message, pk) === true
  } catch {
    return false
  }
}

/**
 * Check one recipient's proof end to end.
 * Returns { ok: true, root, size } or { ok: false, reason } where reason names the
 * failure — a bare false would tell the caller nothing about what to do next.
 */
export function verifyProof(proof) {
  if (!proof || !proof.leaf || !proof.head) return { ok: false, reason: 'no_proof' }
  if (proof.head.alg !== 'ml-dsa-65') return { ok: false, reason: 'unknown_head_algorithm' }

  const head = proof.head
  const index = proof.index
  const size = head.size
  if (!Number.isInteger(index) || index < 0 || index >= size) {
    return { ok: false, reason: 'index_outside_tree' }
  }

  let path
  try {
    path = (proof.path || []).map(fromB64)
  } catch {
    return { ok: false, reason: 'proof_not_base64' }
  }

  const computed = rootFromPath(leafHash(proof.leaf), index, size, path)
  if (!computed) return { ok: false, reason: 'path_length_mismatch' }

  const root = fromB64(head.root)
  if (computed.length !== root.length || computed.some((byte, i) => byte !== root[i])) {
    return { ok: false, reason: 'does_not_reach_the_root' }
  }

  if (!verifyHeadSignature(head)) return { ok: false, reason: 'head_signature_invalid' }

  return { ok: true, root: head.root, size }
}

/** The head this browser last saw, so a rewound or rewritten log is noticeable. */
export function pinnedHead(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(KT_HEAD_STORAGE)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function pinHead(head, storage = globalThis.localStorage) {
  try {
    storage?.setItem(KT_HEAD_STORAGE, JSON.stringify({ size: head.size, root: head.root }))
  } catch {
    /* a browser that refuses storage still gets the per-message check */
  }
}

/**
 * Did this head move backwards, or change at the same size?
 *
 * A log only ever grows, so a smaller tree or a different root at the same size
 * means the server is showing this browser a history it did not show before.
 */
export function headRegressed(head, pinned) {
  if (!pinned) return false
  if (head.size < pinned.size) return true
  if (head.size === pinned.size && head.root !== pinned.root) return true
  return false
}
