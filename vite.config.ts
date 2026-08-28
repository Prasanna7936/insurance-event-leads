import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')

  // Vite inlines VITE_* values at BUILD time. If the Supabase variables are
  // missing when Vercel builds, the bundle silently falls back to demo mode and
  // ships a localStorage-only app to production. Fail loudly instead.
  if (command === 'build' && mode === 'production') {
    const missing = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'].filter((k) => !env[k])
    if (missing.length > 0) {
      throw new Error(
        `\n\nProduction build aborted: ${missing.join(', ')} not set.\n` +
          `Without them the app builds in demo mode (browser-only storage).\n` +
          `Add them in Vercel under Settings -> Environment Variables, then redeploy.\n`,
      )
    }
    const usingMvpAuth = (env.VITE_AUTH_PROVIDER ?? 'mvp') !== 'supabase'
    if (usingMvpAuth && !env.VITE_ADMIN_PASSWORD_SHA256) {
      throw new Error(
        `\n\nProduction build aborted: VITE_ADMIN_PASSWORD_SHA256 not set.\n` +
          `The MVP admin login has no default password — set the hash in Vercel:\n` +
          `  node -e "console.log(require('crypto').createHash('sha256').update('YourPassword').digest('hex'))"\n`,
      )
    }
  }

  return {
    plugins: [react()],
    server: { port: 5173, host: true },
    build: { sourcemap: false },
  }
})
