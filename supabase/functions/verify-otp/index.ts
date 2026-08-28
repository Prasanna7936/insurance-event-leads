// -----------------------------------------------------------------------------
// POST /functions/v1/verify-otp   { "mobile": "9876543210", "otp": "123456" }
//
// On success the OTP row is marked verified. The leads table has a trigger that
// only accepts mobile_verified = true when such a row exists, so the browser
// cannot fake a verification.
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { corsHeaders, json } from '../_shared/cors.ts'
import { hashOtp, normalizeIndianMobile, timingSafeEqual } from '../_shared/otp.ts'

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization') ?? ''
  const { data: userData, error: userErr } = await admin.auth.getUser(
    authHeader.replace(/^Bearer\s+/i, ''),
  )
  if (userErr || !userData?.user) {
    return json(req, { error: 'Sign in to verify an OTP.' }, 401)
  }

  let payload: { mobile?: string; otp?: string }
  try {
    payload = await req.json()
  } catch {
    return json(req, { error: 'Invalid JSON body.' }, 400)
  }

  const mobile = normalizeIndianMobile(payload.mobile ?? '')
  const otp = (payload.otp ?? '').replace(/\D/g, '')

  if (!mobile) return json(req, { error: 'Invalid mobile number.' }, 400)
  if (!otp) return json(req, { error: 'Enter the OTP you received.' }, 400)

  const { data: row, error: rowErr } = await admin
    .from('otp_verifications')
    .select('*')
    .eq('mobile', mobile)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (rowErr) {
    console.error('otp lookup failed', rowErr)
    return json(req, { error: 'Could not verify right now. Please retry.' }, 500)
  }

  if (!row) {
    return json(req, { verified: false, error: 'Request an OTP first.' }, 400)
  }

  // Already verified within the trust window — treat as success (idempotent).
  if (row.verified) {
    return json(req, { verified: true, mobile, verifiedAt: row.verified_at })
  }

  if (row.consumed) {
    return json(
      req,
      { verified: false, error: 'This OTP is no longer valid. Request a new one.' },
      400,
    )
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await admin.from('otp_verifications').update({ consumed: true }).eq('id', row.id)
    return json(req, { verified: false, error: 'The OTP has expired. Request a new one.' }, 400)
  }

  if (row.attempts >= row.max_attempts) {
    await admin.from('otp_verifications').update({ consumed: true }).eq('id', row.id)
    return json(
      req,
      { verified: false, error: 'Too many incorrect attempts. Request a new OTP.' },
      429,
    )
  }

  const attempts = row.attempts + 1
  const candidate = await hashOtp(otp, mobile)

  if (!timingSafeEqual(candidate, row.otp_hash)) {
    const exhausted = attempts >= row.max_attempts
    await admin
      .from('otp_verifications')
      .update({ attempts, consumed: exhausted })
      .eq('id', row.id)

    return json(
      req,
      {
        verified: false,
        attemptsRemaining: Math.max(row.max_attempts - attempts, 0),
        error: exhausted
          ? 'Incorrect OTP. Attempt limit reached — request a new OTP.'
          : `Incorrect OTP. ${row.max_attempts - attempts} attempt(s) left.`,
      },
      400,
    )
  }

  const verifiedAt = new Date().toISOString()
  const { error: updateErr } = await admin
    .from('otp_verifications')
    .update({ attempts, verified: true, verified_at: verifiedAt, consumed: true })
    .eq('id', row.id)

  if (updateErr) {
    console.error('otp update failed', updateErr)
    return json(req, { error: 'Could not complete verification. Please retry.' }, 500)
  }

  return json(req, { verified: true, mobile, verifiedAt })
})
