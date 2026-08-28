-- =============================================================================
-- Optional seed data. Run in the Supabase SQL editor (service role, bypasses RLS)
-- after the migration. Safe to re-run.
-- =============================================================================

insert into public.agents (name, email, role)
values
  ('Ravi Sharma', 'ravi.sharma@example.com', 'admin'),
  ('Neha Gupta',  'neha.gupta@example.com',  'agent'),
  ('Amit Verma',  'amit.verma@example.com',  'agent')
on conflict (email) do nothing;

insert into public.events (name, location, start_date, end_date, status)
values (
  'Insurance Awareness Event - Bangalore - September 2026',
  'Bangalore',
  '2026-09-05',
  '2026-09-07',
  'active'
)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Link a Supabase auth user to an agent row so the app can identify them.
-- 1. Create the user in Dashboard -> Authentication -> Users -> Add user.
-- 2. Run this with that user's email:
--
--   update public.agents a
--      set auth_user_id = u.id
--     from auth.users u
--    where u.email = a.email
--      and a.auth_user_id is null;
--
-- 3. Give at least one person admin rights:
--
--   update public.agents set role = 'admin' where email = 'you@example.com';
-- -----------------------------------------------------------------------------
