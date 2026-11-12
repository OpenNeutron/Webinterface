/**
 * Passphrases for sealed notes.
 *
 * A stranger on another provider will not install a PGP client, so the note is
 * locked with words instead of a key. The phrase has to survive being read out
 * over a phone or retyped from a screen: short, lowercase, distinct words with
 * a few digits, generated from the browser's CSPRNG.
 *
 * Entropy: 4 words from 160 (4 × 7.3 bits) plus 3 digits (10 bits) ≈ 39 bits.
 * That is only the second lock — the link itself carries 32 random bytes — and
 * it defeats a leaked link, which is the case this protects against.
 */
const WORDS = (
  'amber anchor apple apron arrow aspen atlas badge bagel bamboo basin beacon ' +
  'birch bishop blanket bloom bolt border bottle bramble brass breeze brick bridge ' +
  'bronze brook brush cabin cable cactus candle canvas canyon carbon carpet cedar ' +
  'chalk cherry chimney cider circle cliff cloud clover cobalt comet compass copper ' +
  'coral cotton crane crater crimson crystal cypress daisy delta denim desert diamond ' +
  'dome donkey drift drum eagle earth ember emerald falcon feather fern fiddle field ' +
  'finch fjord flame flint forest fossil fox frost garden garnet ginger glacier glade ' +
  'glass glider gold granite grape grove hail harbor hazel heron hickory hollow honey ' +
  'hornet iceberg indigo inlet iron island ivory ivy jade jasmine juniper kettle kestrel ' +
  'kite lagoon lantern larch laurel leaf lemon lilac linen lizard lobster lotus lunar ' +
  'maple marble meadow melon meteor mint mirror mist moss mountain nectar needle nickel ' +
  'north nutmeg oak oasis ocean olive onyx opal orbit orchid otter owl paddle paper ' +
  'pebble pepper petal pewter pine piston plum pollen pond poppy prairie prism quarry ' +
  'quartz quill rabbit radar raven reed ridge river robin rocket rose ruby saddle saffron ' +
  'sage salmon sand sapphire satin scarlet sequoia shadow shell silver slate snow sparrow ' +
  'spruce steel stone storm summit sunset sycamore teak thistle thunder tide timber topaz ' +
  'torch trail tulip tundra umber valley velvet violet walnut willow window winter wolf'
).split(/\s+/).filter(Boolean)

function pick(list) {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return list[buf[0] % list.length]
}

/** e.g. "brass-lantern-mint-cobalt-472" */
export function makePassphrase() {
  const words = []
  for (let i = 0; i < 4; i += 1) {
    let word = pick(WORDS)
    while (words.includes(word)) word = pick(WORDS)
    words.push(word)
  }
  const digits = new Uint32Array(1)
  crypto.getRandomValues(digits)
  return `${words.join('-')}-${String(digits[0] % 1000).padStart(3, '0')}`
}

/** Rough strength note for the UI: 4 words + digits, ~39 bits. */
export const PASSPHRASE_HINT = '4 words + digits'
