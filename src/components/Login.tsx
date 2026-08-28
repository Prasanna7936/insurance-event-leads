import { useState } from 'react'
import { auth } from '../lib/auth'
import { Field, Spinner } from './ui'

/**
 * MVP sign-in: one built-in Admin account, no registration and no password
 * reset by design. The field labels come from the auth provider, so switching
 * to real Supabase Authentication needs no change here.
 */
export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await auth.signIn(identifier, password)
      onSignedIn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.')
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand">
          <h1 className="login-brand__title">EVENT DATA COLLECTION</h1>
          <div className="login-brand__sub">Insurance agent lead capture</div>
        </div>

        <form className="card" onSubmit={submit}>
          <div className="card__head"><h3 className="card__title">Sign in</h3></div>
          <div className="card__body">
            <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
              <Field label={auth.identifierLabel} required>
                <input
                  className={`input${error ? ' input--error' : ''}`}
                  autoComplete="username"
                  autoCapitalize="none"
                  autoFocus
                  value={identifier}
                  onChange={(e) => { setIdentifier(e.target.value); setError('') }}
                  required
                />
              </Field>
              <Field label="Password" required error={error}>
                <input
                  className={`input${error ? ' input--error' : ''}`}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError('') }}
                  required
                />
              </Field>
            </div>
          </div>
          <div className="modal__foot">
            <button className="btn btn--primary btn--block btn--lg" type="submit" disabled={busy}>
              {busy ? <><Spinner /> Signing in…</> : 'Sign in'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
