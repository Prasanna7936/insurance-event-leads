// -----------------------------------------------------------------------------
// WhatsApp verification.
//
// MVP uses click-to-chat: we open WhatsApp Web with the customer's number and a
// pre-filled message, the agent presses send, and the agent then attests that it
// went through. There is NO API integration and NO delivery or read receipt —
// WhatsApp click-to-chat gives the page no feedback whatsoever, so anything the
// app claimed about delivery would be a guess.
//
// The channel is behind an interface so a WhatsApp Business API implementation
// can be added later without touching the UI: implement `WhatsAppChannel` with
// kind: 'business-api', post to an edge function that holds the token, and swap
// the export at the bottom. Same shape as the AuthProvider in ./auth.
// -----------------------------------------------------------------------------
import { normalizeIndianMobile } from './mobile'

export type WhatsAppFailure =
  | 'missing-mobile'
  | 'invalid-mobile'
  | 'popup-blocked'
  | 'open-failed'

export interface WhatsAppResult {
  ok: boolean
  /** The URL used, so the UI can offer it as a manual fallback link. */
  url?: string
  mobile?: string
  failure?: WhatsAppFailure
  message?: string
}

export interface WhatsAppChannel {
  readonly kind: 'click-to-chat' | 'business-api'
  /** True when a human must press send themselves (click-to-chat does). */
  readonly requiresManualSend: boolean
  buildUrl(mobile: string): string | null
  open(mobile: string): WhatsAppResult
}

/** The message pre-filled into the chat. Override with VITE_WHATSAPP_MESSAGE. */
export const WHATSAPP_MESSAGE: string =
  (import.meta.env.VITE_WHATSAPP_MESSAGE as string) ||
  'Welcome to Ravikumar Insurance. Thank you for visiting our insurance event. ' +
    'We would be happy to assist you with your insurance requirements.'

const FAILURE_TEXT: Record<WhatsAppFailure, string> = {
  'missing-mobile': 'Enter the customer’s mobile number first.',
  'invalid-mobile': 'Enter a valid 10-digit Indian mobile number before sending on WhatsApp.',
  'popup-blocked':
    'Your browser blocked the WhatsApp window. Allow pop-ups for this site, or use the link below.',
  'open-failed': 'WhatsApp Web could not be opened. Use the link below instead.',
}

function createClickToChatChannel(): WhatsAppChannel {
  return {
    kind: 'click-to-chat',
    requiresManualSend: true,

    buildUrl(mobile) {
      const normalized = normalizeIndianMobile(mobile)
      if (!normalized) return null
      // web.whatsapp.com/send wants the number with the country code and no '+'.
      const digits = normalized.replace(/^\+/, '')
      return `https://web.whatsapp.com/send?phone=${digits}&text=${encodeURIComponent(WHATSAPP_MESSAGE)}`
    },

    open(mobile) {
      if (!mobile || !mobile.trim()) {
        return { ok: false, failure: 'missing-mobile', message: FAILURE_TEXT['missing-mobile'] }
      }

      const normalized = normalizeIndianMobile(mobile)
      if (!normalized) {
        return { ok: false, failure: 'invalid-mobile', message: FAILURE_TEXT['invalid-mobile'] }
      }

      const url = this.buildUrl(mobile)!

      let handle: Window | null = null
      try {
        handle = window.open(url, '_blank', 'noopener,noreferrer')
      } catch {
        return { ok: false, url, mobile: normalized, failure: 'open-failed', message: FAILURE_TEXT['open-failed'] }
      }

      // A null handle is the classic pop-up blocker signature. Note this only
      // tells us the tab opened — never that the message was seen or sent.
      if (!handle) {
        return { ok: false, url, mobile: normalized, failure: 'popup-blocked', message: FAILURE_TEXT['popup-blocked'] }
      }

      return { ok: true, url, mobile: normalized }
    },
  }
}

export const whatsapp: WhatsAppChannel = createClickToChatChannel()

/** Off only if explicitly disabled, so the button is there by default. */
export const WHATSAPP_VERIFICATION_ENABLED =
  import.meta.env.VITE_WHATSAPP_VERIFICATION_ENABLED !== 'false'
