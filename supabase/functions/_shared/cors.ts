// Allowed browser origins for the OTP endpoints. Set ALLOWED_ORIGINS to a comma
// separated list in production (e.g. "https://leads.example.com"). Defaults to
// "*" so local development works out of the box.
const allowList = (Deno.env.get('ALLOWED_ORIGINS') ?? '*')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? ''
  const allowed = allowList.includes('*')
    ? '*'
    : allowList.includes(origin)
      ? origin
      : allowList[0] ?? ''

  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}
