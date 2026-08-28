// -----------------------------------------------------------------------------
// Shared OTP helpers: mobile normalisation, hashing, and the MSG91 transport.
// Nothing in this file ever runs in the browser.
// -----------------------------------------------------------------------------

export const OTP_LENGTH = Number(Deno.env.get('OTP_LENGTH') ?? 6)
export const OTP_TTL_SECONDS = Number(Deno.env.get('OTP_TTL_SECONDS') ?? 300)
export const OTP_MAX_ATTEMPTS = Number(Deno.env.get('OTP_MAX_ATTEMPTS') ?? 5)
export const OTP_RESEND_COOLDOWN_SECONDS = Number(
  Deno.env.get('OTP_RESEND_COOLDOWN_SECONDS') ?? 45,
)
export const OTP_MAX_SENDS_PER_MOBILE_PER_HOUR = Number(
  Deno.env.get('OTP_MAX_SENDS_PER_MOBILE_PER_HOUR') ?? 5,
)
export const OTP_MAX_SENDS_PER_IP_PER_HOUR = Number(
  Deno.env.get('OTP_MAX_SENDS_PER_IP_PER_HOUR') ?? 40,
)

/**
 * Accepts the shapes people actually type at an event desk:
 *   9876543210, 09876543210, 919876543210, +91 98765 43210, 91-9876543210
 * and returns the canonical +91XXXXXXXXXX, or null when it is not a valid
 * Indian mobile number (10 digits starting 6-9).
 */
export function normalizeIndianMobile(raw: string): string | null {
  if (typeof raw !== 'string') return null
  let digits = raw.replace(/[^\d]/g, '')

  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)

  if (!/^[6-9]\d{9}$/.test(digits)) return null
  return `+91${digits}`
}

/** Cryptographically random numeric OTP. */
export function generateOtp(length = OTP_LENGTH): string {
  const bytes = new Uint32Array(length)
  crypto.getRandomValues(bytes)
  let otp = ''
  for (let i = 0; i < length; i++) otp += (bytes[i] % 10).toString()
  return otp
}

/**
 * The raw OTP is never stored. We keep sha256(otp:mobile:pepper) so a database
 * dump alone cannot be replayed, and the pepper lives only in the function's
 * environment.
 */
export async function hashOtp(otp: string, mobile: string): Promise<string> {
  const pepper = Deno.env.get('OTP_PEPPER') ?? ''
  const data = new TextEncoder().encode(`${otp}:${mobile}:${pepper}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Constant-time comparison so a wrong OTP leaks no timing information. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('cf-connecting-ip') ?? 'unknown'
}

// -----------------------------------------------------------------------------
// MSG91 transport
// -----------------------------------------------------------------------------
export interface SmsResult {
  ok: boolean
  requestId?: string
  error?: string
  /** true when no provider is configured and dev mode returned the OTP inline */
  devMode?: boolean
}

/**
 * Sends the OTP through MSG91.
 *
 * MSG91_ROUTE = "otp"  (default) -> POST https://control.msg91.com/api/v5/otp
 * MSG91_ROUTE = "flow"           -> POST https://control.msg91.com/api/v5/flow/
 *
 * Both routes carry the OTP that WE generated, so expiry, attempt counting and
 * rate limiting stay under our control in the database.
 */
export async function sendOtpSms(mobile: string, otp: string): Promise<SmsResult> {
  const authKey = Deno.env.get('MSG91_AUTH_KEY')
  const templateId = Deno.env.get('MSG91_TEMPLATE_ID')
  const senderId = Deno.env.get('MSG91_SENDER_ID')
  const route = (Deno.env.get('MSG91_ROUTE') ?? 'otp').toLowerCase()
  const devMode = (Deno.env.get('OTP_DEV_MODE') ?? 'false').toLowerCase() === 'true'

  // MSG91 wants the number without the leading "+".
  const msg91Mobile = mobile.replace(/^\+/, '')

  if (!authKey || !templateId) {
    if (devMode) {
      console.warn(
        'OTP_DEV_MODE is on and MSG91 is not configured — OTP returned in the response. NEVER enable this in production.',
      )
      return { ok: true, devMode: true }
    }
    return {
      ok: false,
      error:
        'SMS provider is not configured. Set MSG91_AUTH_KEY and MSG91_TEMPLATE_ID as function secrets.',
    }
  }

  const endpoint =
    route === 'flow'
      ? 'https://control.msg91.com/api/v5/flow/'
      : 'https://control.msg91.com/api/v5/otp'

  const otpVar = Deno.env.get('MSG91_OTP_VAR_NAME') ?? 'OTP'

  const body =
    route === 'flow'
      ? {
          template_id: templateId,
          short_url: '0',
          ...(senderId ? { sender: senderId } : {}),
          recipients: [{ mobiles: msg91Mobile, [otpVar]: otp }],
        }
      : {
          template_id: templateId,
          mobile: msg91Mobile,
          otp,
          otp_expiry: Math.ceil(OTP_TTL_SECONDS / 60),
          ...(senderId ? { sender: senderId } : {}),
        }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authkey: authKey,
        accept: 'application/json',
      },
      body: JSON.stringify(body),
    })

    const payload = await res.json().catch(() => ({}))

    // MSG91 answers 200 with { type: "success" | "error", message: "..." }
    if (!res.ok || payload?.type === 'error') {
      const message =
        typeof payload?.message === 'string' ? payload.message : `HTTP ${res.status}`
      console.error('MSG91 send failed', message)
      return { ok: false, error: `SMS provider rejected the request: ${message}` }
    }

    return {
      ok: true,
      requestId:
        typeof payload?.request_id === 'string'
          ? payload.request_id
          : typeof payload?.message === 'string'
            ? payload.message
            : undefined,
    }
  } catch (err) {
    console.error('MSG91 request threw', err)
    return { ok: false, error: 'Could not reach the SMS provider. Please retry.' }
  }
}
