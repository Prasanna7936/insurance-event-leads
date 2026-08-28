// -----------------------------------------------------------------------------
// Authentication behind one small interface.
//
// The app only ever talks to `auth`. Two implementations satisfy it:
//
//   mvpAdminAuth  — a single built-in Admin login, checked in the browser.
//                   No registration, no password reset, no Supabase Auth user.
//   supabaseAuth  — real per-user Supabase Authentication.
//
// Switching is one environment variable (VITE_AUTH_PROVIDER) plus the matching
// RLS policies. No component changes.
//
// SECURITY NOTE ON THE MVP PROVIDER
// A credential check that runs in the browser can always be bypassed by editing
// the JavaScript. It gates the interface, not the data — the data is guarded by
// RLS. Treat it as a demo lock, not as access control.
// -----------------------------------------------------------------------------
import { supabase } from './supabase'

export interface AuthSession {
  /** Stable id for the signed-in principal. */
  userId: string
  /** What to show in the header. */
  displayName: string
  role: 'admin' | 'agent'
  startedAt: string
}

export interface AuthProvider {
  readonly kind: 'mvp-admin' | 'supabase'
  /** True when the provider offers a password field (both do today). */
  readonly usesPassword: boolean
  /** Label for the identifier field — "User ID" vs "Email". */
  readonly identifierLabel: string
  getSession(): Promise<AuthSession | null>
  signIn(identifier: string, password: string): Promise<AuthSession>
  signOut(): Promise<void>
  /** Subscribe to sign-in/sign-out. Returns an unsubscribe function. */
  onChange(callback: (session: AuthSession | null) => void): () => void
}

export class AuthError extends Error {}

// -----------------------------------------------------------------------------
// MVP: one built-in Admin account
// -----------------------------------------------------------------------------

const ADMIN_USER = (import.meta.env.VITE_ADMIN_USER as string) || 'Admin'

/**
 * SHA-256 of the admin password, supplied by the environment. There is
 * deliberately NO fallback: a default baked into the source would be a
 * committed credential, and every deployment would silently share it.
 * Generate one with:
 *   node -e "console.log(require('crypto').createHash('sha256').update('NEW').digest('hex'))"
 */
const ADMIN_PASSWORD_SHA256 = (import.meta.env.VITE_ADMIN_PASSWORD_SHA256 as string) ?? ''

const SESSION_KEY = 'iel.session.v1'
/** Sessions last a long event day, then require signing in again. */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Comparison that does not leak how much of the hash matched. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function createMvpAdminAuth(): AuthProvider {
  const listeners = new Set<(session: AuthSession | null) => void>()
  const emit = (session: AuthSession | null) => listeners.forEach((l) => l(session))

  const readStored = (): AuthSession | null => {
    try {
      const raw = localStorage.getItem(SESSION_KEY)
      if (!raw) return null
      const session = JSON.parse(raw) as AuthSession
      if (Date.now() - new Date(session.startedAt).getTime() > SESSION_TTL_MS) {
        localStorage.removeItem(SESSION_KEY)
        return null
      }
      return session
    } catch {
      return null
    }
  }

  return {
    kind: 'mvp-admin',
    usesPassword: true,
    identifierLabel: 'User ID',

    async getSession() {
      return readStored()
    },

    async signIn(identifier, password) {
      if (!ADMIN_PASSWORD_SHA256) {
        throw new AuthError(
          'Admin login is not configured: VITE_ADMIN_PASSWORD_SHA256 is not set.',
        )
      }

      const idOk = identifier.trim().toLowerCase() === ADMIN_USER.toLowerCase()
      const pwOk = timingSafeEqual(await sha256Hex(password), ADMIN_PASSWORD_SHA256)

      // One message for either failure, so the form does not confirm which half
      // was right.
      if (!idOk || !pwOk) throw new AuthError('Incorrect user ID or password.')

      const session: AuthSession = {
        userId: 'mvp-admin',
        displayName: ADMIN_USER,
        role: 'admin',
        startedAt: new Date().toISOString(),
      }
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(session))
      } catch {
        // private browsing — the session simply will not survive a reload
      }
      emit(session)
      return session
    },

    async signOut() {
      try {
        localStorage.removeItem(SESSION_KEY)
      } catch {
        // nothing to clean up
      }
      emit(null)
    },

    onChange(callback) {
      listeners.add(callback)
      return () => listeners.delete(callback)
    },
  }
}

// -----------------------------------------------------------------------------
// Production: real Supabase Authentication
// -----------------------------------------------------------------------------

function createSupabaseAuth(): AuthProvider {
  const toSession = (user: { id: string; email?: string } | undefined): AuthSession | null =>
    user
      ? {
          userId: user.id,
          displayName: user.email ?? user.id,
          role: 'agent',
          startedAt: new Date().toISOString(),
        }
      : null

  return {
    kind: 'supabase',
    usesPassword: true,
    identifierLabel: 'Email',

    async getSession() {
      const { data } = await supabase.auth.getSession()
      return toSession(data.session?.user)
    },

    async signIn(identifier, password) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: identifier.trim(),
        password,
      })
      if (error) throw new AuthError(error.message)
      const session = toSession(data.session?.user)
      if (!session) throw new AuthError('Sign in failed.')
      return session
    },

    async signOut() {
      await supabase.auth.signOut()
    },

    onChange(callback) {
      const { data } = supabase.auth.onAuthStateChange((_event, next) =>
        callback(toSession(next?.user)),
      )
      return () => data.subscription.unsubscribe()
    },
  }
}

// -----------------------------------------------------------------------------

export const auth: AuthProvider =
  (import.meta.env.VITE_AUTH_PROVIDER as string) === 'supabase'
    ? createSupabaseAuth()
    : createMvpAdminAuth()
