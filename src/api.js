import axios from 'axios'
import { storage } from './storage'
import { keySession } from './keySession'

const api = axios.create({
  //baseURL: 'http://openneutron.com:8080',
  //baseURL: 'http://localhost:8080/api',
  baseURL: '/api/',
  headers: {
    'Content-Type': 'application/json',
  },
  transformResponse: [
    (data) => {
      if (typeof data !== 'string') return data
      try {
        return JSON.parse(data.replace(/([,:\[]\s*)(\d{16,})/g, '$1"$2"'))
      } catch {
        return data
      }
    },
  ],
})

// A 401 from one call is not proof the session is over: an endpoint reached
// without its Authorization header answers exactly like an expired token, and
// signing the user out for that is how a single page logs them out mid-use. Ask
// the server whether the token itself is still good before throwing the session
// away — /user/me through plain axios, so this check cannot recurse.
let checkingSession = false

async function tokenRejected(token) {
  try {
    await axios.get('/api/user/me', { headers: { Authorization: `Bearer ${token}` } })
    return false
  } catch (e) {
    return e?.response?.status === 401
  }
}

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const status = err?.response?.status
    const url = err?.config?.url || ''
    if (status === 401 && !url.includes('/auth/') && !checkingSession) {
      const token = storage.getToken()
      checkingSession = true
      const dead = token ? await tokenRejected(token) : true
      checkingSession = false
      if (dead) {
        keySession.clear()
        storage.clear()
        window.location.href = '/login'
      }
    }
    return Promise.reject(err)
  },
)

export const getUser = async () => {
  const token = storage.getToken()
  if (!token) return null
  try {
    const response = await api.get('/user/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
    return response.data
  } catch (error) {
    return null
  }
}

export const adminGetWaitlist = async () => {
  const token = storage.getToken()
  const response = await api.get('/admin/waitlist', {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

export const adminApproveWaitlist = async (email) => {
  const token = storage.getToken()
  const response = await api.post(
    '/admin/waitlist/approve',
    { email },
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

export const adminGetPending = async () => {
  const token = storage.getToken()
  const response = await api.get('/admin/pending', {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

export const adminApprovePending = async (username) => {
  const token = storage.getToken()
  const response = await api.post(
    '/admin/pending/approve',
    { username },
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

export const adminDenyPending = async (username) => {
  const token = storage.getToken()
  const response = await api.post(
    '/admin/pending/deny',
    { username },
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

export const adminGetUsers = async () => {
  const token = storage.getToken()
  const response = await api.get('/admin/users', {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

export const adminCreateUser = async (username) => {
  const token = storage.getToken()
  const response = await api.post('/admin/users', { username }, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

export const adminDeleteUser = async (username) => {
  const token = storage.getToken()
  const response = await api.delete('/admin/users', {
    data: { username },
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

export const adminSetAdminStatus = async (username, isAdmin) => {
  const token = storage.getToken()
  const response = await api.post('/admin/users/admin', { username, is_admin: isAdmin }, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

export const adminSetCredentials = async (username, passwordHash, publicKey, encryptedPrivateKey) => {
  const token = storage.getToken()
  const response = await api.post('/admin/users/credentials', {
    username,
    password: passwordHash,
    public_key: publicKey,
    encrypted_private_key: encryptedPrivateKey,
  }, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

export const pgpPublishWkd = async (payload) => {
  const token = storage.getToken()
  const response = await api.post('/pgp/wkd/publish', payload, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

export const pgpWkdStatus = async () => {
  const token = storage.getToken()
  const response = await api.get('/pgp/wkd/status', {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

export const userGetKey = async () => {
  const token = storage.getToken()
  const response = await api.post('/user/key', {}, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

export const userSetCredentials = async (passwordHash, publicKey, encryptedPrivateKey) => {
  const token = storage.getToken()
  const response = await api.post('/user/credentials', {
    password: passwordHash,
    public_key: publicKey,
    encrypted_private_key: encryptedPrivateKey,
  }, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

export const emailListAll = async () => {
  const token = storage.getToken()
  const response = await api.post('/email/list', null, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data.uids ?? []
}

export const emailGetRaw = async (uid) => {
  const token = storage.getToken()
  const response = await api.post('/email/get', `{"uid":"${uid}"}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  return { data: response.data.data, message_key: response.data.message_key }
}

export const emailSetRaw = async (uid, data, messageKey) => {
  const token = storage.getToken()
  const bodyStr = messageKey
    ? `{"uid":"${uid}","data":"${data}","message_key":"${messageKey}"}`
    : `{"uid":"${uid}","data":"${data}"}`
  const response = await api.post('/email/set', bodyStr, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  return response.data
}

export default api
// Public: redeem a password-reset token mailed to a user's recovery address.
export const resetWithToken = async (token, credentials) => {
  const response = await api.post('/user/reset', { token, credentials })
  return response.data
}

export const adminSetRecoveryAddress = async (username, email) => {
  const token = storage.getToken()
  const response = await api.post('/admin/users/recovery-address', { username, email }, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

export const adminSendRecovery = async (username) => {
  const token = storage.getToken()
  const response = await api.post('/admin/users/send-recovery', { username }, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

export const userSetRecoveryKey = async (wrappedKey, kdfSalt, authProof) => {
  const token = storage.getToken()
  const response = await api.post('/user/recovery-key', {
    wrapped_key: wrappedKey, kdf_salt: kdfSalt, auth_proof: authProof,
  }, { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

export const userRecoveryKeyStatus = async () => {
  const token = storage.getToken()
  const response = await api.get('/user/recovery-key', {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

// Public: the wrapped key, so a client holding the recovery secret can unwrap it.
export const userFetchRecoveryBlob = async (username) => {
  const response = await api.post('/user/recovery-key/blob', { username })
  return response.data
}

export const userRestoreWithRecoveryKey = async (payload) => {
  const response = await api.post('/user/recovery-key/restore', payload)
  return response.data
}

/* ---------------------------------------------------- two-factor auth --- */

export const userTwoFactorStatus = async () => {
  const token = storage.getToken()
  const response = await api.get('/user/2fa', { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

export const userTwoFactorStart = async () => {
  const token = storage.getToken()
  const response = await api.post('/user/2fa/start', {}, { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

export const userTwoFactorConfirm = async (code) => {
  const token = storage.getToken()
  const response = await api.post('/user/2fa/confirm', { code }, { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

export const userTwoFactorDisable = async (code) => {
  const token = storage.getToken()
  const response = await api.post('/user/2fa/disable', { code }, { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

// Public: redeems the login challenge issued after the password step.
export const loginSecondFactor = async (challenge, code) => {
  const response = await api.post('/auth/login/2fa', { challenge, code })
  return response.data
}

/* ------------------------------------------------- security keys --- */

// Public: the challenge the key will sign, for a login already past the password.
export const loginSecurityKeyBegin = async (challenge) => {
  const response = await api.post('/auth/login/webauthn/begin', { challenge })
  return response.data
}

// Public: an assertion, verified server-side before any token is minted.
export const loginSecurityKeyFinish = async (challenge, challengeId, assertion) => {
  const response = await api.post('/auth/login/webauthn/finish', {
    challenge,
    challenge_id: challengeId,
    ...assertion,
  })
  return response.data
}

export const userSecurityKeys = async () => {
  const token = storage.getToken()
  const response = await api.get('/user/webauthn', { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

// Adding a key needs a fresh code, so a stolen session cannot enrol its own.
export const userSecurityKeyRegisterBegin = async (code) => {
  const token = storage.getToken()
  const response = await api.post('/user/webauthn/register/begin', { code }, { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

export const userSecurityKeyRegisterFinish = async (payload) => {
  const token = storage.getToken()
  const response = await api.post('/user/webauthn/register/finish', payload, { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

export const userSecurityKeyRemove = async (id, code) => {
  const token = storage.getToken()
  const response = await api.post('/user/webauthn/remove', { id, code }, { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

/* --------------------------------------------------- active sessions --- */

export const userSessions = async () => {
  const token = storage.getToken()
  const response = await api.get('/user/sessions', { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

// Messages held for a chosen time: what is waiting, and taking one back.
export const listScheduled = async () => {
  const token = storage.getToken()
  const response = await api.get('/scheduled', { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

export const cancelScheduled = async (id) => {
  const token = storage.getToken()
  const response = await api.post('/scheduled/cancel', { id }, { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

// Disposable addresses: mail to one lands in this mailbox, and switching it off
// stops it working for the sender.
// New-mail notifications. The key is public, but everything else belongs to the
// signed-in account, and this file is where the token is attached.
export const pushKey = async () => {
  const response = await api.get('/push/key')
  return response.data
}

export const pushStatus = async () => {
  const token = storage.getToken()
  const response = await api.get('/push/status', { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

export const pushSubscribe = async ({ endpoint, key, auth, ua }) => {
  const token = storage.getToken()
  const response = await api.post(
    '/push/subscribe',
    { endpoint, keys: { p256dh: key, auth }, ua },
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

export const pushUnsubscribe = async (endpoint) => {
  const token = storage.getToken()
  const response = await api.post(
    '/push/unsubscribe',
    { endpoint },
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

export const pushTest = async () => {
  const token = storage.getToken()
  const response = await api.post('/push/test', {}, { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

export const listAliases = async () => {
  const token = storage.getToken()
  const response = await api.get('/aliases', { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

export const createAlias = async ({ local = '', label = '' } = {}) => {
  const token = storage.getToken()
  const response = await api.post('/aliases', { local, label }, { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

export const setAliasDisabled = async (local, disabled) => {
  const token = storage.getToken()
  const response = await api.post('/aliases/disable', { local, disabled }, { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

export const deleteAlias = async (local) => {
  const token = storage.getToken()
  const response = await api.post('/aliases/delete', { local }, { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

export const userRevokeSession = async (id) => {
  const token = storage.getToken()
  const response = await api.post('/user/sessions/revoke', { id }, { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

export const userRevokeAllSessions = async () => {
  const token = storage.getToken()
  const response = await api.post('/user/sessions/revoke-all', {}, { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

// Close your own account. The server verifies the password token and removes
// the mailbox, its mail, recovery record, second factor and sessions.
export const userDeleteAccount = async (passwordToken) => {
  const token = storage.getToken()
  const response = await api.post(
    '/user/delete-account',
    { password: passwordToken },
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

// What Postfix is actually told to accept, and how much space each mailbox takes.
// Both are read-only views of server state — no new capability.
export const adminGetRecipients = async () => {
  const token = storage.getToken()
  const response = await api.get('/admin/recipients', {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

export const adminGetDiskUsage = async () => {
  const token = storage.getToken()
  const response = await api.get('/admin/disk-usage', {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

// One RFC 822 message, base64, with the date the message itself carries. The
// server encrypts it to the account key exactly as SMTP delivery would.
export const importMessage = async (raw, dateUnix) => {
  const { data } = await api.post(
    '/import/message',
    { raw, date_unix: dateUnix ?? null },
    { headers: { Authorization: `Bearer ${storage.getToken()}` } },
  )
  return data
}
