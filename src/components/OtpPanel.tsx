import { useEffect, useRef, useState } from 'react'
import { sendOtp, verifyOtp } from '../lib/api'
import { isValidIndianMobile, normalizeIndianMobile } from '../lib/mobile'
import { Spinner, useToast } from './ui'

type Stage = 'idle' | 'sent'

interface Props {
  /** Raw text from the mobile field. */
  mobile: string
  verified: boolean
  onVerified: (normalizedMobile: string, verifiedAt: string) => void
  /** Called when the agent wants to change an already-verified number. */
  onReset: () => void
  disabled?: boolean
}

function mmss(seconds: number): string {
  const s = Math.max(0, seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function OtpPanel({ mobile, verified, onVerified, onReset, disabled = false }: Props) {
  const toast = useToast()
  const [stage, setStage] = useState<Stage>('idle')
  const [otp, setOtp] = useState('')
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState('')
  const [expiresAt, setExpiresAt] = useState(0)
  const [resendAt, setResendAt] = useState(0)
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null)
  const [devOtp, setDevOtp] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const otpInputRef = useRef<HTMLInputElement>(null)

  const normalized = normalizeIndianMobile(mobile)
  const valid = isValidIndianMobile(mobile)

  // A ticking clock drives both countdowns.
  useEffect(() => {
    if (stage !== 'sent') return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [stage])

  // Editing the number invalidates anything already in flight.
  useEffect(() => {
    setStage('idle')
    setOtp('')
    setError('')
    setAttemptsLeft(null)
    setDevOtp(null)
  }, [normalized])

  const secondsToExpiry = Math.ceil((expiresAt - now) / 1000)
  const secondsToResend = Math.ceil((resendAt - now) / 1000)
  const expired = stage === 'sent' && secondsToExpiry <= 0

  async function handleSend() {
    if (!normalized || sending) return
    setSending(true)
    setError('')
    setDevOtp(null)
    try {
      const res = await sendOtp(normalized)
      setStage('sent')
      setOtp('')
      setAttemptsLeft(res.maxAttempts)
      const t = Date.now()
      setNow(t)
      setExpiresAt(t + res.expiresInSeconds * 1000)
      setResendAt(t + res.resendAfterSeconds * 1000)
      if (res.devOtp) setDevOtp(res.devOtp)
      toast(`OTP sent to ${normalized}`, 'success')
      setTimeout(() => otpInputRef.current?.focus(), 60)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not send the OTP.'
      setError(message)
      // A 429 tells us exactly how long the wait is; honour it in the UI.
      const retryAfter = (err as { retryAfterSeconds?: number })?.retryAfterSeconds
      if (retryAfter) {
        const t = Date.now()
        setNow(t)
        setResendAt(t + retryAfter * 1000)
        setStage('sent')
      }
    } finally {
      setSending(false)
    }
  }

  async function handleVerify() {
    if (!normalized || otp.length < 4 || verifying) return
    setVerifying(true)
    setError('')
    try {
      const res = await verifyOtp(normalized, otp)
      if (res.verified) {
        onVerified(normalized, res.verifiedAt ?? new Date().toISOString())
        toast('Mobile number verified', 'success')
      } else {
        setError('Verification failed. Please retry.')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Verification failed.'
      setError(message)
      const remaining = (err as { attemptsRemaining?: number })?.attemptsRemaining
      if (typeof remaining === 'number') setAttemptsLeft(remaining)
      setOtp('')
    } finally {
      setVerifying(false)
    }
  }

  if (verified) {
    return (
      <div className="otp otp--verified">
        <div className="otp__row" style={{ justifyContent: 'space-between' }}>
          <span className="verified-badge">✓ Mobile Verified — {normalized ?? mobile}</span>
          {!disabled && (
            <button type="button" className="btn btn--link" onClick={onReset}>
              Change number
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={`otp${stage === 'sent' ? ' otp--pending' : ''}`}>
      {stage === 'idle' ? (
        <>
          <div className="otp__row">
            <button
              type="button"
              className="btn btn--primary"
              onClick={handleSend}
              disabled={!valid || sending || disabled}
            >
              {sending ? <><Spinner /> Sending…</> : '📩 Send OTP'}
            </button>
            <span className="field__hint" style={{ alignSelf: 'center' }}>
              {valid
                ? `An OTP will be sent to ${normalized} by SMS.`
                : 'Enter a valid 10-digit mobile number to send an OTP.'}
            </span>
          </div>
          {error && <div className="field__error" style={{ marginTop: 8 }}>{error}</div>}
        </>
      ) : (
        <>
          <div className="otp__row">
            <div className="otp__grow">
              <label className="field__label" htmlFor="otp-code">Enter OTP</label>
              <input
                id="otp-code"
                ref={otpInputRef}
                className="input otp__code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="······"
                value={otp}
                disabled={expired || disabled}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void handleVerify()
                  }
                }}
              />
            </div>
            <button
              type="button"
              className="btn btn--success"
              onClick={handleVerify}
              disabled={otp.length < 4 || verifying || expired || disabled}
            >
              {verifying ? <><Spinner /> Verifying…</> : '✓ Verify OTP'}
            </button>
          </div>

          <div className="otp__meta">
            {expired ? (
              <span className="field__error">OTP expired. Request a new one.</span>
            ) : (
              <span className="otp__timer">Expires in {mmss(secondsToExpiry)}</span>
            )}

            {secondsToResend > 0 ? (
              <span>Resend available in {secondsToResend}s</span>
            ) : (
              <button
                type="button"
                className="btn btn--link"
                onClick={handleSend}
                disabled={sending || disabled}
              >
                {sending ? 'Sending…' : 'Resend OTP'}
              </button>
            )}

            {attemptsLeft !== null && !expired && (
              <span>{attemptsLeft} attempt{attemptsLeft === 1 ? '' : 's'} left</span>
            )}
          </div>

          {error && <div className="field__error" style={{ marginTop: 8 }}>{error}</div>}

          {devOtp && (
            <div className="dev-otp">
              DEV MODE — no SMS provider configured. OTP is <strong>{devOtp}</strong>.
              Set MSG91 secrets and turn OTP_DEV_MODE off before going live.
            </div>
          )}
        </>
      )}
    </div>
  )
}
