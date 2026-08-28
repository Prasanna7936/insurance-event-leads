# Event Data Collection — Insurance Agent

A tablet-first web app for capturing insurance leads at events: fast data entry,
real MSG91 SMS OTP verification, a live dashboard, and one-click Excel export.

- **Frontend** — React 18 + TypeScript + Vite
- **Database** — Supabase Postgres with Row Level Security
- **OTP** — Supabase Edge Functions (Deno) calling MSG91; credentials never reach the browser
- **Excel** — SheetJS (`xlsx`), `.xlsx` download in the browser

---

## 1. What the app does

| Screen | What it gives you |
| --- | --- |
| **Capture Lead** | The whole form on one screen: name, mobile + OTP, email, occupation, insurance purpose chips, meeting date/time, remarks, status, owner. Submits and immediately resets for the next visitor. |
| **Leads** | The reference sheet as a live table — search, six filters, five sort orders, inline edit and delete. |
| **Dashboard** | Total / verified / unverified, a tile per lead status, leads by insurance purpose, and upcoming meetings. |
| Everywhere | Event selector in the header; every lead belongs to the selected event. Multiple tablets on the same event stay in sync over Supabase Realtime. |

### Event-day flow

```
Select Event → Enter details → Enter mobile → Send OTP → Customer enters OTP
→ Mobile Verified ✓ → Select purposes → Schedule meeting → Submit → appears in Leads
```

---

## 2. Connecting to a Supabase project

`.env` is already pointed at the project (URL + publishable key). **One step
remains:**

Open the Supabase dashboard → **SQL Editor** → **New query**, paste all of
[`supabase/setup.sql`](supabase/setup.sql), and Run. It creates `agents`,
`events`, `leads`, `otp_verifications` and `app_config` with every index,
trigger and RLS policy, switches SMS verification off, and inserts the sample
event and three agents. Running it twice is harmless.

*CLI alternative:* `supabase link --project-ref <ref> && supabase db push`
(prompts for your database password locally).

No Supabase Auth user is needed — see section 3.

**Then check it:**

```bash
npm run verify:supabase   # tables, RLS behaviour, events -> leads foreign key
npm run dev               # http://localhost:5173
```

Sign in with the credentials in your local `.env` (see section 3).

---

## 3. Authentication

### MVP: one built-in Admin login

`VITE_AUTH_PROVIDER=mvp` (the default) gates the app with a single account. The
user ID is `VITE_ADMIN_USER` and the password is whatever hashes to
`VITE_ADMIN_PASSWORD_SHA256` — both live in `.env`, which is never committed.
The credentials are deliberately not written down in this repository.

No registration, no password reset, no Supabase Auth user. The session is kept
in `localStorage` and expires after 12 hours or when you press **Log out**.

The password is never in the source, the bundle, or the database — only its
SHA-256 hash, in `VITE_ADMIN_PASSWORD_SHA256`. To change it:

```bash
node -e "console.log(require('crypto').createHash('sha256').update('YourNewPassword').digest('hex'))"
```

and put the result in `.env`.

### What this does and does not protect

**Read this before using it with real customer data.** A credential check that
runs in the browser can be bypassed by editing the JavaScript, and because there
is no auth session, RLS has to grant the `anon` role access to the lead tables.
The publishable key ships inside your JS bundle, so **anyone who has the app URL
can query your leads directly**, Admin login or not. It gates the interface, not
the data.

RLS is still on, and the policies are still explicit and minimal — these remain
closed to the browser even in MVP mode:

| Locked down | Why |
| --- | --- |
| `otp_verifications` | no policy at all — service role (edge functions) only |
| `app_config` UPDATE | only an admin may switch OTP enforcement |
| `events` DELETE | deleting an event cascades to all of its leads |
| `agents` INSERT/UPDATE/DELETE | roster changes are not a browser operation |

Fine for a demo, a pilot, or an internal event where the URL is not public. Not
fine for production with real customer PII — use the switch below before that.

### Switching to real Supabase Authentication

Two changes, no application code:

1. `VITE_AUTH_PROVIDER=supabase` in `.env`
2. Run **PART B** at the bottom of
   `supabase/migrations/20260828020000_mvp_single_admin_access.sql` — it puts
   every policy back to `to authenticated`

Then create users in Dashboard → **Authentication → Users → Add user** (tick
*Auto Confirm User*) and link each to an agent row:

```sql
insert into public.agents (name, email, role)
values ('Your Name', 'you@example.com', 'admin')
on conflict (email) do update set role = 'admin';

update public.agents a
   set auth_user_id = u.id
  from auth.users u
 where u.email = a.email
   and a.auth_user_id is distinct from u.id;
```

The login screen relabels itself from *User ID* to *Email* automatically —
both providers implement the same `AuthProvider` interface in
[`src/lib/auth.ts`](src/lib/auth.ts), which is the only file that knows how
signing in works.

---

## 4. Running without SMS

The OTP step is optional. There are two ways to run with SMS switched off.

### Demo mode — zero setup

With **no** `.env` at all, the app boots into demo mode: a sample event, the five
leads from the reference sheet, and lead capture that writes to this browser's
`localStorage`. Every screen, filter and both Excel exports work. A yellow banner
says so, and a **Reset demo data** link restores the samples.

```bash
npm install && npm run dev
```

Demo mode is for looking around and for training staff. It is not a database —
data lives in one browser and is lost when site data is cleared.

### SMS off — the default

OTP is off unless `VITE_SMS_OTP_ENABLED` is exactly the string `true`. Leaving
it unset, empty, or set to anything else keeps the Mobile Verification section
out of the form entirely, and the OTP code is tree-shaken out of the bundle.

The database default matches:

```sql
update public.app_config set otp_enforcement = false;   -- set by supabase/setup.sql
```

With SMS off, the form shows no verification control and leads save with
**Mobile Verified = No**. The column, its dashboard tiles, the filter and the
Excel column all keep working.

None of the OTP implementation is deleted — `OtpPanel`, the `api.ts` callers and
the `send-otp` / `verify-otp` edge functions all stay in the source.

### Turning OTP back on

Both of these, or it will not work:

```bash
VITE_SMS_OTP_ENABLED=true          # frontend: render the panel
```

```sql
update public.app_config set otp_enforcement = true;   -- database: require a real OTP
```

You also need the edge functions deployed and MSG91 configured (section 7). The
database flag is the one that actually matters: with `otp_enforcement = true`,
`mobile_verified` cannot be stored unless a real OTP was verified in the previous
two hours, no matter what the browser sends.

---

## 5. Prerequisites

- Node.js 18+ and npm
- A [Supabase](https://supabase.com) project (free tier is enough)
- The [Supabase CLI](https://supabase.com/docs/guides/cli) — `npm i -g supabase`
- An MSG91 account with an approved DLT template (for real SMS)

---

## 6. Database setup

### Option A — Supabase CLI (recommended)

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

### Option B — SQL editor

Paste `supabase/migrations/20260828000000_init.sql` into the Supabase SQL editor
and run it.

Then (optionally) run `supabase/seed.sql` to create the sample event and the
three agents from the reference sheet.

### Tables created

| Table | Purpose |
| --- | --- |
| `events` | One row per event. `name`, `location`, `start_date`, `end_date`, `status`. |
| `agents` | Staff who work an event. Linked to `auth.users` via `auth_user_id`; `role` is `agent` or `admin`. |
| `leads` | The lead record — every field from the reference sheet plus `event_id`, `serial_no`, `mobile_verified_at`, `created_by`, `created_at`, `updated_at`. |
| `otp_verifications` | Hashed OTPs, expiry, attempt counts. **Service role only** — RLS is on with zero policies, so the browser can never read it. |

### Security highlights

- **RLS on every table.** Signed-in agents read all events/agents/leads and can
  insert and update leads; deletes are limited to the capturing agent or an admin.
- **`mobile_verified` cannot be faked.** A `BEFORE INSERT OR UPDATE` trigger on
  `leads` rejects `mobile_verified = true` unless a matching row in
  `otp_verifications` was actually verified in the last 2 hours — and it copies
  the real `verified_at` timestamp onto the lead.
- **OTPs are stored hashed** (`sha256(otp:mobile:pepper)`), never in plain text.
- **`Sl. No.` is generated in the database** per event, under an advisory lock so
  two tablets submitting at the same moment cannot collide.
- One lead per mobile number per event (`unique (event_id, mobile)`).

---

## 7. Deploy the OTP functions

> Skip this whole section if you are running with SMS off.

```bash
supabase functions deploy send-otp
supabase functions deploy verify-otp
```

Set the secrets — **this is the only place MSG91 credentials ever live**:

```bash
supabase secrets set \
  MSG91_AUTH_KEY=your_msg91_auth_key \
  MSG91_TEMPLATE_ID=your_dlt_template_id \
  MSG91_SENDER_ID=MSGIND \
  MSG91_ROUTE=otp \
  OTP_PEPPER="$(openssl rand -hex 32)" \
  ALLOWED_ORIGINS=https://leads.yourdomain.com
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform — do
not set them yourself.

### MSG91 notes

- `MSG91_ROUTE=otp` (default) posts to `https://control.msg91.com/api/v5/otp`.
- `MSG91_ROUTE=flow` posts to `https://control.msg91.com/api/v5/flow/` and
  substitutes the OTP into the template variable named by `MSG91_OTP_VAR_NAME`
  (default `OTP`).
- Either way the app generates the OTP itself, so expiry, attempt limits and rate
  limiting are enforced in your database rather than by the provider.

### Tunable OTP policy (all optional)

| Secret | Default | Meaning |
| --- | --- | --- |
| `OTP_LENGTH` | `6` | Digits in the OTP |
| `OTP_TTL_SECONDS` | `300` | Expiry window |
| `OTP_MAX_ATTEMPTS` | `5` | Wrong entries before the OTP is burned |
| `OTP_RESEND_COOLDOWN_SECONDS` | `45` | Minimum gap between sends |
| `OTP_MAX_SENDS_PER_MOBILE_PER_HOUR` | `5` | Per-number rate limit |
| `OTP_MAX_SENDS_PER_IP_PER_HOUR` | `40` | Per-device rate limit |
| `OTP_PEPPER` | `""` | Secret mixed into the OTP hash |
| `ALLOWED_ORIGINS` | `*` | Comma-separated CORS allow-list |

> **Testing before MSG91 is ready:** `OTP_DEV_MODE=true` (with MSG91 unset)
> returns the OTP in the API response and shows it in a yellow banner instead of
> sending an SMS. Never enable it in production — with MSG91 configured it is
> ignored entirely.

---

## 8. Run the frontend

```bash
cp .env.example .env
# fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (Settings → API)
npm install
npm run dev
```

Open http://localhost:5173 and sign in with the user you created.

---

## 9. Excel export

| Button | File | Contents |
| --- | --- | --- |
| **⬇ Download All Leads — Excel** | `Insurance_Event_Leads_YYYY-MM-DD.xlsx` | Every lead in the database, across all events. Fetched fresh from Postgres, not from what is on screen. |
| **Export Filtered Leads** | `Insurance_Event_Leads_Filtered_YYYY-MM-DD.xlsx` | Exactly the rows currently shown, in the current sort order. |

Both files carry the table's twelve columns in the same order: Sl. No., Name,
Mobile No., Email ID, Occupation, Insurance Purpose, Next Meeting Date, Next
Meeting Time, Remarks, Mobile Verified, Lead Status, Assigned To. The all-events
file appends **Event**, **Verified At** and **Captured At**, since a combined
export is ambiguous without them. Header row is frozen with autofilter on.

---

## 10. Deployment

### Frontend (Vercel / Netlify / Cloudflare Pages)

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Output directory | `dist` |
| Env vars | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |

```bash
npm i -g vercel && vercel --prod          # or: netlify deploy --prod --dir=dist
```

After the domain is live, lock the functions down to it:

```bash
supabase secrets set ALLOWED_ORIGINS=https://leads.yourdomain.com
supabase functions deploy send-otp verify-otp
```

### Checklist before the first event

- [ ] Migration applied, seed run
- [ ] An agent account exists for every person on the desk
- [ ] MSG91 secrets set; `OTP_DEV_MODE` unset — or SMS deliberately switched off
      in **both** places (`VITE_SMS_OTP_ENABLED` unset/not "true", and
      `otp_enforcement = false`)
- [ ] A real OTP received on a real handset (if SMS is on)
- [ ] `ALLOWED_ORIGINS` set to the production domain
- [ ] The event for the day created and selected
- [ ] Both Excel exports downloaded once as a smoke test

---

## 11. Project layout

```
insurance-event-leads/
├── src/
│   ├── App.tsx                  # shell: auth, event selection, tabs, exports
│   ├── components/
│   │   ├── LeadForm.tsx         # capture/edit form
│   │   ├── OtpPanel.tsx         # send/verify, countdowns, attempts left
│   │   ├── LeadTable.tsx        # table, filters, sort, edit/delete
│   │   ├── Dashboard.tsx        # stats, purpose breakdown, upcoming meetings
│   │   ├── EventBar.tsx         # event selector + create event
│   │   ├── MultiSelect.tsx      # insurance purpose chips
│   │   ├── Login.tsx            # MVP Admin sign-in
│   │   └── ui.tsx               # toasts, modal, field, spinner, empty state
│   └── lib/
│       ├── api.ts               # Supabase queries + edge function calls
│       ├── excel.ts             # xlsx workbook builders
│       ├── filters.ts           # search / filter / sort
│       ├── mobile.ts            # Indian mobile validation + normalisation
│       ├── format.ts            # 05-Sep-2026, 04:00 PM
│       ├── auth.ts              # AuthProvider: MVP admin | Supabase auth
│       ├── config.ts            # SMS on/off + demo-mode flags
│       ├── localStore.ts        # demo-mode store (browser only)
│       ├── constants.ts         # dropdown option lists
│       ├── types.ts
│       └── supabase.ts
└── supabase/
    ├── migrations/20260828000000_init.sql
    ├── seed.sql
    └── functions/
        ├── _shared/{cors,otp}.ts
        ├── send-otp/index.ts
        └── verify-otp/index.ts
```

---

## 12. Notes on three design decisions

**Unverified leads can still be saved.** The primary **Submit Lead** button is
disabled until the OTP is verified, as specified. But the reference sheet itself
contains a row with *Mobile Verified = No*, and the dashboard asks for a "Mobile
Not Verified" count — so a secondary **Save without verification** button stores
the lead with `mobile_verified = false`. Use it when the visitor does not have
their phone with them; the record is clearly marked and filterable.

**Editing a verified lead.** Changing the mobile number on an existing lead
clears its verification and requires a fresh OTP. Leaving the number untouched
preserves the original `mobile_verified_at`.

**The SMS switch is enforced in the database, not the browser.** Hiding the OTP
panel by leaving `VITE_SMS_OTP_ENABLED` off is only cosmetic — anyone can edit
frontend config. What actually decides whether a hand-ticked `mobile_verified`
is accepted is `public.app_config.otp_enforcement`, checked by a trigger, and
only an admin can change it. That is why turning SMS off takes two steps.
