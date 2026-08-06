-- ══════════════════════════════════════════════════════════════
-- Phase 55: patient_get_staff_roster() -- add is_admin
--
-- Real user report: a real patient's chat header/Termine subtitle showed
-- "—" instead of the practice's actual doctor name, even though the same
-- patient's messages/Termine/documents all loaded correctly (proving their
-- session itself was fine). Root cause: patient.html's
-- updatePracticeIdentityUI() finds the practice's admin doctor via
-- `accounts.find(a => a.role==='arzt' && a.isAdmin)` -- but
-- patient_get_staff_roster() (phase45) never RETURNS is_admin at all, so
-- that field is always undefined for a patient/guardian session and the
-- find() never matches, no matter who's actually the admin. The staff-side
-- roster fetch (vendor/staff-accounts.js's refreshStaffRoster(), a direct
-- table read) already selects '*' and includes it -- only the patient-
-- facing RPC was missing the column.
--
-- Run this in the Supabase SQL editor, after phase45_patient_staff_roster.sql.
-- ══════════════════════════════════════════════════════════════

create or replace function public.patient_get_staff_roster()
returns table(id uuid, vorname text, nachname text, full_name text, role text, fach text, is_admin boolean)
language plpgsql security definer set search_path = public as $$
declare v_pid uuid; v_practice_id uuid;
begin
  v_pid := current_patient_id();
  if v_pid is null then return; end if;
  select practice_id into v_practice_id from patients where id = v_pid;
  return query select sp.id, sp.vorname, sp.nachname, sp.full_name, sp.role, sp.fach, sp.is_admin
    from staff_profiles sp where sp.practice_id = v_practice_id;
end;
$$;
grant execute on function public.patient_get_staff_roster() to authenticated;
