-- =============================================================================
-- MVP access model: one built-in Admin login in the browser, no Supabase Auth
-- users.
--
-- With no auth session, PostgREST sees the `anon` role. RLS stays ENABLED and
-- every table keeps explicit policies — we widen them to `anon` only for the
-- tables the app actually needs, and only for the operations it performs.
--
-- What stays closed:
--   * otp_verifications — no policy at all; service_role (edge functions) only
--   * app_config        — readable, but only an admin may weaken verification
--   * events            — no anonymous DELETE (it cascades to every lead)
--   * agents            — no anonymous INSERT/UPDATE/DELETE
--
-- TO GO TO PRODUCTION: run PART B at the bottom of this file, and set
-- VITE_AUTH_PROVIDER=supabase in the frontend. No application code changes.
-- =============================================================================


-- #############################################################################
-- PART A — MVP policies (single built-in Admin login)
-- #############################################################################

-- agents ----------------------------------------------------------------------
drop policy if exists agents_select on public.agents;
create policy agents_select on public.agents
  for select to anon, authenticated using (true);

-- events ----------------------------------------------------------------------
drop policy if exists events_select on public.events;
create policy events_select on public.events
  for select to anon, authenticated using (true);

drop policy if exists events_insert on public.events;
create policy events_insert on public.events
  for insert to anon, authenticated with check (true);

drop policy if exists events_update on public.events;
create policy events_update on public.events
  for update to anon, authenticated using (true) with check (true);

-- DELETE stays admin-only: removing an event cascades to all of its leads.

-- leads -----------------------------------------------------------------------
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads
  for select to anon, authenticated using (true);

drop policy if exists leads_insert on public.leads;
create policy leads_insert on public.leads
  for insert to anon, authenticated with check (true);

drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads
  for update to anon, authenticated using (true) with check (true);

drop policy if exists leads_delete on public.leads;
create policy leads_delete on public.leads
  for delete to anon, authenticated using (true);

-- app_config ------------------------------------------------------------------
drop policy if exists app_config_select on public.app_config;
create policy app_config_select on public.app_config
  for select to anon, authenticated using (true);

-- app_config_update_admin is left untouched: anon cannot switch OTP enforcement
-- back off/on, and otp_verifications remains unreachable from the browser.


-- #############################################################################
-- PART B — PRODUCTION lock-down (run this when you move to Supabase Auth)
--
-- Uncomment and run the whole block. Combined with VITE_AUTH_PROVIDER=supabase
-- it restores per-user authentication with no application code changes.
-- #############################################################################

-- drop policy if exists agents_select on public.agents;
-- create policy agents_select on public.agents
--   for select to authenticated using (true);
--
-- drop policy if exists events_select on public.events;
-- create policy events_select on public.events
--   for select to authenticated using (true);
--
-- drop policy if exists events_insert on public.events;
-- create policy events_insert on public.events
--   for insert to authenticated with check (auth.uid() is not null);
--
-- drop policy if exists events_update on public.events;
-- create policy events_update on public.events
--   for update to authenticated
--   using (created_by = auth.uid() or public.is_admin())
--   with check (created_by = auth.uid() or public.is_admin());
--
-- drop policy if exists leads_select on public.leads;
-- create policy leads_select on public.leads
--   for select to authenticated using (true);
--
-- drop policy if exists leads_insert on public.leads;
-- create policy leads_insert on public.leads
--   for insert to authenticated with check (auth.uid() is not null);
--
-- drop policy if exists leads_update on public.leads;
-- create policy leads_update on public.leads
--   for update to authenticated using (auth.uid() is not null)
--   with check (auth.uid() is not null);
--
-- drop policy if exists leads_delete on public.leads;
-- create policy leads_delete on public.leads
--   for delete to authenticated
--   using (created_by = auth.uid() or public.is_admin());
--
-- drop policy if exists app_config_select on public.app_config;
-- create policy app_config_select on public.app_config
--   for select to authenticated using (true);
