// -----------------------------------------------------------------------------
// POST /functions/v1/send-otp   { "mobile": "9876543210" }
//
// Generates an OTP, stores only its hash, and sends it through MSG91.
// Requires a signed-in agent (the platform verifies the JWT before we run).
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { corsHeaders, json } from '../_shared/cors.ts'
import {
  clientIp,
  generateOtp,
  hashOtp,
  normalizeIndianMobile,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_SENDS_PER_IP_PER_HOUR,
  OTP_MAX_SENDS_PER_MOBILE_PER_HOUR,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_SECONDS,
  sendOtpSms,
} from '../_shared/otp.ts'

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)

  // --- caller must be a signed-in agent -------------------------------------
  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt)
  if (userErr || !userData?.user) {
    return json(req, { error: 'Sign in to send an OTP.' }, 401)
  }

  // --- input ----------------------------------------------------------------
  let payload: { mobile?: string }
  try {
    payload = await req.json()
  } catch {
    return json(req, { error: 'Invalid JSON body.' }, 400)
  }

  const mobile = normalizeIndianMobile(payload.mobile ?? '')
  if (!mobile) {
    return json(
      req,
      { error: 'Enter a valid 10-digit Indian mobile number starting with 6-9.' },
      400,
    )
  }

  const ip = clientIp(req)
  const now = Date.now()
  const hourAgo = new Date(now - 60 * 60 * 1000).toISOString()

  // --- rate limiting --------------------------------------------------------
  const { data: recent, error: recentErr } = await admin
    .from('otp_verifications')
    .select('created_at')
    .eq('mobile', mobile)
    .gte('created_at', hourAgo)
    .order('created_at', { ascending: false })

  if (recentErr) {
    console.error('rate-limit lookup failed', recentErr)
    return json(req, { error: 'Could not start verification. Please retry.' }, 500)
  }

  if (recent && recent.length > 0) {
    const lastSentAt = new Date(recent[0].created_at).getTime()
    const elapsed = Math.floor((now - lastSentAt) / 1000)
    if (elapsed < OTP_RESEND_COOLDOWN_SECONDS) {
      return json(
        req,
        {
          error: `Please wait ${OTP_RESEND_COOLDOWN_SECONDS - elapsed}s before requesting another OTP.`,
          retryAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS - elapsed,
        },
        429,
      )
    }
  }

  if ((recent?.length ?? 0) >= OTP_MAX_SENDS_PER_MOBILE_PER_HOUR) {
    return json(
      req,
      {
        error: `This number has reached the limit of ${OTP_MAX_SENDS_PER_MOBILE_PER_HOUR} OTPs per hour. Try again later.`,
      },
      429,
    )
  }

  const { count: ipCount } = await admin
    .from('otp_verifications')
    .select('id', { count: 'exact', head: true })
    .eq('request_ip', ip)
    .gte('created_at', hourAgo)

  if ((ipCount ?? 0) >= OTP_MAX_SENDS_PER_IP_PER_HOUR) {
    return json(req, { error: 'Too many OTP requests from this device. Try again later.' }, 429)
  }

  // --- issue the OTP --------------------------------------------------------
  const otp = generateOtp()
  const otpHash = await hashOtp(otp, mobile)
  const expiresAt = new Date(now + OTP_TTL_SECONDS * 1000).toISOString()

  // Any earlier pending OTP for this number stops being valid.
  await admin
    .from('otp_verifications')
    .update({ consumed: true })
    .eq('mobile', mobile)
    .eq('consumed', false)
    .eq('verified', false)

  const sms = await sendOtpSms(mobile, otp)
  if (!sms.ok) return json(req, { error: sms.error ?? 'Could not send the OTP.' }, 502)

  const { error: insertErr } = await admin.from('otp_verifications').insert({
    mobile,
    otp_hash: otpHash,
    expires_at: expiresAt,
    max_attempts: OTP_MAX_ATTEMPTS,
    request_ip: ip,
    provider_request_id: sms.requestId ?? null,
  })

  if (insertErr) {
    console.error('otp insert failed', insertErr)
    return json(req, { error: 'Could not start verification. Please retry.' }, 500)
  }

  // Opportunistic housekeeping: OTP rows older than a day are of no use.
  admin
    .from('otp_verifications')
    .delete()
    .lt('created_at', new Date(now - 24 * 60 * 60 * 1000).toISOString())
    .then(() => {})

  return json(req, {
    success: true,
    mobile,
    expiresAt,
    expiresInSeconds: OTP_TTL_SECONDS,
    resendAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS,
    maxAttempts: OTP_MAX_ATTEMPTS,
    // Only ever present when OTP_DEV_MODE=true and no provider is configured.
    ...(sms.devMode ? { devOtp: otp } : {}),
  })
})
