-- ══ Fixes "Meine Ordination" on patient.html always showing "—" for
-- Adresse/Telefon, even when the practice has both filled in ══
--
-- Same exact root cause as phase45's patient_get_staff_roster() and
-- phase48's public_get_practice_join_info(): patient.html's
-- updatePracticeIdentityUI() reads adresse/tel via getPracticeSettings()
-- (vendor/staff-accounts.js), which does a direct sb.from('practices').
-- select(...) gated by phase15_staff_practice_rls.sql's "view own
-- practice" policy (id = current_practice_id()). current_practice_id()
-- resolves via staff_profiles, which has no row at all for a patient's
-- auth.uid() -- so that query always silently returns zero rows for a real
-- patient/guardian session (not a Postgres error, RLS just filters
-- everything out), leaving _practiceSettings null and Adresse/Telefon
-- stuck on "—" for every practice, regardless of whether the doctor ever
-- filled them in.
--
-- Deliberately returns ONLY adresse/tel -- the two fields
-- updatePracticeIdentityUI() actually reads off practiceInfo (the practice
-- name shown there comes from the admin doctor's own name via
-- patient_get_staff_roster(), not from this).
--
-- Run this in the Supabase SQL editor, after phase31_patient_auth.sql (or
-- phase64_unified_account_profiles.sql, whichever defined current_patient_id()
-- last on this project) and phase11_multi_tenant_schema.sql.

create or replace function public.patient_get_practice_contact()
returns table(adresse text, tel text)
language plpgsql security definer set search_path = public as $$
declare v_pid uuid; v_practice_id uuid;
begin
  v_pid := current_patient_id();
  if v_pid is null then return; end if;
  select practice_id into v_practice_id from patients where id = v_pid;
  return query select pr.adresse, pr.tel from practices pr where pr.id = v_practice_id;
end;
$$;
grant execute on function public.patient_get_practice_contact() to authenticated;
