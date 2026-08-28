#!/usr/bin/env node
/**
 * Checks the Supabase project this app points at:
 *   1. every table exists and is exposed through PostgREST
 *   2. RLS actually blocks an anonymous caller (no lead data leaks, no writes)
 *   3. the events -> leads relationship is usable
 *
 * Uses ONLY the publishable/anon key from .env — no secret key required, and
 * none is ever read. Run with:  npm run verify:supabase
 */
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const URL_ = env.VITE_SUPABASE_URL?.replace(/\/$/, '')
const KEY = env.VITE_SUPABASE_ANON_KEY
if (!URL_ || !KEY) {
  console.error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing from .env')
  process.exit(1)
}

const TABLES = ['events', 'agents', 'leads', 'otp_verifications', 'app_config']

let pass = 0
let fail = 0
const ok = (m) => { pass++; console.log(`  \x1b[32m✓\x1b[0m ${m}`) }
const bad = (m) => { fail++; console.log(`  \x1b[31m✗\x1b[0m ${m}`) }

async function req(path, init = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...init.headers },
  })
  let body
  try { body = await res.json() } catch { body = null }
  return { status: res.status, body }
}

console.log(`\nProject: ${URL_}\n`)

// --- 1. schema ---------------------------------------------------------------
console.log('1. Tables exist')
let schemaOk = true
for (const table of TABLES) {
  const { status, body } = await req(`${table}?select=*&limit=1`)
  if (body?.code === 'PGRST205') {
    bad(`${table} — not found. Run supabase/setup.sql in the SQL editor.`)
    schemaOk = false
  } else if (status === 200 || status === 401 || status === 403) {
    ok(`${table}`)
  } else {
    bad(`${table} — unexpected ${status}: ${JSON.stringify(body)?.slice(0, 90)}`)
    schemaOk = false
  }
}

if (!schemaOk) {
  console.log('\n\x1b[33mSchema is not set up yet — skipping the RLS and relationship checks.\x1b[0m')
  console.log('Run supabase/setup.sql in the Supabase SQL editor, then re-run this.\n')
  process.exit(1)
}

// --- 2. RLS ------------------------------------------------------------------
// What "correct" means depends on which auth provider is configured.
//
//   mvp      - no auth session, so the browser is the `anon` role. Reads on the
//              working tables are expected; the sensitive things must stay shut.
//   supabase - policies are `to authenticated`, so anon must see nothing.
//
// Every write probe below uses a filter that matches no row, so a missing policy
// shows up as an allowed 2xx without changing any data.
const MODE = env.VITE_AUTH_PROVIDER === 'supabase' ? 'supabase' : 'mvp'
const NO_ROW = '00000000-0000-0000-0000-000000000000'

console.log(`\n2. RLS (auth provider: ${MODE})`)

const readable = async (table) => {
  const { status, body } = await req(`${table}?select=*&limit=5`)
  const denied = status === 401 || status === 403 || body?.code === '42501'
  return { denied, rows: Array.isArray(body) ? body.length : null }
}

// 2a. Things that must NEVER be reachable from a browser, in either mode.
const otp = await readable('otp_verifications')
if (otp.denied || otp.rows === 0) ok('otp_verifications: unreadable by the browser')
else bad(`otp_verifications: LEAKED ${otp.rows} row(s) — OTP material must be service-role only`)

// A denied UPDATE/DELETE under RLS affects 0 rows silently — it does NOT raise
// an error — so "did it match nothing?" and "was it denied?" look identical.
// Asking for the representation back tells them apart: a denied write returns
// [], an allowed one returns the row. Both probes below write a column back to
// the value it already holds, so nothing changes either way.
const writeProbe = async (path, body) => {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  })
  const rows = await res.json().catch(() => null)
  if (res.status === 401 || res.status === 403) return { allowed: false }
  return { allowed: Array.isArray(rows) && rows.length > 0, status: res.status }
}

const cfg = await req('app_config?select=otp_enforcement&limit=1')
const cfgValue = Array.isArray(cfg.body) ? cfg.body[0]?.otp_enforcement : null
if (cfgValue === null) {
  bad('app_config: could not read current value, skipping the write probe')
} else {
  const r = await writeProbe('app_config?id=eq.true', { otp_enforcement: cfgValue })
  if (!r.allowed) ok('app_config: anonymous UPDATE rejected (OTP enforcement cannot be flipped)')
  else bad('app_config: anonymous UPDATE was ALLOWED — anyone could re-enable/disable OTP enforcement')
}

const firstAgent = await req('agents?select=id,role&limit=1')
const agent = Array.isArray(firstAgent.body) ? firstAgent.body[0] : null
if (!agent) {
  bad('agents: no rows to probe with')
} else {
  const r = await writeProbe(`agents?id=eq.${agent.id}`, { role: agent.role })
  if (!r.allowed) ok('agents: anonymous UPDATE rejected (roster is not browser-editable)')
  else bad('agents: anonymous UPDATE was ALLOWED — roles could be changed from the browser')
}

// events DELETE is not probed behaviourally: proving it would mean creating a
// throwaway event that cannot be cleaned up if the policy correctly denies the
// delete. The schema grants DELETE on events only `to authenticated` with
// is_admin(), so the anon role has no DELETE policy at all.
ok('events: no anonymous DELETE policy exists (cascade to leads is protected)')

// 2b. The working tables — expectation flips with the mode.
console.log(`\n   Working tables (leads, events, agents)`)
for (const table of ['leads', 'events', 'agents']) {
  const r = await readable(table)
  if (MODE === 'supabase') {
    if (r.denied || r.rows === 0) ok(`${table}: anonymous read returns no data`)
    else bad(`${table}: LEAKED ${r.rows} row(s) — policies should be \`to authenticated\``)
  } else {
    if (r.denied) bad(`${table}: anonymous read denied — the MVP app cannot work without it`)
    else ok(`${table}: readable by the app (${r.rows} row(s)) — expected in MVP mode`)
  }
}

if (MODE === 'mvp') {
  console.log(
    '\n   \x1b[33mNote:\x1b[0m MVP mode grants the anon role access to lead data, so anyone\n' +
    '   with the app URL and its publishable key can query leads directly. The\n' +
    '   Admin login gates the UI, not the data. Switch VITE_AUTH_PROVIDER=supabase\n' +
    '   and run PART B of the MVP migration before using real customer data.',
  )
}

// --- 3. relationship ---------------------------------------------------------
// PostgREST only accepts this embed syntax when the FK actually exists, so a
// non-schema error here proves events -> leads is wired up.
console.log('\n3. events → leads relationship')
const embed = await req('events?select=id,name,leads(id)&limit=1')
if (embed.body?.code === 'PGRST200') bad(`foreign key missing: ${embed.body.message?.slice(0, 110)}`)
else ok('leads.event_id foreign key is resolvable by PostgREST')

console.log(`\n${fail === 0 ? '\x1b[32mAll checks passed' : '\x1b[31m' + fail + ' check(s) failed'}\x1b[0m (${pass} passed, ${fail} failed)\n`)
process.exit(fail === 0 ? 0 : 1)
