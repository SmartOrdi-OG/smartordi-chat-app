-- ══════════════════════════════════════════════════════════════
-- Phase 56: patient_get_staff_roster() -- fix ambiguous "id" column
--
-- Real user report, this time caught directly from the browser console
-- (not just an empty list): patientRefreshStaffRoster failed with a genuine
-- HTTP 400 -- code 42702, "column reference \"id\" is ambiguous", "It could
-- refer to either a PL/pgSQL variable or a table column." Root cause: this
-- function's own `returns table(id uuid, ...)` clause creates an OUT
-- parameter literally named `id`, and its body has an UNQUALIFIED
-- `where id = v_pid` -- Postgres can't tell whether that `id` means the
-- OUT parameter or patients.id, so the call always throws.
--
-- This bug has existed since phase45 first introduced this function (the
-- exact same unqualified `where id = v_pid` line) -- every previous "empty
-- Arzt dropdown / doctor name shows —" investigation this thread ran was
-- chasing a data-consistency explanation that didn't exist; the real cause
-- was this one line throwing on every single call, for every patient,
-- the entire time. patientRefreshStaffRoster()'s own error handling just
-- logs and returns silently, so the failure never surfaced until DevTools
-- was opened directly.
--
-- A full audit of every other patient-facing RPC with a `returns table(id
-- uuid, ...)` shape (patient_get_profile, patient_get_documents,
-- patient_get_impfungen, guardian_get_children, guardian_get_profile, ...)
-- confirms none of them have this bug -- they all already qualify their
-- own `id` references (p.id, pd.id, pi.id, g.id). This is an isolated fix.
--
-- Run this in the Supabase SQL editor, after phase55. Return columns are
-- unchanged from phase55, so create or replace is enough here -- no need
-- to drop the function first this time (that's only required when the
-- OUT-parameter/return-column list itself changes).
-- ══════════════════════════════════════════════════════════════

create or replace function public.patient_get_staff_roster()
returns table(id uuid, vorname text, nachname text, full_name text, role text, fach text, is_admin boolean)
language plpgsql security definer set search_path = public as $$
declare v_pid uuid; v_practice_id uuid;
begin
  v_pid := current_patient_id();
  if v_pid is null then return; end if;
  select p.practice_id into v_practice_id from patients p where p.id = v_pid;
  return query select sp.id, sp.vorname, sp.nachname, sp.full_name, sp.role, sp.fach, sp.is_admin
    from staff_profiles sp where sp.practice_id = v_practice_id;
end;
$$;
grant execute on function public.patient_get_staff_roster() to authenticated;
