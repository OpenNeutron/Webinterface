import { useState } from 'react'
import { HelpCircle, ChevronDown } from 'lucide-react'

// People arrive at this panel mid-task ("why can't I read this mail?"), so the
// guide is written as steps in the order they hit them, with the limits stated
// next to the promises rather than buried.
const STEPS = [
  {
    title: '1. Create your key (once)',
    body: `Press "Create key". Your browser generates a key pair and keeps the
      private half here, encrypted with your passphrase. The server only ever
      receives the public half, which cannot open anything.`,
  },
  {
    title: '2. Your passphrase is not your login password',
    body: `Your login password unlocks your mailbox account. Your OpenPGP
      passphrase unlocks the encryption key. They are stored separately, and
      changing one does not change the other. If you forget the passphrase, the
      key cannot be used — that is the point of it.`,
  },
  {
    title: '3. Give people your public key',
    body: `Open your key and press "Copy public key" — send that text to whoever
      wants to write to you encrypted. Anyone can also fetch it automatically
      from this server's key directory without you doing anything. A public key
      is safe to share; it can only be used to encrypt TO you.`,
  },
  {
    title: '4. Writing to someone else, encrypted',
    body: `You need THEIR public key first, and the app looks for it by itself:
      add their address in the compose window and a lock appears if a key is
      found. Keys are found three ways, best first. (1) They already wrote to
      you — their key travels inside their message and is saved automatically.
      (2) They publish it where the app can look it up. (3) They sent it to you
      directly: then use "paste a key by hand" and paste the block that starts
      BEGIN PGP PUBLIC KEY BLOCK. If no key is found, the message still sends —
      unencrypted, and the compose window says so before you send.`,
  },
  {
    title: '5. What is NOT encrypted',
    body: `Mail to an address with no key is sent as ordinary mail — this server
      still cannot read your stored mail, but the recipient's provider can.
      People on other providers will not see encryption unless they use PGP
      themselves. The subject line and attachment names are always encrypted for
      mail between users of this service; they are visible to the outside world
      like any other mail.`,
  },
  {
    title: '6. Where your key is kept',
    body: `Your key lives on your account, wrapped with your password, so signing in
      on another device brings the same key back — not a new one. It also lives in
      this browser so mail can be decrypted without asking for the password again.
      Keep a key backup file as well: if you forget the password, the account copy
      cannot be opened by anyone, including this service.`,
  },
  {
    title: '7. If you lose your password',
    body: `Make a recovery key (the section below). Without one, a password reset
      gives you an empty mailbox: the new password cannot unwrap a key it did not
      create, so old encrypted mail stays unreadable — by us as well as you.`,
  },
]

export default function OpenPgpGuide() {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(null)
  const [test, setTest] = useState(null)

  // Two different failures look identical from the outside: the browser's
  // crypto not working at all, or this account simply having no key yet. The
  // self-test uses a throwaway key, so it answers "is encryption possible here"
  // without touching, needing, or revealing the user's real key.
  async function runSelfTest() {
    setTest({ state: 'running', text: 'Generating a throwaway key…' })
    try {
      const openpgp = await import('openpgp')
      const started = Date.now()
      const { publicKey, privateKey } = await openpgp.generateKey({
        type: 'ecc',
        curve: 'curve25519Legacy',
        userIDs: [{ name: 'Self test', email: 'selftest@invalid' }],
        passphrase: 'self-test-passphrase',
        format: 'armored',
      })
      setTest({ state: 'running', text: 'Encrypting and decrypting…' })
      const pub = await openpgp.readKey({ armoredKey: publicKey })
      const priv = await openpgp.decryptKey({
        privateKey: await openpgp.readPrivateKey({ armoredKey: privateKey }),
        passphrase: 'self-test-passphrase',
      })
      const armored = await openpgp.encrypt({
        message: await openpgp.createMessage({ text: 'sloth self test' }),
        encryptionKeys: [pub],
      })
      const back = await openpgp.decrypt({
        message: await openpgp.readMessage({ armoredMessage: armored }),
        decryptionKeys: priv,
      })
      const ok = back.data === 'sloth self test'
      setTest({
        state: ok ? 'pass' : 'fail',
        text: ok
          ? `Encryption works in this browser (${Date.now() - started} ms). If sending is still failing, the problem is the key on this account, not the browser.`
          : 'The round trip did not return the original text.',
      })
    } catch (err) {
      setTest({
        state: 'fail',
        text: `Encryption is not working in this browser: ${err?.message || err}`,
      })
    }
  }

  return (
    <section className="mb-4 rounded-xl bg-secondary/60 p-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2">
          <HelpCircle size={16} className="text-ink-2" />
          <span className="text-sm font-medium text-ink-1">How encryption works here</span>
        </span>
        <ChevronDown size={16} className={`text-ink-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <button
        onClick={runSelfTest}
        className="mt-3 rounded-lg border border-line-strong px-3 py-1.5 text-xs text-ink-2 hover:bg-accent"
      >
        Run a quick self-test
      </button>
      {test ? (
        <p
          className={`mt-2 text-xs ${
            test.state === 'fail' ? 'text-red-300' : test.state === 'pass' ? 'text-emerald-300' : 'text-ink-2'
          }`}
        >
          {test.text}
        </p>
      ) : null}

      {!open ? (
        <p className="mt-2 text-xs text-ink-3">
          Seven short steps: creating a key, sharing it, writing to others, and what stays unencrypted.
        </p>
      ) : (
        <ol className="mt-3 space-y-2">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rounded-lg border border-line-strong bg-field/60">
              <button
                onClick={() => setStep(step === i ? null : i)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
              >
                <span className="text-xs font-medium text-ink-1">{s.title}</span>
                <ChevronDown size={13} className={`shrink-0 text-ink-4 transition-transform ${step === i ? 'rotate-180' : ''}`} />
              </button>
              {step === i ? (
                <p className="whitespace-pre-line px-3 pb-3 text-xs leading-relaxed text-ink-2">{s.body}</p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
