# Deploying to Vercel

Target domain: **insurance.beingprasanna.com**

---

## 1. Environment variables

Add these in Vercel → your project → **Settings → Environment Variables**.
Tick **Production**, **Preview** and **Development** for each one.

| Name | Value | Why |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | copy from your local `.env` | Which Supabase project to talk to |
| `VITE_SUPABASE_ANON_KEY` | your `sb_publishable_…` key | Public key; RLS is what actually guards the data |
| `VITE_AUTH_PROVIDER` | `mvp` | Single built-in Admin login |
| `VITE_ADMIN_USER` | `Admin` | Login user ID |
| `VITE_ADMIN_PASSWORD_SHA256` | the SHA-256 hash from your local `.env` | Password is never stored in plaintext |
| `VITE_SMS_OTP_ENABLED` | `false` | MSG91 is not connected |

Copy the exact values from your local `.env` — it is git-ignored and never
leaves your machine.

> **Do not** add `SUPABASE_SERVICE_ROLE_KEY`, `MSG91_AUTH_KEY`, or any `sb_secret_…`
> key here. Everything prefixed `VITE_` is compiled into the JavaScript bundle
> and is publicly readable. Those secrets belong only in Supabase Edge Function
> secrets.

### Changing the admin password

```bash
node -e "console.log(require('crypto').createHash('sha256').update('YourNewPassword').digest('hex'))"
```

Put the output in `VITE_ADMIN_PASSWORD_SHA256` (Vercel **and** your local `.env`)
and redeploy. Do this before the app is publicly reachable.

---

## 2. Deploy from GitHub

1. Go to **https://vercel.com/new**.
2. **Import Git Repository** → pick the repo → **Import**.
3. Vercel reads `vercel.json` and fills these in automatically — confirm they read:
   - Framework Preset: **Vite**
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Install Command: `npm install`
4. Expand **Environment Variables** and add all six from section 1 **before**
   the first build. The build deliberately **fails** if the Supabase variables
   are missing, rather than silently shipping a browser-only demo app.
5. Click **Deploy** and wait for the build.
6. Open the `*.vercel.app` URL, sign in, and confirm the event list loads.

Every push to `main` redeploys automatically. Pull requests get preview URLs.

---

## 3. Custom domain — insurance.beingprasanna.com

**In Vercel:** project → **Settings → Domains** → enter
`insurance.beingprasanna.com` → **Add**. Vercel then shows the DNS record it
wants.

**At your DNS provider** (wherever `beingprasanna.com` is hosted), add:

| Type | Name | Value | TTL |
| --- | --- | --- | --- |
| `CNAME` | `insurance` | `cname.vercel-dns.com` | Auto / 3600 |

Notes:
- The **Name** is just `insurance`, not the full domain — most providers append
  the zone automatically. If yours wants the whole thing, use
  `insurance.beingprasanna.com`.
- If you are on Cloudflare, set the record to **DNS only** (grey cloud), not
  proxied — an orange cloud breaks Vercel's certificate issuance.
- Use the value Vercel shows you if it differs from the one above.

Then wait. Propagation is usually a few minutes, up to ~30. Vercel issues the
Let's Encrypt certificate automatically once it can see the record; the domain
shows **Valid Configuration** when it is done.

Check it yourself:

```bash
dig +short insurance.beingprasanna.com
curl -sI https://insurance.beingprasanna.com | head -1
```

Optionally set `insurance.beingprasanna.com` as the **Production Domain** in
Vercel so the `*.vercel.app` URL redirects to it.

---

## 4. Supabase after deployment

Nothing to change for the app to keep working:

- The Supabase REST and Auth APIs accept any origin, so no CORS setup is needed.
- RLS policies are origin-independent — they behave identically on Vercel and
  on localhost.
- The publishable key is meant to ship in the bundle. That is safe *only*
  because RLS constrains it.

Two things to do once the domain is live:

1. **Re-run the checks against production.** From your machine:
   ```bash
   npm run verify:supabase
   ```
   (it tests the database, which is shared by both environments).

2. **If you ever deploy the OTP edge functions**, restrict their CORS:
   ```bash
   supabase secrets set ALLOWED_ORIGINS=https://insurance.beingprasanna.com
   supabase functions deploy send-otp verify-otp
   ```

### Before real customer data goes in

The app is in MVP auth mode, so RLS grants the `anon` role access to leads and
the publishable key is in the public bundle. **Once the site is on a public
domain, anyone who opens it can read your leads through the API, whether or not
they get past the login screen.** Switch to real authentication first:

1. `VITE_AUTH_PROVIDER=supabase` in Vercel
2. Run **PART B** of `supabase/migrations/20260828020000_mvp_single_admin_access.sql`
3. Create users in Supabase → Authentication → Users

No application code changes — see README section 3.

---

## 5. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Build fails: *"Production build aborted: VITE_SUPABASE_URL … not set"* | Env vars missing in Vercel | Add them in Settings → Environment Variables, then **Redeploy** |
| App loads but shows *"Demo mode — no database connected"* | Built before the env vars existed | Add them, then Redeploy (a plain refresh will not help — values are baked in at build time) |
| Login rejects the right password | `VITE_ADMIN_PASSWORD_SHA256` differs between local and Vercel | Re-copy the hash, redeploy |
| Domain stuck on *Invalid Configuration* | CNAME missing, wrong, or Cloudflare-proxied | Check `dig +short insurance.beingprasanna.com`; set Cloudflare to DNS-only |
| Leads list empty on production but fine locally | Different Supabase project in the env vars | Compare `VITE_SUPABASE_URL` in Vercel against your `.env` |
