-- =============================================================================
-- Records HOW a mobile number was verified.
--
--   'otp'              — a real OTP was sent and confirmed by the server
--   'whatsapp_manual'  — the agent messaged the customer on WhatsApp and
--                        attested to it by hand. There is no delivery receipt:
--                        WhatsApp click-to-chat gives the app no feedback, so
--                        this records an agent's claim, not a proven delivery.
--
-- Additive and idempotent: existing rows keep working, nothing is dropped.
-- =============================================================================

alter table public.leads
  add column if not exists verification_method text
    check (verification_method is null
           or verification_method in ('otp', 'whatsapp_manual'));

comment on column public.leads.verification_method is
  'How mobile_verified was established. whatsapp_manual is agent-attested, not a delivery receipt.';

-- -----------------------------------------------------------------------------
-- The trigger now understands the method.
--
-- 'whatsapp_manual' is accepted even when otp_enforcement is on: it is a
-- deliberate, recorded human attestation rather than a bypass, and it stays
-- distinguishable from a real OTP in every report.
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
    new.mobile_verified     := false;
    new.mobile_verified_at  := null;
    new.verification_method := null;
    return new;
  end if;

  -- An update that leaves an already-verified lead verified on the same number
  -- keeps its original timestamp and method; nothing to re-check.
  if tg_op = 'UPDATE' and old.mobile_verified and old.mobile = new.mobile then
    new.mobile_verified_at  := old.mobile_verified_at;
    new.verification_method := coalesce(new.verification_method, old.verification_method);
    return new;
  end if;

  -- Agent-attested WhatsApp verification.
  if new.verification_method = 'whatsapp_manual' then
    new.mobile_verified_at := coalesce(new.mobile_verified_at, now());
    return new;
  end if;

  select otp_enforcement into v_enforce from public.app_config where id;

  -- SMS verification switched off: trust the agent's manual tick.
  if v_enforce is not true then
    new.mobile_verified_at  := coalesce(new.mobile_verified_at, now());
    new.verification_method := coalesce(new.verification_method, 'whatsapp_manual');
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

  new.mobile_verified_at  := v_verified_at;
  new.verification_method := 'otp';
  return new;
end;
$$;
