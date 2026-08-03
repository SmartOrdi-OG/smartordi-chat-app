-- ══════════════════════════════════════════════════════════════
-- Phase 50: automatic data deletion for a trial that expired without ever
-- converting to a paid plan
--
-- phase21_trial_enforcement.sql already LOCKS a practice out of its own
-- clinical data (patients/termine/messages/documents/MKP/Impfungen) once
-- trial_start + 30 days has passed with no payment_method on file -- but
-- locking access isn't the same as actually deleting the data.
-- phase43_practice_churn_retention.sql already has the anonymization
-- machinery (anonymize_practice()/run_scheduled_practice_deletions()),
-- but its trigger is a deliberately MANUAL step: SmartOrdi staff flip
-- retention_status to 'deletion_scheduled' by hand, only after a doctor
-- has explicitly confirmed (by phone/e-mail) they're not continuing.
--
-- This covers the much more common OTHER case: a doctor who signs up,
-- never adds a payment method, and simply stops coming back once the
-- trial locks them out -- nobody ever explicitly "cancels" anything, so
-- phase43's manual path never fires and that practice's data would
-- otherwise sit there indefinitely with no ongoing relationship
-- justifying it. Per Art. 5(1)(e) DSGVO (storage limitation), personal
-- data must not be kept longer than necessary for the purpose it was
-- collected for -- an abandoned, never-paid trial has no purpose left.
--
-- Grace period: 30 days (trial) + 14 days AFTER the lock already kicked
-- in = 44 days from signup before data is actually destroyed, giving a
-- doctor who was briefly away (travel, forgot to pay) a real chance to
-- come back and pay before anything is lost. The sweep re-checks
-- payment_method at the moment it actually runs, so paying at ANY point
-- before the scheduled date automatically cancels the deletion -- no
-- manual undo needed. Reuses phase43's exact anonymize_practice()/
-- run_scheduled_practice_deletions() machinery; this only adds the
-- AUTOMATIC trigger phase43 deliberately didn't have. A practice already
-- in phase43's manual (explicitly-confirmed-churn) pipeline is
-- unaffected: this only ever touches retention_status = 'active' rows.
--
-- Run this in the Supabase SQL editor, after
-- phase21_trial_enforcement.sql and phase43_practice_churn_retention.sql.
-- ══════════════════════════════════════════════════════════════

create extension if not exists pg_cron;

-- ── Flags every practice whose trial expired 14+ days ago with still no
-- payment_method on file. Deliberately leaves churn_confirmed_at NULL
-- here (unlike phase43's manual path) -- that column means "a human
-- confirmed this," and nobody has for these; retention_status alone
-- drives the actual deletion sweep, so this distinction is audit-trail
-- only, not functional. ──
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
    and trial_start is not null
    and payment_method is null
    and now() > trial_start + interval '30 days' + interval '14 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;
revoke all on function public.flag_expired_unpaid_trials() from public, anon, authenticated;

-- Runs daily. run_scheduled_practice_deletions() (phase43) runs 15
-- minutes later and immediately picks up anything just flagged above
-- (scheduled_data_deletion_date = today, already <= current_date) --
-- same day, not a further delay on top of the 44-day window already
-- given.
select cron.schedule('flag-expired-unpaid-trials', '0 3 * * *', 'select public.flag_expired_unpaid_trials();');
select cron.schedule('run-scheduled-practice-deletions', '15 3 * * *', 'select public.run_scheduled_practice_deletions();');
