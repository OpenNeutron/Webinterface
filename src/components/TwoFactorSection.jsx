import { useEffect, useState } from 'react'
import { ShieldCheck, ShieldAlert, Copy, Check } from 'lucide-react'
import { userTwoFactorStatus, userTwoFactorStart, userTwoFactorConfirm, userTwoFactorDisable } from '@/api'
import { copyWithToast } from '@/lib/toast'

/**
 * Two-factor authentication settings.
 *
 * Three states: off, enrolling (secret + codes shown once), on. Recovery codes
 * are never retrievable again, so the enrolling step makes the user copy or
 * download them before the code is accepted.
 */
export default function TwoFactorSection() {
  const [status, setStatus] = useState(null)
  const [phase, setPhase] = useState('idle') // idle | enrolling | codes | disabling
  const [secret, setSecret] = useState('')
  const [otpauth, setOtpauth] = useState('')
  const [codes, setCodes] = useState([])
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')

  const refresh = () =>
    userTwoFactorStatus()
      .then((data) => setStatus(data))
      .catch(() => setStatus(null))

  useEffect(() => { refresh() }, [])

  const copy = async (text, what) => {
    if (await copyWithToast(text, `${what} copied`)) {
      setCopied(what)
      setTimeout(() => setCopied(''), 1500)
    }
  }

  const download = () => {
    const body = [
      'Sloth Lee Mail — two-factor recovery codes',
      'Each code works once. Keep them somewhere offline.',
      '',
      ...codes,
      '',
      `Generated ${new Date().toISOString()}`,
    ].join('\n')
    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'sloth-lee-recovery-codes.txt'
    link.click()
    URL.revokeObjectURL(url)
  }

  const start = async () => {
    setBusy(true); setError('')
    try {
      const data = await userTwoFactorStart()
      setSecret(data.secret)
      setOtpauth(data.otpauth_url)
      setCodes(data.recovery_codes || [])
      setPhase('enrolling')
    } catch (e) {
      setError(e?.response?.data?.error || 'Could not start setup')
    } finally { setBusy(false) }
  }

  const confirm = async (e) => {
    e?.preventDefault?.()
    setBusy(true); setError('')
    try {
      const data = await userTwoFactorConfirm(code)
      setCodes(data.recovery_codes || codes)
      setPhase('codes')
      refresh()
    } catch (err) {
      setError(err?.response?.data?.error || 'That code is not valid')
    } finally { setBusy(false) }
  }

  const disable = async (e) => {
    e?.preventDefault?.()
    setBusy(true); setError('')
    try {
      await userTwoFactorDisable(code)
      setCode(''); setPhase('idle'); refresh()
    } catch (err) {
      setError(err?.response?.data?.error || 'That code is not valid')
    } finally { setBusy(false) }
  }

  if (!status) return null

  const on = status.enabled

  return (
    <div data-testid="two-factor-section">
      <div className="flex items-center gap-2">
        {on
          ? <ShieldCheck className="w-4 h-4 text-emerald-400" />
          : <ShieldAlert className="w-4 h-4 text-amber-400" />}
        <span className="flex-1 text-[12px] text-ink-3">Second factor</span>
        <span className={`text-[11px] ${on ? 'text-emerald-400' : 'text-ink-3'}`}>
          {on ? 'on' : 'off'}
        </span>
      </div>

      {phase === 'idle' && (
        <>
          <p className="mt-1 text-[11px] text-ink-2">
            {on
              ? `On since ${new Date(status.enabled_at * 1000).toLocaleDateString()}. ${status.recovery_codes_remaining} recovery code${status.recovery_codes_remaining === 1 ? '' : 's'} left.`
              : 'A code from an authenticator app is required in addition to your password. Your password still decrypts your mail — this only guards sign-in.'}
          </p>
          <div className="mt-2 flex gap-2">
            {on ? (
              <button type="button" onClick={() => { setPhase('disabling'); setCode(''); setError('') }}
                className="rounded-md border border-line px-2 py-1 text-[11px] hover:bg-foreground/5">
                Turn off
              </button>
            ) : (
              <button type="button" onClick={start} disabled={busy}
                className="rounded-md bg-primary px-2 py-1 text-[11px] text-primary-foreground disabled:opacity-50">
                {busy ? 'Starting…' : 'Set up two-factor'}
              </button>
            )}
          </div>
        </>
      )}

      {phase === 'enrolling' && (
        <form onSubmit={confirm} className="mt-2 space-y-2">
          <p className="text-[11px] text-ink-2">
            Add this key to your authenticator app, then enter the six-digit code it shows.
          </p>
          <div className="flex items-center gap-2">
            <code data-testid="totp-secret" className="flex-1 rounded bg-foreground/5 px-2 py-1 text-[12px] tracking-wider break-all">
              {secret.match(/.{1,4}/g)?.join(' ')}
            </code>
            <button type="button" onClick={() => copy(secret, 'secret')} className="shrink-0 text-ink-2 hover:text-foreground" aria-label="Copy secret">
              {copied === 'secret' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
          <button type="button" onClick={() => copy(otpauth, 'uri')}
            className="text-[10px] text-primary hover:underline">
            {copied === 'uri' ? 'Link copied' : 'Copy otpauth:// link for a desktop app'}
          </button>
          <input
            id="totp-code" inputMode="numeric" autoComplete="one-time-code" value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="123456"
            className="w-full rounded-md border border-line bg-transparent px-2 py-1.5 text-sm tracking-[0.3em]"
          />
          <div className="flex gap-2">
            <button type="submit" disabled={busy || code.length !== 6}
              className="rounded-md bg-primary px-2 py-1 text-[11px] text-primary-foreground disabled:opacity-50">
              {busy ? 'Checking…' : 'Turn on'}
            </button>
            <button type="button" onClick={() => { setPhase('idle'); setCode(''); setError('') }}
              className="rounded-md border border-line px-2 py-1 text-[11px]">Cancel</button>
          </div>
        </form>
      )}

      {phase === 'codes' && (
        <div className="mt-2 space-y-2">
          <p className="text-[11px] text-amber-300">
            Save these now — they are shown once and each works a single time if you lose your phone.
          </p>
          <div data-testid="recovery-codes" className="grid grid-cols-2 gap-1 rounded bg-foreground/5 p-2 text-[12px] font-mono">
            {codes.map((c) => <span key={c}>{c}</span>)}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => copy(codes.join('\n'), 'codes')}
              className="rounded-md border border-line px-2 py-1 text-[11px]">
              {copied === 'codes' ? 'Copied' : 'Copy all'}
            </button>
            <button type="button" onClick={download} className="rounded-md border border-line px-2 py-1 text-[11px]">Download</button>
            <button type="button" onClick={() => { setPhase('idle'); setCodes([]) }}
              className="rounded-md bg-primary px-2 py-1 text-[11px] text-primary-foreground">I have saved them</button>
          </div>
        </div>
      )}

      {phase === 'disabling' && (
        <form onSubmit={disable} className="mt-2 space-y-2">
          <p className="text-[11px] text-ink-2">
            Enter a current code, or one of your recovery codes, to turn two-factor off.
          </p>
          <input
            id="totp-disable-code" value={code} autoComplete="one-time-code"
            onChange={(e) => setCode(e.target.value.trim().toUpperCase())}
            placeholder="123456 or A1B2C-3D4E5"
            className="w-full rounded-md border border-line bg-transparent px-2 py-1.5 text-sm"
          />
          <div className="flex gap-2">
            <button type="submit" disabled={busy || !code}
              className="rounded-md bg-destructive px-2 py-1 text-[11px] text-destructive-foreground disabled:opacity-50">
              {busy ? 'Checking…' : 'Turn off two-factor'}
            </button>
            <button type="button" onClick={() => { setPhase('idle'); setCode(''); setError('') }}
              className="rounded-md border border-line px-2 py-1 text-[11px]">Cancel</button>
          </div>
        </form>
      )}

      {error && <p data-testid="two-factor-error" className="mt-1 text-[11px] text-destructive">{error}</p>}
    </div>
  )
}
