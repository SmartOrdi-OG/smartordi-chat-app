-- Phase 79: unified patient consent, moved to the ONE real moment that
-- actually applies to every patient regardless of how their account was
-- created -- their first real login with username+password (QR scan or
-- typed in directly) -- instead of account-CREATION time, which never
-- happens for a patient the secretary adds via "+ Neuer Patient" at all.
--
-- Real gap found during a legal-pages review (2026-08-20): patient.html's
-- own Profil screen has ALWAYS shown a hardcoded "DSGVO-Einwilligung:
-- Erteilt" label (see phase59_consent_records.sql's own header comment --
-- it flagged this same gap when it shipped record_consent(), for the
-- doctor-registration and patient-self-registration cases only). A patient
-- the secretary creates directly never sees ANY consent checkbox anywhere,
-- yet their own profile claims one was granted. Fixed for good this time by
-- making consent a real, per-patient, checked-at-login gate -- not tied to
-- how the account happened to get created.
--
-- 1) The fast, per-patient gate every login checks -- null means "hasn't
--    gone through this consent step yet", regardless of whether the account
--    is brand new or years old. Deliberately NOT backfilled for existing
--    rows (see this migration's own README/TODO.md entry for why) -- every
--    currently-existing patient will see the real consent screen on their
--    very next login, same as a brand-new one.
alter table public.patients add column if not exists consent_given_at timestamptz;

-- 2) consent_records (phase59) was only ever built for a pre-patient-row
--    moment (doctor registration, a not-yet-approved join request) -- it has
--    no patient_id at all. Add one (nullable -- older rows, and the
--    'patient_join_request' type, still have none) so a real per-patient
--    consent event can be traced back to an exact patient row, not just a
--    free-text name.
alter table public.consent_records add column if not exists patient_id uuid references public.patients(id);

-- 3) Two new consent_type values for the two checkboxes this login screen
--    now requires -- kept as two separate rows/types (not one) so the
--    evidence trail shows exactly which statement was agreed to.
alter table public.consent_records drop constraint if exists consent_records_consent_type_check;
alter table public.consent_records add constraint consent_records_consent_type_check
  check (consent_type in (
    'doctor_registration','patient_join_request',
    'patient_data_processing','patient_data_accuracy'
  ));

-- 4) The real RPC an already-authenticated patient session calls once both
--    checkboxes are ticked. Identity comes from current_patient_id() (the
--    real signed-in session), never from a client-supplied id -- same trust
--    boundary as patient_change_username()/patient_update_profile(). Writes
--    BOTH consent_records rows and flips the patients.consent_given_at gate
--    in one transaction: a caller that never sees "true" back must be
--    treated as never having consented, so this only ever fully succeeds or
--    fully fails, never partially.
create or replace function public.patient_record_login_consent(p_policy_version text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_pid uuid; v_practice_id uuid; v_full_name text;
begin
  v_pid := current_patient_id();
  if v_pid is null then return false; end if;
  select practice_id, full_name into v_practice_id, v_full_name
    from public.patients where id = v_pid;
  if v_practice_id is null then return false; end if;

  insert into public.consent_records(practice_id, consent_type, full_name, patient_id, policy_version)
    values (v_practice_id, 'patient_data_processing', v_full_name, v_pid, p_policy_version);
  insert into public.consent_records(practice_id, consent_type, full_name, patient_id, policy_version)
    values (v_practice_id, 'patient_data_accuracy', v_full_name, v_pid, p_policy_version);

  update public.patients set consent_given_at = now() where id = v_pid;
  return true;
end;
$$;
grant execute on function public.patient_record_login_consent(text) to authenticated;

-- 5) patient_get_profile() now also returns the gate itself -- doLogin()
--    (patient-login.html) is the only real caller that needs it, to decide
--    whether to show the new consent screen at all.
create or replace function public.patient_get_profile()
returns table(
  id uuid, username text, name text, full_name text, fach text, dob date,
  adresse text, tel text, email text, versicherung text, svnr text,
  first_login boolean, join_status text, join_note text, anamnese jsonb,
  is_child boolean, geschlecht text, consent_given_at timestamptz
)
language plpgsql security definer set search_path = public as $$
declare v_pid uuid;
begin
  v_pid := current_patient_id();
  if v_pid is null then return; end if;
  return query select p.id,p.username,p.name,p.full_name,p.fach,p.dob,p.adresse,p.tel,p.email,p.versicherung,p.svnr,p.first_login,
    p.join_status, p.join_note, p.anamnese, p.is_child, p.geschlecht, p.consent_given_at
    from patients p where p.id = v_pid;
end;
$$;

-- Run this in the Supabase SQL editor for this project
-- (https://ewilgwndhpxibkogxqbk.supabase.co). Then run
-- supabase/schema_health_check.sql to confirm it applied cleanly.
