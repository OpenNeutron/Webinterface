/**
 * Fixture for the sealed-attachment proof.
 *
 * The server never sees the plaintext of a sealed note, so the proof of that path
 * needs armour that was produced the way the browser produces it. That fixture used
 * to be created by hand in a browser session and left in /tmp — which is why the
 * proof crashed after a reboot instead of failing honestly. This writes it every run.
 *
 * The content does not matter to the server (it cannot open it); what matters is that
 * it is a real OpenPGP message and a real sealed file, with the shapes the API checks.
 *
 *   node scripts/make-sealed-files-fixture.mjs [output-path]
 */
import fs from 'node:fs'
import * as openpgp from 'openpgp'

const out = process.argv[2] || '/tmp/sealed-files.json'
const passphrase = 'fixture-passphrase'
const fileBytes = new Uint8Array([0x53, 0x4c, 0x4f, 0x54, 0x48, 0x00, 0xff, 0x10])

const noteArmor = await openpgp.encrypt({
  message: await openpgp.createMessage({ text: 'Sealed note body used only as a fixture.' }),
  passwords: [passphrase],
  format: 'armored',
})

const fileArmor = await openpgp.encrypt({
  message: await openpgp.createMessage({ binary: fileBytes }),
  passwords: [passphrase],
  format: 'armored',
})

fs.writeFileSync(
  out,
  JSON.stringify({
    armor: String(noteArmor),
    fileArmor: String(fileArmor),
    fileSize: fileBytes.length,
    passphrase,
  }),
)

console.log(`${out}: ${String(noteArmor).length} bytes of note armour, ${String(fileArmor).length} of file armour`)
