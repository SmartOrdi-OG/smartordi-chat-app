-- ══════════════════════════════════════════════════════════════
-- Phase 43: practice-level churn/retention (grace period + anonymization)
--
-- Companion to phase17_data_retention.sql's per-patient right-to-erasure
-- reconciliation, but at the WHOLE-PRACTICE level: what happens when a
-- doctor explicitly confirms (by phone/e-mail) they will not continue
-- with SmartOrdi after their trial/subscription. This is deliberately an
-- INTERNAL OPS action, not a self-service feature in the app -- there is
-- no "cancel my account" button anywhere; SmartOrdi staff run the
-- confirmation update below by hand once a doctor has actually confirmed,
-- same as any B2B SaaS off-boarding step.
--
-- Per Art. 28(3)(g) DSGVO, a processor must delete or return all personal
-- data to the controller after the end of the provision of services (at
-- the controller's choice), unless EU/member-state law requires further
-- storage. This gives the practice a defined window (60 days) to export
-- their data via doctor.html's new admin-only "Alle Patientendaten
-- exportieren (ZIP)" button (exportPracticeDataZip()) before SmartOrdi
-- anonymizes its own copy. The practice's OWN statutory retention
-- obligation as a medical provider (§ 51 ÄrzteG, 10 years) is unaffected
-- and remains their responsibility as data controller -- this only
-- deletes SmartOrdi's copy, as processor, same distinction phase17
-- already draws for individual patients.
--
-- See agb.html § 6 / datenschutz.html § 7 for the corresponding contract
-- language (updated alongside this migration).
--
-- Run this in the Supabase SQL editor, after phase17_data_retention.sql
-- and phase41_scheduled_deletion_grant_fix.sql.
-- ══════════════════════════════════════════════════════════════

alter table public.practices add column if not exists retention_status text not null default 'active' check (retention_status in ('active','deletion_scheduled','anonymized'));
alter table public.practices add column if not exists churn_confirmed_at timestamptz;
alter table public.practices add column if not exists scheduled_data_deletion_date date;

-- ── Scrubs one practice: anonymizes every one of its patients (reusing the
-- already-reviewed per-patient scrub from phase17), then the practice's
-- own staff identities and its own name/address. Rows are kept (not
-- DELETEd) -- practice_id/actor_id foreign keys (audit_log, termine.
-- arzt_id, etc.) have no ON DELETE CASCADE, and a hard delete would either
-- fail outright or silently break that history. Idempotent: safe to call
-- more than once. ──
create or replace function public.anonymize_practice(p_practice_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
begin
  for r in select id from public.patients where practice_id = p_practice_id and retention_status <> 'anonymized' loop
    perform public.anonymize_patient(r.id);
  end loop;

  update public.staff_profiles set
    vorname = 'Gelöscht', nachname = '(Praxis geschlossen)',
    email = 'geloescht_' || id::text || '@anonymized.smartordi.internal',
    stempel_data_url = null, sig_data_url = null
  where practice_id = p_practice_id;

  update public.practices set
    name = 'Gelöschte Praxis', adresse = null, tel = null,
    retention_status = 'anonymized'
  where id = p_practice_id;
end;
$function$;
revoke all on function public.anonymize_practice(uuid) from public, anon, authenticated;

-- ── Sweeps every practice whose grace period has now elapsed. Cron-only,
-- same "revoke all from public/anon/authenticated" pattern send_termine_
-- reminders()/run_scheduled_patient_deletions() (phase41) already use --
-- running it manually means via the Supabase SQL editor/psql as the
-- database owner, which bypasses these grants entirely; nothing in the
-- app ever calls this. ──
create or replace function public.run_scheduled_practice_deletions()
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  v_count int := 0;
begin
  for r in
    select id from public.practices
    where retention_status = 'deletion_scheduled' and scheduled_data_deletion_date <= current_date
  loop
    perform public.anonymize_practice(r.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;
revoke all on function public.run_scheduled_practice_deletions() from public, anon, authenticated;

-- ── Manual step -- run by hand (Supabase SQL editor) once a practice has
-- ACTUALLY confirmed they're not continuing. Not a function: this is a
-- rare, deliberate human action, not something to make easy to trigger
-- accidentally or from application code. ──
-- update public.practices set
--   retention_status = 'deletion_scheduled',
--   churn_confirmed_at = now(),
--   scheduled_data_deletion_date = current_date + interval '60 days'
-- where id = '<practice-id>';
--
-- To undo (the practice comes back before the deadline):
-- update public.practices set
--   retention_status = 'active', churn_confirmed_at = null, scheduled_data_deletion_date = null
-- where id = '<practice-id>';
