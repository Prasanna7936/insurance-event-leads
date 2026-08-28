import { isSupabaseConfigured } from './supabase'

/**
 * SMS/OTP verification switch.
 *
 * VITE_SMS_OTP_ENABLED=false hides the OTP panel entirely and lets an agent tick
 * "Mobile Verified" by hand. The database must agree — see the
 * `otp_enforcement` flag in `public.app_config`.
 *
 * Without a Supabase project there is no MSG91 either, so demo mode implies it.
 */
export const SMS_OTP_ENABLED =
  isSupabaseConfigured && import.meta.env.VITE_SMS_OTP_ENABLED !== 'false'

/**
 * Demo mode: no Supabase configured, so leads live in this browser's
 * localStorage. Clearly flagged in the UI — it is not a database.
 */
export const DEMO_MODE = !isSupabaseConfigured
