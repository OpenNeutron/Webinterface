# Release hashes

Anyone can rebuild the client and compare it against what the server is serving.
The goal is that "the code I audited is the code my browser ran" becomes
checkable by someone who does not trust the operator.

## Verify a release

```sh
git clone https://github.com/SirTibbles666one/Sloth-Lee-Mail
cd Sloth-Lee-Mail
npm ci
npm run build
sha256sum dist/assets/*.js dist/assets/*.css
```

Compare those hashes with the ones listed below and with what the live site
serves:

```sh
curl -s https://mail.slothlee.xyz/assets/index-<name>.js | sha256sum
```

## Caveat: compare content, not filenames

Vite's content hash in the **filename** is not stable across machines, so a
rebuild may emit `index-AAAAAAAA.js` where the deployment has
`index-BBBBBBBB.js`. The **bytes inside** are stable and are what matters. Two
consecutive builds here produced a byte-identical bundle under the same name,
while the previously deployed bundle had a different name and identical
contents — verified 2026-10-27.

So: compare `sha256sum` of the JavaScript and CSS, not the file names. A
mismatch in content is the signal; a mismatch in names is not.

## Deployed

### dist68 — service worker `sloth-mail-shell-v21`

| file | sha256 |
|---|---|
| `assets/index-ojb81qv6.js` | `18f4e295f261b0e648f2ef70659ebc74566048cc69cd70ac24a0c7fac0bfd16c` |

- adds mailbox export (.mbox, decrypted in the browser) and per-section metadata cleanup

### dist66 — service worker `sloth-mail-shell-v20` (superseded)

### dist66 — service worker `sloth-mail-shell-v20`

| file | sha256 |
|---|---|
| `assets/index-BZnL3iy4.js` | `583918a70d912203b90b83ccbf0e2cd374d5aaf4ba612b47dbd8a3c02b7f75d7` |
| `assets/index-XTJ0hB3G.css` | `ffa40c4a356eb82535f54da7d649dac108ca5953b85b87e8f8098220ae2e4a03` |
| `index.html` | `d443a0415b6087b4359dea51e20bb3f97f441a5d103165359b7051a1900508a9` |

Notes for this release:
- random IV per private-key wrap (`SLW1` envelope), legacy blobs still open
- `index.html` differs between rebuilds because it references the current asset
  name; compare the JS and CSS when verifying.

## What this does and does not prove

It proves the published source produces the script that is being served. It does
**not** prove the server will keep serving it: until the client is served from an
origin the mail server does not control (and preferably shipped as a signed
native app), a compromised server can serve something else after you check.
That is Phase 1 of `docs/ZERO-KNOWLEDGE.md`.
