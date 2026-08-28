-- =============================================================================
-- Insurance Event Lead Collection — initial schema
-- Tables: agents, events, leads, otp_verifications
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- agents  (people who staff an event; linked 1:1 to a Supabase auth user)
-- -----------------------------------------------------------------------------
create table if not exists public.agents (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique references auth.users (id) on delete set null,
  name          text not null,
  email         text unique,
  phone         text,
  role          text not null default 'agent' check (role in ('agent', 'admin')),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- events  (the app supports many events; every lead belongs to exactly one)
-- -----------------------------------------------------------------------------
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  location    text,
  start_date  date,
  end_date    date,
  status      text not null default 'active' check (status in ('active', 'completed', 'archived')),
  notes       text,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists events_status_idx on public.events (status, start_date desc);

-- -----------------------------------------------------------------------------
-- leads
-- -----------------------------------------------------------------------------
create table if not exists public.leads (
  id                  uuid primary key default gen_random_uuid(),
  event_id            uuid not null references public.events (id) on delete cascade,
  serial_no           integer not null,
  name                text not null check (length(btrim(name)) > 0),
  mobile              text not null check (mobile ~ '^\+91[6-9][0-9]{9}$'),
  email               text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  occupation          text check (occupation is null or occupation in (
                        'Salaried', 'Business Owner', 'Self Employed', 'Professional',
                        'Government Employee', 'Homemaker', 'Student', 'Retired', 'Other')),
  insurance_purpose   text[] not null default '{}',
  next_meeting_date   date,
  next_meeting_time   time,
  remarks             text,
  mobile_verified     boolean not null default false,
  mobile_verified_at  timestamptz,
  lead_status         text not null default 'New' check (lead_status in (
                        'New', 'Contacted', 'Interested', 'Meeting Scheduled',
                        'Proposal', 'Converted', 'Lost')),
  assigned_to         uuid references public.agents (id) on delete set null,
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- one row per mobile number per event, so the same visitor is not entered twice
  constraint leads_event_mobile_key unique (event_id, mobile),
  constraint leads_event_serial_key unique (event_id, serial_no),
  -- every selected purpose must be one of the supported values
  constraint leads_purpose_valid check (
    insurance_purpose <@ array[
      'Pension / Annuity', 'Savings', 'Children''s Education', 'Kids Plan',
      'Family Health', 'Wealth Creation', 'Retirement Planning',
      'Life Protection', 'Tax Planning', 'Other']::text[]
  )
);

create index if not exists leads_event_idx        on public.leads (event_id, created_at desc);
create index if not exists leads_status_idx       on public.leads (event_id, lead_status);
create index if not exists leads_assigned_idx     on public.leads (event_id, assigned_to);
create index if not exists leads_meeting_idx      on public.leads (event_id, next_meeting_date);
create index if not exists leads_purpose_gin_idx  on public.leads using gin (insurance_purpose);

-- -----------------------------------------------------------------------------
-- otp_verifications  (service-role only — never readable by the browser)
-- -----------------------------------------------------------------------------
create table if not exists public.otp_verifications (
  id                  uuid primary key default gen_random_uuid(),
  mobile              text not null,
  otp_hash            text not null,            -- sha256(otp + pepper), never the raw OTP
  expires_at          timestamptz not null,
  attempts            integer not null default 0,
  max_attempts        integer not null default 5,
  verified            boolean not null default false,
  verified_at         timestamptz,
  consumed            boolean not null default false,
  request_ip          text,
  provider_request_id text,
  created_at          timestamptz not null default now()
);

create index if not exists otp_mobile_idx   on public.otp_verifications (mobile, created_at desc);
create index if not exists otp_verified_idx on public.otp_verifications (mobile, verified, verified_at desc);
create index if not exists otp_ip_idx       on public.otp_verifications (request_ip, created_at desc);

-- =============================================================================
-- Helper functions
-- =============================================================================

create or replace function public.current_agent_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.agents where auth_user_id = auth.uid() limit 1;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.agents
    where auth_user_id = auth.uid() and role = 'admin' and active
  );
$$;

-- Keep updated_at honest on every table that has it.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists agents_touch on public.agents;
create trigger agents_touch before update on public.agents
  for each row execute function public.touch_updated_at();

drop trigger if exists events_touch on public.events;
create trigger events_touch before update on public.events
  for each row execute function public.touch_updated_at();

drop trigger if exists leads_touch on public.leads;
create trigger leads_touch before update on public.leads
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Sl. No. is generated per event (1, 2, 3 ... within each event)
-- -----------------------------------------------------------------------------
create or replace function public.assign_lead_serial_no()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.serial_no is null or new.serial_no = 0 then
    -- Two agents can submit at the same instant; the advisory lock serialises
    -- numbering per event so the (event_id, serial_no) unique index never trips.
    perform pg_advisory_xact_lock(hashtext(new.event_id::text));
    select coalesce(max(serial_no), 0) + 1
      into new.serial_no
      from public.leads
     where event_id = new.event_id;
  end if;
  return new;
end;
$$;

drop trigger if exists leads_serial_no on public.leads;
create trigger leads_serial_no before insert on public.leads
  for each row execute function public.assign_lead_serial_no();

-- -----------------------------------------------------------------------------
-- SERVER-SIDE ENFORCEMENT OF MOBILE VERIFICATION
--
-- A browser can always claim mobile_verified = true, so we never trust it.
-- A lead may only be stored as verified when a matching OTP row was actually
-- verified by the verify-otp edge function inside the trust window.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_mobile_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_verified_at timestamptz;
  v_window      interval := interval '2 hours';
begin
  if new.mobile_verified is not true then
    new.mobile_verified    := false;
    new.mobile_verified_at := null;
    return new;
  end if;

  -- An update that leaves an already-verified lead verified on the same number
  -- keeps its original timestamp; nothing to re-check.
  if tg_op = 'UPDATE' and old.mobile_verified and old.mobile = new.mobile then
    new.mobile_verified_at := old.mobile_verified_at;
    return new;
  end if;

  select max(verified_at)
    into v_verified_at
    from public.otp_verifications
   where mobile = new.mobile
     and verified
     and verified_at > now() - v_window;

  if v_verified_at is null then
    raise exception
      'Mobile % cannot be marked verified: no successful OTP verification in the last %',
      new.mobile, v_window
      using errcode = 'check_violation';
  end if;

  new.mobile_verified_at := v_verified_at;
  return new;
end;
$$;

drop trigger if exists leads_verify_mobile on public.leads;
create trigger leads_verify_mobile before insert or update on public.leads
  for each row execute function public.enforce_mobile_verification();

-- =============================================================================
-- Row Level Security
-- =============================================================================

alter table public.agents            enable row level security;
alter table public.events            enable row level security;
alter table public.leads             enable row level security;
alter table public.otp_verifications enable row level security;

-- agents ----------------------------------------------------------------------
drop policy if exists agents_select on public.agents;
create policy agents_select on public.agents
  for select to authenticated using (true);

drop policy if exists agents_insert_admin on public.agents;
create policy agents_insert_admin on public.agents
  for insert to authenticated with check (public.is_admin());

drop policy if exists agents_update_self_or_admin on public.agents;
create policy agents_update_self_or_admin on public.agents
  for update to authenticated
  using (auth_user_id = auth.uid() or public.is_admin())
  with check (auth_user_id = auth.uid() or public.is_admin());

drop policy if exists agents_delete_admin on public.agents;
create policy agents_delete_admin on public.agents
  for delete to authenticated using (public.is_admin());

-- events ----------------------------------------------------------------------
drop policy if exists events_select on public.events;
create policy events_select on public.events
  for select to authenticated using (true);

drop policy if exists events_insert on public.events;
create policy events_insert on public.events
  for insert to authenticated with check (auth.uid() is not null);

drop policy if exists events_update on public.events;
create policy events_update on public.events
  for update to authenticated
  using (created_by = auth.uid() or public.is_admin())
  with check (created_by = auth.uid() or public.is_admin());

drop policy if exists events_delete_admin on public.events;
create policy events_delete_admin on public.events
  for delete to authenticated using (public.is_admin());

-- leads -----------------------------------------------------------------------
-- Everyone staffing the event works the same lead list, so reads and writes are
-- open to any signed-in agent. Deletes are limited to the capturing agent or an
-- admin, so a mis-tap cannot wipe someone else's work.
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads
  for select to authenticated using (true);

drop policy if exists leads_insert on public.leads;
create policy leads_insert on public.leads
  for insert to authenticated with check (auth.uid() is not null);

drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads
  for update to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists leads_delete on public.leads;
create policy leads_delete on public.leads
  for delete to authenticated
  using (created_by = auth.uid() or public.is_admin());

-- otp_verifications -----------------------------------------------------------
-- RLS is enabled and NO policy is created on purpose: the anon and authenticated
-- roles get zero rows. Only the service_role key (edge functions) can read or
-- write OTP material.
