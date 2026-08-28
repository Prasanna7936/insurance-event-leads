-- =============================================================================
-- Makes OTP enforcement switchable.
--
-- By default the leads trigger still demands a real, recent OTP verification
-- before it will store mobile_verified = true. Turning otp_enforcement off lets
-- an agent tick "Mobile Verified" by hand — use it only when SMS is disabled.
-- =============================================================================

create table if not exists public.app_config (
  id               boolean primary key default true check (id),  -- exactly one row
  otp_enforcement  boolean not null default true,
  updated_at       timestamptz not null default now()
);

insert into public.app_config (id, otp_enforcement)
values (true, true)
on conflict (id) do nothing;

drop trigger if exists app_config_touch on public.app_config;
create trigger app_config_touch before update on public.app_config
  for each row execute function public.touch_updated_at();

alter table public.app_config enable row level security;

drop policy if exists app_config_select on public.app_config;
create policy app_config_select on public.app_config
  for select to authenticated using (true);

-- Only an admin may weaken verification.
drop policy if exists app_config_update_admin on public.app_config;
create policy app_config_update_admin on public.app_config
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- Trigger now consults the switch before demanding an OTP record.
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
  v_enforce     boolean;
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

  select otp_enforcement into v_enforce from public.app_config where id;

  -- SMS verification switched off: trust the agent's manual tick, but still
  -- stamp the time so the record shows when it was marked.
  if v_enforce is not true then
    new.mobile_verified_at := coalesce(new.mobile_verified_at, now());
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

-- -----------------------------------------------------------------------------
-- To disable SMS verification:
--   update public.app_config set otp_enforcement = false;
-- and set VITE_SMS_OTP_ENABLED=false in the frontend environment.
--
-- To turn it back on:
--   update public.app_config set otp_enforcement = true;
-- -----------------------------------------------------------------------------
