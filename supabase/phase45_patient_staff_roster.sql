-- ══════════════════════════════════════════════════════════════
-- Phase 45: real fix for a live production bug -- patient.html's own
-- doctor list ("Termin buchen"'s Arzt dropdown, and the "Behandelnde
-- Ärzte/Ärztinnen" row on the Profil tab) has been silently EMPTY for
-- every real (Supabase-backed) patient/guardian session all along --
-- found via a user report ("no options" when trying to book a new
-- appointment from a guardian-selected child account).
--
-- Root cause: vendor/staff-accounts.js's refreshStaffRoster() does a
-- direct `sb.from('staff_profiles').select('*')`, relying entirely on
-- RLS to scope the results -- correct for doctor.html/secretary.html (a
-- real STAFF session), but a patient/guardian session's auth.uid() has
-- no row in staff_profiles at all, so current_practice_id() (phase12,
-- which reads FROM staff_profiles) resolves to null for them, and the
-- "view within own practice" policy (practice_id = current_practice_id())
-- never matches anything -- silently returning zero rows, no error at
-- all (RLS just filters; it never fails loudly). Every OTHER patient-
-- facing read already goes through its own SECURITY DEFINER RPC for
-- exactly this reason (patient_get_working_hours, patient_get_chat_enabled,
-- patient_get_booking_enabled...) -- this table was the one direct-select
-- left over from before real patient/guardian Supabase Auth existed, and
-- nobody had actually tried booking a brand-new appointment as a freshly-
-- authenticated real patient/guardian in production until now.
--
-- Uses current_patient_id() (resolves BOTH a direct patient session and a
-- guardian's currently-selected child, same as every other patient_* RPC)
-- purely to confirm the caller is a real patient/guardian at all and to
-- find their practice_id -- the roster itself is scoped to that practice,
-- same shape doctor.html/secretary.html already get from the direct select.
--
-- Run this in the Supabase SQL editor, after phase31_patient_auth.sql.
-- ══════════════════════════════════════════════════════════════

create or replace function public.patient_get_staff_roster()
returns table(id uuid, vorname text, nachname text, full_name text, role text, fach text)
language plpgsql security definer set search_path = public as $$
declare v_pid uuid; v_practice_id uuid;
begin
  v_pid := current_patient_id();
  if v_pid is null then return; end if;
  select practice_id into v_practice_id from patients where id = v_pid;
  return query select sp.id, sp.vorname, sp.nachname, sp.full_name, sp.role, sp.fach
    from staff_profiles sp where sp.practice_id = v_practice_id;
end;
$$;
grant execute on function public.patient_get_staff_roster() to authenticated;
