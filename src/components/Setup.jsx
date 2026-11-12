import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import api from '@/api'
import { storage } from '@/storage'
import { generateKeyPair, exportPublicKeyBase64, encryptPrivateKey, hashPassword } from '@/crypto'
import { keySession } from '@/keySession'
import { cryptoUnavailableMessage, isCryptoUnavailable } from '@/lib/cryptoFailure'

const Setup = () => {
  const token = storage.getToken()
  const forceReset = storage.getForceReset()
  if (!token) return <Navigate to="/login" replace />
  if (!forceReset) return <Navigate to="/" replace />

  return <SetupForm />
}

const SetupForm = () => {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleSetup = async (e) => {
    e.preventDefault()
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    setLoading(true)
    setError('')
    try {
      const currentUsername = storage.getUsername()
      const serverSalt = keySession.getSalt()
      const keyPair = await generateKeyPair()

      const publicKeyBase64 = await exportPublicKeyBase64(keyPair.publicKey)

      const encryptedKey = await encryptPrivateKey(keyPair.privateKey, password, serverSalt)

      const passwordHash = await hashPassword(password)

      let activeToken = storage.getToken()

      try {
        await api.post(
          '/user/setup',
          { password: passwordHash, public_key: publicKeyBase64, encrypted_private_key: encryptedKey },
          { headers: { Authorization: `Bearer ${activeToken}` } },
        )
      } catch (setupErr) {
        if (setupErr.response?.status !== 409) throw setupErr

        await api.delete('/admin/users', {
          data: { username: currentUsername },
          headers: { Authorization: `Bearer ${activeToken}` },
        })

        await api.post('/admin/users', {
          username: currentUsername,
        }, {
          headers: { Authorization: `Bearer ${activeToken}` },
        })

        const loginRes = await api.post('/auth/login', {
          username: currentUsername,
          password: passwordHash,
        })
        activeToken = loginRes.data.token
        if (loginRes.data.salt) keySession.setSalt(loginRes.data.salt); storage.setLoginSalt(loginRes.data.salt)
        storage.set({ token: activeToken })

        await api.post(
          '/user/setup',
          { password: passwordHash, public_key: publicKeyBase64, encrypted_private_key: encryptedKey },
          { headers: { Authorization: `Bearer ${activeToken}` } },
        )
      }

      await keySession.set(keyPair.privateKey)
      storage.set({ encrypted_key: encryptedKey, public_key: publicKeyBase64, force_reset: false })
      navigate('/')
    } catch (err) {
      if (isCryptoUnavailable(err)) {
        setError(cryptoUnavailableMessage('key setup step'))
        return
      }
      if (err.response?.status === 403) {
        setError('Key recovery requires admin privileges. Ask your administrator to delete and recreate your account.')
      } else {
        setError(`Setup failed: ${err.response?.data?.error || err.message}`)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Setup Account</CardTitle>
          <CardDescription>
            Choose a password to secure your account and generate your encryption keys.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSetup} className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-1">
                Password
              </label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />

            </div>
            <div>
              <label htmlFor="confirm" className="block text-sm font-medium mb-1">
                Re-enter Password
              </label>
              <Input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Generating keys…' : 'Setup Account'}
            </Button>
            {loading && (
              <p className="text-xs text-muted-foreground text-center">
                Generating RSA-4096 key pair, this may take a moment…
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

export default Setup
