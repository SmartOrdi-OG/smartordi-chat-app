-- ══════════════════════════════════════════════════════════════
-- Phase 87: Pilot practices get a 90-day Pilotphase (not the normal
-- 30-day trial), plus a notice 14 days before the lock
--
-- Owner decision (2026-10-23): a practice set up as a pilot
-- (phase53_pilot_account_setup.sql) must NOT be locked after 30 days and
-- auto-anonymized after 44 days like a normal self-registered trial
-- (phase21 + phase50). It is locked only at its own explicit end date
-- (pilot_until = setup + 90 days), and staff see a notice in doctor.html
-- and secretary.html from 14 days before that date so the practice has
-- room to decide (choose a paid plan, or let the pilot end).
-- Normal (non-pilot) trials keep exactly their current behaviour.
--
-- Verified on the live DB (2026-10-23) before writing this:
-- * the one practice that clearly was a pilot (plan 'enterprise' as
--   phase53 sets it, plus a staff_pilot_login_links row from phase60) had
--   already been locked at day 30 and auto-anonymized on 2026-09-22 by
--   phase50 -- exactly the failure this migration exists to prevent.
-- * a practice with a cancelled PAID Stripe subscription was auto-
--   anonymized by phase50 on 2026-10-22 (see point 3 below).
--
-- What this adds (all non-destructive -- new columns/functions/trigger,
-- plus replaced bodies of 2 existing functions; no row is updated):
--
-- 1) practices.is_pilot / pilot_until -- explicit marker instead of
--    special-casing names/plans. pilot_until is the exact moment the
--    lock kicks in for a pilot (phase53 sets it to now() + 90 days).
--    practices.pilot_end_notice_seen_at -- recorded ONCE, the first time
--    a staff member of that practice actually saw the "Pilotphase endet"
--    banner (via practice_ack_pilot_end_notice() below). Evidence that
--    the practice was told before anything was locked/deleted.
--
-- 2) practice_trial_ends_at(...) -- single source of truth for "when does
--    this practice's free period end": pilot_until for pilots, otherwise
--    trial_start + 30 days (unchanged for every normal trial).
--    practice_trial_active() (phase21, gates the 6 clinical tables' RLS)
--    and flag_expired_unpaid_trials() (phase50) now both use it, so the
--    lock AND the deletion move together. Post-lock grace stays 14 days,
--    i.e. a pilot is flagged for deletion no earlier than pilot_until +
--    14 days. payment_method on file still lifts the lock exactly as
--    before.
--
-- 3) flag_expired_unpaid_trials() additionally skips any practice that
--    ever had a Stripe subscription (stripe_subscription_id is not null).
--    phase50's own header scopes it to "a trial that expired without ever
--    converting to a paid plan", but its WHERE clause only checked
--    payment_method -- and stripe-webhook clears payment_method when a
--    subscription is cancelled, so a churned paying customer was
--    anonymized the next night with zero grace, contrary to agb.html
--    § 6's 60-day export window. Churned paying customers go through
--    phase43's manual 60-day path instead. This only ever makes the
--    automatic deletion flag fire for FEWER practices, never more.
--
-- 4) A guard trigger on practices: a staff session (role authenticated/
--    anon, i.e. straight from the browser via PostgREST) can no longer
--    change billing/lifecycle columns (is_pilot, pilot_until, trial_start,
--    payment_method, plan, stripe_*, subscription_status, retention_*).
--    phase15's "update own practice" policy lets staff update their own
--    row (needed for Adresse/Tel/chat_enabled/working_hours/...), which
--    would let a doctor with devtools set pilot_until = 2099 or a fake
--    payment_method and skip the lock forever. The app itself never
--    writes those columns from the browser (savePracticeSettings() only
--    sends adresse/tel/chat_enabled/working_hours/online_booking_enabled/
--    lab_email_token; only stripe-webhook with the service-role key,
--    SECURITY DEFINER functions and the SQL editor touch billing columns)
--    -- so this changes nothing for real use.
--
-- No automatic e-mail for the day-76 notice: the app has no Resend path
-- to practice staff (notify-* go to OWNER_ALERT_EMAIL only, send-report-
-- email to patients/external doctors, send-pilot-login-link is a manual
-- one-off) and phase53 deliberately uses made-up staff login addresses
-- for pilots, so staff_profiles.email is not a real inbox. SmartOrdi
-- contacts the pilot practice personally; find who is due with
--   select id, name, pilot_until from public.practices
--   where is_pilot and payment_method is null
--     and now() >= pilot_until - interval '14 days';
--
-- No existing practice is marked as pilot here (on 2026-10-23 the only
-- pilot practice ever created was already anonymized). For a future
-- pilot created by hand instead of phase53, run in the SQL editor:
--   update public.practices
--   set is_pilot = true, pilot_until = trial_start + interval '90 days'
--   where id = '<practice-id>';
--
-- Run after phase21, phase43, phase50, phase53.
--
-- Applied live 2026-10-23 as three migrations (phase87_pilot_90_day_lock_
-- a_columns / _b_functions / _c_guard_trigger) -- one apply of the whole
-- file kept timing out in the Supabase MCP tool. Same SQL, same order.
-- ══════════════════════════════════════════════════════════════

alter table public.practices add column if not exists is_pilot boolean not null default false;
alter table public.practices add column if not exists pilot_until timestamptz;
alter table public.practices add column if not exists pilot_end_notice_seen_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'practices_pilot_until_required') then
    alter table public.practices
      add constraint practices_pilot_until_required check (not is_pilot or pilot_until is not null);
  end if;
end $$;

-- ── 2) Single source of truth for the end of the free period ──
create or replace function public.practice_trial_ends_at(p_trial_start timestamptz, p_is_pilot boolean, p_pilot_until timestamptz)
returns timestamptz
language sql
stable
set search_path to 'public'
as $function$
  select case
    when coalesce(p_is_pilot, false) and p_pilot_until is not null then p_pilot_until
    when p_trial_start is null then null
    else p_trial_start + interval '30 days'
  end;
$function$;

create or replace function public.practice_trial_active(p_practice_id uuid)
returns boolean
language sql
security definer
stable
set search_path to 'public'
as $function$
  select coalesce(
    (select p.payment_method is not null
            or public.practice_trial_ends_at(p.trial_start, p.is_pilot, p.pilot_until) is null
            or now() < public.practice_trial_ends_at(p.trial_start, p.is_pilot, p.pilot_until)
     from public.practices p
     where p.id = p_practice_id),
    false
  );
$function$;

-- ── 3) Deletion flag: same 14-day grace after the lock, measured from the
-- (pilot-aware) end date; never for a practice that once paid. ──
create or replace function public.flag_expired_unpaid_trials()
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count int := 0;
begin
  update public.practices
  set retention_status = 'deletion_scheduled',
      scheduled_data_deletion_date = current_date
  where retention_status = 'active'
    and payment_method is null
    and stripe_subscription_id is null
    and public.practice_trial_ends_at(trial_start, is_pilot, pilot_until) is not null
    and now() > public.practice_trial_ends_at(trial_start, is_pilot, pilot_until) + interval '14 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;
revoke all on function public.flag_expired_unpaid_trials() from public, anon, authenticated;

-- ── 1b) Record (once) that the practice saw the 14-day notice ──
-- Called by doctor.html/secretary.html the first time the "Pilotphase endet" banner is
-- shown. Idempotent: only the first call inside the 14-day window writes;
-- later calls just return the already-stored timestamp.
create or replace function public.practice_ack_pilot_end_notice()
returns timestamptz
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_practice_id uuid := public.current_practice_id();
  v_seen timestamptz;
begin
  if v_practice_id is null then
    return null;
  end if;
  update public.practices
  set pilot_end_notice_seen_at = now()
  where id = v_practice_id
    and is_pilot
    and pilot_until is not null
    and pilot_end_notice_seen_at is null
    and now() >= pilot_until - interval '14 days';
  select pilot_end_notice_seen_at into v_seen from public.practices where id = v_practice_id;
  return v_seen;
end;
$function$;
revoke all on function public.practice_ack_pilot_end_notice() from public, anon;
grant execute on function public.practice_ack_pilot_end_notice() to authenticated;

-- ── 4) Guard billing/lifecycle columns against direct browser writes ──
-- SECURITY INVOKER on purpose: current_user is the caller's role
-- ('authenticated'/'anon' via PostgREST), but the function owner inside
-- SECURITY DEFINER functions (anonymize_practice, flag_expired_unpaid_
-- trials, practice_ack_pilot_end_notice) and 'service_role' for the
-- stripe-webhook Edge Function -- those stay allowed.
create or replace function public.guard_practice_billing_columns()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    -- register.html's deferred practice creation (vendor/staff-accounts.js
    -- completePendingPracticeRegistration) only ever sends name/adresse/
    -- tel/plan/trial_start: a self-registered practice is never a pilot
    -- and never starts with a payment method.
    new.is_pilot := false;
    new.pilot_until := null;
    new.pilot_end_notice_seen_at := null;
    new.payment_method := null;
    new.stripe_customer_id := null;
    new.stripe_subscription_id := null;
    new.subscription_status := null;
    new.trial_start := now();
    return new;
  end if;
  if new.is_pilot is distinct from old.is_pilot
     or new.pilot_until is distinct from old.pilot_until
     or new.pilot_end_notice_seen_at is distinct from old.pilot_end_notice_seen_at
     or new.trial_start is distinct from old.trial_start
     or new.payment_method is distinct from old.payment_method
     or new.plan is distinct from old.plan
     or new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
     or new.subscription_status is distinct from old.subscription_status
     or new.retention_status is distinct from old.retention_status
     or new.churn_confirmed_at is distinct from old.churn_confirmed_at
     or new.scheduled_data_deletion_date is distinct from old.scheduled_data_deletion_date
  then
    raise exception 'Billing/trial fields of a practice cannot be changed from the app.'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

create or replace trigger trg_guard_practice_billing_columns
  before insert or update on public.practices
  for each row execute function public.guard_practice_billing_columns();
