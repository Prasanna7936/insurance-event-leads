import { useEffect, useState } from 'react'
import { formatDateTime } from '../lib/format'
import { isValidIndianMobile, normalizeIndianMobile } from '../lib/mobile'
import { whatsapp, WHATSAPP_MESSAGE } from '../lib/whatsapp'
import { useToast } from './ui'

type Stage = 'idle' | 'pending'

interface Props {
  /** Raw text from the Mobile Number field. */
  mobile: string
  verified: boolean
  verifiedAt?: string | null
  onVerified: (normalizedMobile: string) => void
  onReset: () => void
  disabled?: boolean
}

/**
 * Click-to-chat verification. The agent opens WhatsApp, sends the message, and
 * then attests to it. We never claim the message was delivered — WhatsApp gives
 * the page no such signal, so the "verified" state records the agent's word.
 */
export function WhatsAppVerify({
  mobile,
  verified,
  verifiedAt,
  onVerified,
  onReset,
  disabled = false,
}: Props) {
  const toast = useToast()
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState('')
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null)

  const normalized = normalizeIndianMobile(mobile)
  const valid = isValidIndianMobile(mobile)

  // Changing the number invalidates whatever was in flight.
  useEffect(() => {
    setStage('idle')
    setError('')
    setFallbackUrl(null)
  }, [normalized])

  function handleOpen() {
    const result = whatsapp.open(mobile)

    if (!result.ok) {
      setError(result.message ?? 'Could not open WhatsApp.')
      // A blocked pop-up still gives us a usable URL to offer as a link.
      setFallbackUrl(result.url ?? null)
      // The agent may still have sent it manually, so let them confirm.
      if (result.url) setStage('pending')
      return
    }

    setError('')
    setFallbackUrl(result.url ?? null)
    setStage('pending')
    toast(`WhatsApp opened for ${result.mobile}`, 'success')
  }

  if (verified) {
    return (
      <div className="otp otp--verified">
        <div className="otp__row" style={{ justifyContent: 'space-between' }}>
          <span className="verified-badge">
            ✓ Mobile Verified via WhatsApp — {normalized ?? mobile}
          </span>
          {!disabled && (
            <button type="button" className="btn btn--link" onClick={onReset}>
              Undo
            </button>
          )}
        </div>
        {verifiedAt && (
          <div className="field__hint" style={{ marginTop: 6 }}>
            Marked verified on {formatDateTime(verifiedAt)} · method: WhatsApp Manual
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={`otp${stage === 'pending' ? ' otp--pending' : ''}`}>
      <div className="otp__row">
        <button
          type="button"
          className="btn btn--success"
          onClick={handleOpen}
          disabled={!valid || disabled}
        >
          💬 Verify via WhatsApp
        </button>

        {stage === 'pending' && (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              if (!normalized) return
              onVerified(normalized)
              toast('Mobile marked verified via WhatsApp', 'success')
            }}
            disabled={disabled}
          >
            ✓ Mark Mobile Verified
          </button>
        )}

        <span className="field__hint" style={{ alignSelf: 'center' }}>
          {!mobile.trim()
            ? 'Enter the customer’s mobile number first.'
            : !valid
              ? 'Enter a valid 10-digit mobile number to message on WhatsApp.'
              : stage === 'pending'
                ? 'WhatsApp verification pending — send the message, then confirm.'
                : `Opens WhatsApp Web with a chat to ${normalized} and the welcome message ready to send.`}
        </span>
      </div>

      {stage === 'pending' && (
        <div className="otp__meta">
          <span>
            Delivery is not tracked. Only press <strong>Mark Mobile Verified</strong> once you
            have actually sent the message.
          </span>
        </div>
      )}

      {error && <div className="field__error" style={{ marginTop: 8 }}>{error}</div>}

      {fallbackUrl && (
        <div className="field__hint" style={{ marginTop: 8 }}>
          Didn’t open?{' '}
          <a href={fallbackUrl} target="_blank" rel="noopener noreferrer">
            Open WhatsApp Web manually
          </a>
        </div>
      )}

      <details className="wa-preview">
        <summary>Preview message</summary>
        <p>{WHATSAPP_MESSAGE}</p>
      </details>
    </div>
  )
}
