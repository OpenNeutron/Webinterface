import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import AuthShell, { Field, PasswordInput } from '@/components/AuthShell'
import api from '@/api'
import { storage } from '@/storage'
import { loginSecondFactor, loginSecurityKeyBegin, loginSecurityKeyFinish } from '@/api'
import { getAssertion, describeKeyError, securityKeyProblem } from '@/lib/webauthn'
import { enablePostQuantum, loadPostQuantumKey } from '@/lib/pqSetup'
import { hashPassword, generateKeyPair, exportPublicKeyBase64, encryptPrivateKey, decryptPrivateKey, hasSubtleCrypto } from '@/crypto'
import RecoveryKeySetup from '@/components/RecoveryKeySetup'
import { keySession } from '@/keySession'
import { Mail } from 'lucide-react'
import SlothMark from '@/components/SlothMark'
import { cryptoUnavailableMessage } from '@/lib/cryptoFailure'

const Login = () => {
  const [phase, setPhase] = useState('login')

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const [setupPassword, setSetupPassword] = useState('')
  // Set once the identity exists: the recovery-key screen must be answered
  // before the user reaches the mailbox.
  const [newPrivateKey, setNewPrivateKey] = useState(null)
  const [setupConfirm, setSetupConfirm] = useState('')

  // Set when the server answers the password step with a second-factor demand.
  const [challenge, setChallenge] = useState('')
  const [twoFactorCode, setTwoFactorCode] = useState('')
  // Which second factors this account can actually satisfy, as the server reports
  // them. Offering a button the account cannot use is how a working key looks broken.
  const [methods, setMethods] = useState([])

  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleLogin = async (e) => {
    e.preventDefault()
    setError('')
    try {
      // Accounts provisioned by an administrator have no password hash yet: the
      // one-time setup token IS the credential, and it is stored raw, so it must
      // be sent raw. Hashing it would guarantee a mismatch.
      const looksLikeSetupToken = /^[0-9a-f]{64}$/i.test(password.trim())
      // Hashing runs in the browser (Argon2 via WebAssembly). If that step fails —
      // a content blocker, a policy that forbids wasm, a broken extension — nothing
      // is sent at all, and saying "login failed" would blame the password for
      // something the browser did. Reported separately, and named.
      let presented
      try {
        presented = looksLikeSetupToken ? password.trim() : await hashPassword(password)
      } catch (hashErr) {
        console.error('[Login] ❌ Could not hash the password:', hashErr)
        setError(cryptoUnavailableMessage('password step'))
        setLoading(false)
        return
      }
      if (looksLikeSetupToken) console.log('[Login] Presenting a one-time setup token')
      console.log('[Login] Sending login request')
      const response = await api.post('/auth/login', { username, password: presented })

      // Password accepted, second factor still owed: no token came back, and
      // nothing sensitive (salt, wrapped key, admin flag) was sent either.
      if (response.data?.two_factor_required) {
        console.log('[Login] Second factor required')
        setChallenge(response.data.challenge || '')
        setMethods(response.data.two_factor_methods || [])
        setTwoFactorCode('')
        setPhase('twofactor')
        setLoading(false)
        return
      }

      await finishLogin(response.data, password)

      setLoading(false)
    } catch (err) {
      console.error('[Login] Login request failed:', err.response?.data ?? err.message)
      // A queued signup must not be told its password is wrong: it is right, and
      // the account simply has not been reviewed yet.
      if (err.response?.status === 403 && err.response?.data?.code === 'account_pending') {
        setError('Your account is waiting for approval — you can sign in once it has been accepted.')
      } else {
        setError(err.response?.data?.error || 'Login failed')
      }
      setLoading(false)
    }
  }

  /** Everything that happens once a usable token exists. */
  const finishLogin = async (data, passwordUsed) => {
    const { token, force_reset, username: name, public_key, salt, encrypted_private_key, is_admin } = data || {}
    if (!token) throw new Error('No session token returned')
      if (storage.getUsername() !== name) {
        console.log('[Login] Username changed from', storage.getUsername(), '→', name, '— clearing key session')
        keySession.clear()
      }

      storage.set({ token, force_reset, username: name })
      if (is_admin !== undefined) storage.set({ is_admin })
      if (public_key) storage.set({ public_key })
      if (salt) keySession.setSalt(salt); storage.setLoginSalt(salt)
      // Persist the wrapped private key. Without it this device can decrypt for
      // as long as the tab lives, then can never unlock, change the password or
      // recover the key — the server keeps it, the browser must too.
      if (encrypted_private_key) storage.set({ encrypted_key: encrypted_private_key })

      if (force_reset) {
        console.log('[Login] force_reset=true, switching to setup phase')
        setPhase('setup')
      } else {
        if (encrypted_private_key && salt) {
          try {
            console.log('[Login] Decrypting private key with salt:', salt)
            const privateKey = await decryptPrivateKey(encrypted_private_key, passwordUsed, salt)
            await keySession.set(privateKey)
            // Same password, same salt: the post-quantum secret unlocks with the
            // account key it sits beside. Accounts without one simply skip this.
            await loadPostQuantumKey(passwordUsed, salt)
            console.log('[Login] ✅ Private key decrypted and loaded into session')
          } catch (keyErr) {
            console.error('[Login] ❌ Failed to decrypt private key:', keyErr)
          }
        } else {
          console.warn('[Login] ⚠️ Cannot load private key — missing fields:', {
            hasEncryptedPrivateKey: !!encrypted_private_key,
            hasSalt: !!salt,
          })
        }
        // The OpenPGP identity is kept on the account, wrapped with this password.
        // Sign-in is the one moment the password is in hand, so this is where a new
        // device recovers its key and where a key created before this shipped is first
        // uploaded. It must never block or fail the sign-in itself.
        try {
          // Loaded here, not with the page: it brings the OpenPGP library (~390 kB).
          const { syncIdentityWithAccount } = await import('@/lib/pgpAccount')
          const sync = await syncIdentityWithAccount(passwordUsed)
          // Always say what happened: a silent 'in-step' is indistinguishable from a
          // sync that never ran, which is exactly how this hid the first time.
          console.log('[Login] OpenPGP sync:', sync?.action, sync?.error || '')
        } catch (pgpErr) {
          console.warn('[Login] OpenPGP sync skipped:', pgpErr.message)
        }
        navigate('/')
      }
  }

  const handleTwoFactor = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await loginSecondFactor(challenge, twoFactorCode.trim())
      await finishLogin(data, password)
    } catch (err) {
      console.error('[Login] Second factor failed:', err.response?.data ?? err.message)
      setError(err.response?.data?.error || 'That code is not valid')
    } finally {
      setLoading(false)
    }
  }


  /**
   * Sign in with a security key instead of typing a code.
   *
   * The password is still typed, and still needed: it unwraps the mailbox key in
   * this browser. The key replaces the second factor, not the password.
   */
  const handleSecurityKey = async () => {
    setError('')
    const problem = securityKeyProblem()
    if (problem) { setError(problem); return }
    setLoading(true)
    try {
      const begun = await loginSecurityKeyBegin(challenge)
      const assertion = await getAssertion(begun.options)
      const data = await loginSecurityKeyFinish(challenge, begun.challenge_id, assertion)
      await finishLogin(data, password)
    } catch (err) {
      console.error('[Login] Security key failed:', err?.response?.data ?? err?.message ?? err)
      setError(err?.response?.data?.error || describeKeyError(err))
    } finally {
      setLoading(false)
    }
  }

  const handleSetup = async (e) => {
    e.preventDefault()
    if (setupPassword !== setupConfirm) {
      setError('Passwords do not match')
      return
    }
    setLoading(true)
    setError('')
    try {
      const currentUsername = storage.getUsername()
      const serverSalt = keySession.getSalt()
      console.log('[Setup] Starting key generation for user:', currentUsername, 'salt:', serverSalt)
      const keyPair = await generateKeyPair()
      console.log('[Setup] RSA-4096 key pair generated')
      const publicKeyBase64 = await exportPublicKeyBase64(keyPair.publicKey)
      console.log('[Setup] Public key exported, base64 length:', publicKeyBase64.length)
      const encryptedKey = await encryptPrivateKey(keyPair.privateKey, setupPassword, serverSalt)
      console.log('[Setup] Private key encrypted, base64 length:', encryptedKey.length)
      const passwordHash = await hashPassword(setupPassword)

      let activeToken = storage.getToken()

      // No re-create fallback: a 409 here means the account is already
      // configured (it has keys). Re-creating it needed admin rights and deleted
      // the mailbox — for a self-signed-up account that is the account itself.
      await api.post(
        '/user/setup',
        { password: passwordHash, public_key: publicKeyBase64, encrypted_private_key: encryptedKey },
        { headers: { Authorization: `Bearer ${activeToken}` } },
      )

      // Post-quantum protection is on from the first message for new accounts.
      // A failure here must not sink the account: the keys exist, and Settings
      // can add the PQ half later.
      try {
        await enablePostQuantum(setupPassword, serverSalt)
        console.log('[Setup] Post-quantum key created and uploaded')
      } catch (pqErr) {
        console.warn('[Setup] Post-quantum key not created:', pqErr?.message || pqErr)
      }

      console.log('[Setup] Loading private key into session')
      await keySession.set(keyPair.privateKey)
      console.log('[Setup] ✅ Private key in session, storing encrypted key to localStorage')
      storage.set({ encrypted_key: encryptedKey, public_key: publicKeyBase64, force_reset: false })
      setNewPrivateKey(keyPair.privateKey)
    } catch (err) {
      setError(err.response?.data?.error || 'Setup failed')
      console.error('[Setup] Error:', err)
    } finally {
      setLoading(false)
    }
  }

  if (phase === 'setup') {
    return (
      <AuthShell>
        {!newPrivateKey && (
          <>
            <h1 className="display text-[24px] leading-tight text-ink-1">Create your encryption keys</h1>
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">
              Type the same password you registered with. It unwraps the private key that encrypts
              your mailbox — the key is made here and never sent anywhere.
            </p>

            <form onSubmit={handleSetup} className="mt-7 space-y-4">
              <Field label="Your password" id="setup-password">
                <PasswordInput
                  id="setup-password"
                  value={setupPassword}
                  onChange={(e) => setSetupPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </Field>
              <Field label="Confirm password" id="setup-confirm">
                <Input
                  id="setup-confirm"
                  type="password"
                  value={setupConfirm}
                  onChange={(e) => setSetupConfirm(e.target.value)}
                  required
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </Field>

              {error && <p className="text-[12.5px] text-destructive">{error}</p>}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Generating keys…' : 'Create keys and sign in'}
              </Button>

              {loading && (
                hasSubtleCrypto ? (
                  <p className="text-center text-[11.5px] text-ink-3">
                    Generating a 4096-bit key pair. This takes a few seconds on a phone.
                  </p>
                ) : (
                  <p className="text-center text-[11.5px] font-medium text-destructive">
                    No secure context — using a slow software fallback. Mail is still encrypted,
                    it just takes longer.
                  </p>
                )
              )}
            </form>
          </>
        )}

        {newPrivateKey && (
          <RecoveryKeySetup
            privateKey={newPrivateKey}
            username={storage.getUsername()}
            onDone={() => {
              setNewPrivateKey(null)
              // A full load, not a route change: the recovery panel is mounted
              // in both the setup and the login branch of this page, so a
              // client-side navigation can land straight back on it.
              window.location.assign(storage.getToken() ? '/' : '/login')
            }}
          />
        )}
      </AuthShell>
    )
  }

  const twoFactor = phase === 'twofactor'

  return (
    <AuthShell>
      <h1 className="display text-[24px] leading-tight text-ink-1">
        {twoFactor ? 'One more step' : 'Sign in'}
      </h1>
      <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">
        {twoFactor
          ? (methods.includes('webauthn')
              ? 'Touch your security key, or enter the six-digit code from your authenticator app. A recovery code works too.'
              : 'Enter the six-digit code from your authenticator app. A recovery code works too.')
          : 'Your password unwraps the key that opens this mailbox. It is never sent to the server.'}
      </p>

      {twoFactor ? (
        <form onSubmit={handleTwoFactor} className="mt-7 space-y-4" data-testid="two-factor-form">
          <Field label="Code" id="twofactor-code">
            <Input
              id="twofactor-code"
              autoComplete="one-time-code"
              inputMode="numeric"
              autoFocus
              placeholder="123456"
              value={twoFactorCode}
              onChange={(e) => setTwoFactorCode(e.target.value.trim())}
            />
          </Field>
          <Button type="submit" className="w-full" disabled={loading || !twoFactorCode}>
            {loading ? 'Checking…' : 'Continue'}
          </Button>
          {methods.includes('webauthn') && (
            <button
              type="button"
              onClick={handleSecurityKey}
              disabled={loading}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-secondary/60 text-[13px] font-medium text-ink-1 transition-colors duration-120 hover:bg-secondary disabled:opacity-50"
              data-testid="use-security-key"
            >
              Use a security key instead
            </button>
          )}
          <button
            type="button"
            onClick={() => { setPhase('login'); setTwoFactorCode(''); setChallenge(''); setError('') }}
            className="w-full text-[12px] text-ink-3 transition-colors duration-120 hover:text-ink-1"
          >
            Back to sign in
          </button>
        </form>
      ) : (
        <>
          <form onSubmit={handleLogin} className="mt-7 space-y-4">
            <Field label="Username" id="username" hint="Just the name — uidemo@slothlee.xyz signs in as uidemo.">
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                placeholder="yourname"
                autoComplete="username"
              />
            </Field>
            <Field label="Password" id="password">
              <PasswordInput
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </Field>

            {error && <p className="text-[12.5px] leading-relaxed text-destructive">{error}</p>}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <div className="mt-7 space-y-2 border-t border-line pt-5">
            <p className="text-[12px] text-ink-2">
              Need a mailbox?{' '}
              <a href="/signup" className="text-primary underline underline-offset-2 hover:text-primary/85">
                Request one
              </a>
            </p>
            <p className="text-[12px] leading-relaxed text-ink-3">
              <Link to="/recover" className="text-ink-2 underline underline-offset-2 hover:text-ink-1">
                Recover with a recovery key
              </Link>{' '}
              — keeps all your old mail. Without a recovery key, a password reset is the only other
              way in, and it cannot open your old encrypted mail.
            </p>
          </div>
        </>
      )}

      {newPrivateKey && (
        <RecoveryKeySetup
          privateKey={newPrivateKey}
          username={storage.getUsername()}
          onDone={() => {
            setNewPrivateKey(null)
            window.location.assign(storage.getToken() ? '/' : '/login')
          }}
        />
      )}
    </AuthShell>
  )
}

export default Login