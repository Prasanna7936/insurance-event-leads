import { isSupabaseConfigured } from './supabase'

/**
 * SMS/OTP verification switch — OFF unless explicitly turned on.
 *
 * The OTP panel renders only when VITE_SMS_OTP_ENABLED is exactly the string
 * "true". Anything else — missing, empty, "false", "0", a typo — leaves it
 * hidden.
 *
 * The default is deliberately the disabled state. OTP needs three things that
 * are all currently absent (a Supabase Auth session for the function call, the
 * deployed send-otp/verify-otp functions, and MSG91 credentials), so a build
 * that quietly defaulted to "on" could only ever show agents a button that
 * fails. Requiring an explicit opt-in means forgetting the variable produces
 * the working configuration, not the broken one.
 *
 * Turning it back on also needs the database to agree — see the
 * `otp_enforcement` flag in `public.app_config`.
 *
 * None of the OTP implementation is removed by this: OtpPanel, the api.ts
 * callers and the edge functions all remain in the source.
 */
export const SMS_OTP_ENABLED =
  isSupabaseConfigured && import.meta.env.VITE_SMS_OTP_ENABLED === 'true'

/**
 * Demo mode: no Supabase configured, so leads live in this browser's
 * localStorage. Clearly flagged in the UI — it is not a database.
 */
export const DEMO_MODE = !isSupabaseConfigured
