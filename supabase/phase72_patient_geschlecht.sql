-- ══════════════════════════════════════════════════════════════
-- Phase 72: geschlecht (gender) field on patients/patient_join_requests
--
-- Real user request (2026-08-16): the symptom-picker's body figure
-- (vendor/symptom-body-figures.js, added 2026-08-14) had a manual Mann/Frau
-- toggle because there was, until now, no real gender field anywhere on a
-- patient record at all -- confirmed by grepping every manual patient-entry
-- form (patient-login.html self-registration, secretary.html's "+ Neuer
-- Patient") and every import path (CSV, ENDS Normdatensatz). The user asked
-- for the figure to auto-select from whatever gender the patient specifies
-- when THEY register their own data, so a real column is needed first.
--
-- Same investigation also turned up a genuine, previously-unknown data-loss
-- bug: vendor/migration-normdatensatz.js's ENDS1_P_FIELDS dictionary has
-- always recognized the GES ("Geschlecht") field from an Altsystem export,
-- but doctor.html's import-write path (confirmMigrationImport()) never
-- read it back out of `stammdaten` into anything -- not even into
-- legacyHistory the way a genuinely UNMAPPED field would be. A recognized-
-- but-unused field was silently discarded, worse than an unmapped one.
--
-- Three distinct values, matching Austria's own legal convention since 2018
-- (dritte Option "divers"): 'm' (männlich), 'w' (weiblich), 'd' (divers).
-- NULL means "keine Angabe" -- never forced, on any entry path.
--
-- Deliberately NOT added to patient_update_profile() (phase63): that RPC is
-- scoped to contact info only (adresse/tel/email) -- geschlecht joins
-- dob/svnr/versicherung as an identity-ish field set once at
-- registration/by staff, same reasoning as phase63's own header comment.
-- Staff CAN correct/set it later via secretary.html's "Patient bearbeiten"
-- modal (savePatientEdit() -> upsertPatientIdentity(), unaffected by this
-- migration -- that path writes directly to the patients table with staff's
-- own authenticated role, no RPC needed).
--
-- Run this in the Supabase SQL editor. Then run schema_health_check.sql to
-- confirm it applied cleanly.
-- ══════════════════════════════════════════════════════════════

alter table public.patients add column if not exists geschlecht text;
alter table public.patients drop constraint if exists patients_geschlecht_check;
alter table public.patients add constraint patients_geschlecht_check check (geschlecht is null or geschlecht in ('m','w','d'));

alter table public.patient_join_requests add column if not exists geschlecht text;
alter table public.patient_join_requests drop constraint if exists patient_join_requests_geschlecht_check;
alter table public.patient_join_requests add constraint patient_join_requests_geschlecht_check check (geschlecht is null or geschlecht in ('m','w','d'));

-- Return type is changing (one extra column) -- has to be dropped first,
-- same reason/pattern as phase65's own patient_get_profile() change.
drop function if exists public.patient_get_profile();
create or replace function public.patient_get_profile()
returns table(id uuid, username text, name text, full_name text, fach text, dob date,
              adresse text, tel text, email text, versicherung text, svnr text, first_login boolean,
              join_status text, join_note text, anamnese jsonb, is_child boolean, geschlecht text)
language plpgsql security definer set search_path = public as $$
declare v_pid uuid;
begin
  v_pid := current_patient_id();
  if v_pid is null then return; end if;
  return query select p.id,p.username,p.name,p.full_name,p.fach,p.dob,p.adresse,p.tel,p.email,p.versicherung,p.svnr,p.first_login,
    p.join_status, p.join_note, p.anamnese, p.is_child, p.geschlecht
    from patients p where p.id = v_pid;
end;
$$;
grant execute on function public.patient_get_profile() to authenticated;
