-- ══════════════════════════════════════════════════════════════
-- Phase 58: scope patient_vaccine_dismissals to its own practice
--
-- Real cross-tenant RLS gap found via supabase/schema_health_check.sql's
-- own "RLS actually scopes access" check, right after phase57 shipped:
--
--   RLS actually scopes access | patient_vaccine_dismissals | WARNING --
--   every policy on this table looks fully unscoped
--
-- phase57_vaccine_dismissals.sql's own comment claimed its policy was "same
-- shape as patient_impfungen's own policy (phase5)" -- true when phase5 was
-- written, but phase12_multi_tenant_rls.sql later replaced patient_impfungen's
-- broad `using (true)` policy with one scoped to current_practice_id() (and
-- phase21 refined it further for trial enforcement). phase57 copied phase5's
-- ORIGINAL, now-superseded shape instead, without a phase12-equivalent
-- follow-up -- so every authenticated staff member, from ANY practice, could
-- read and write every OTHER practice's patient_vaccine_dismissals rows
-- (patient IDs + which vaccine reminders they've hidden). This closes that
-- gap the same way phase12 did for every other table.
--
-- Run this in the Supabase SQL editor for this project
-- (https://ewilgwndhpxibkogxqbk.supabase.co), after phase57.
-- ══════════════════════════════════════════════════════════════

-- 1) Add practice_id (nullable, like every other practice_id column added by
-- phase12 -- existing rows get backfilled below, new rows get it from the
-- trigger added in step 3).
alter table public.patient_vaccine_dismissals
  add column if not exists practice_id uuid references public.practices(id);

-- 2) Backfill any rows that already exist (this table is brand new as of
-- phase57, so this is likely a no-op, but matches phase12's own pattern
-- exactly in case any dismissals were recorded before this fix runs).
update public.patient_vaccine_dismissals d
  set practice_id = p.practice_id
  from public.patients p
  where d.patient_id = p.id
    and d.practice_id is null;

-- 3) Auto-set practice_id on every new row from here on, same as
-- patient_documents/mkp_untersuchungen/patient_impfungen (staff-only
-- inserts, no patient-facing insert RPC exists -- see dismissVaccineForPatient()
-- in vendor/patient-data.js).
drop trigger if exists trg_set_practice_id on public.patient_vaccine_dismissals;
create trigger trg_set_practice_id before insert on public.patient_vaccine_dismissals
  for each row execute function public.set_practice_id_from_staff();

-- 4) Replace the unscoped policy with one scoped to the caller's own
-- practice -- the actual fix.
drop policy if exists "staff full access to patient_vaccine_dismissals" on public.patient_vaccine_dismissals;
create policy "staff access scoped to own practice" on public.patient_vaccine_dismissals
  for all to authenticated using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());

-- 5) Index, matching phase35_practice_id_indexes.sql's pattern for every
-- other practice_id column (RLS filters on it on every single query).
create index if not exists patient_vaccine_dismissals_practice_id_idx
  on public.patient_vaccine_dismissals(practice_id);
