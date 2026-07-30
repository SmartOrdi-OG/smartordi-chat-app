-- ══════════════════════════════════════════════════════════════
-- Phase 49: real bug found during the comprehensive RLS audit -- patient_
-- book_termin() has never verified that p_arzt_id actually belongs to the
-- calling patient's own practice
--
-- Found while systematically re-reading every SECURITY DEFINER RPC that
-- takes a client-supplied id parameter (Point 1 from the launch-readiness
-- review -- "audit for other RLS blind-spot bugs"). patient_book_termin()
-- has been rewritten twice since it was first created (phase33, then
-- phase42's overlap check, then phase44's booking-toggle check) and none
-- of the three versions ever checked p_arzt_id against the patient's own
-- practice_id -- only the resulting termine ROW is correctly stamped with
-- the patient's own practice_id (via v_patient.practice_id, not derived
-- from the arzt), so this was never a cross-tenant READ leak. But nothing
-- stopped a request that supplies an arzt_id from a DIFFERENT practice
-- entirely (patient.html's own "Termin buchen" dropdown only ever offers
-- patient_get_staff_roster()'s own-practice list, so this can't happen
-- through the normal UI -- but exactly like phase44's own
-- online_booking_enabled check already reasoned about, "the actual block
-- has to live in the RPC a determined patient could otherwise still call
-- directly"). Reproduced directly against a throwaway local Postgres 16
-- instance mirroring this shape before writing this fix: a Praxis-A
-- patient calling patient_book_termin() with a Praxis-B doctor's id
-- happily inserted a termine row referencing that foreign arzt_id.
--
-- Fix: reject the call up front if p_arzt_id isn't a staff_profiles row in
-- the same practice as the calling patient -- same shape as every other
-- ownership check this function already does (patient_already_booked,
-- slot_taken), just one more `if exists(...)` guard before the insert.
-- Existing valid bookings are completely unaffected; this only rejects
-- requests that were never legitimate to begin with.
--
-- Run this in the Supabase SQL editor, after phase44_online_booking_toggle.sql.
-- ══════════════════════════════════════════════════════════════

create or replace function public.patient_book_termin(p_arzt_id uuid, p_date date,
                                                        p_time text, p_end_time text, p_art text)
returns termine
language plpgsql security definer set search_path = public as $$
declare v_pid uuid; v_patient patients; v_row termine; v_booking_enabled boolean;
begin
  v_pid := current_patient_id();
  if v_pid is null then raise exception 'invalid_session'; end if;
  select * into v_patient from patients where id = v_pid;
  select online_booking_enabled into v_booking_enabled from practices where id = v_patient.practice_id;
  if coalesce(v_booking_enabled, true) = false then
    raise exception 'booking_disabled';
  end if;
  if not exists(
    select 1 from staff_profiles where id = p_arzt_id and practice_id = v_patient.practice_id
  ) then
    raise exception 'invalid_arzt';
  end if;
  if exists(
    select 1 from termine
    where arzt_id = p_arzt_id and date = p_date and status <> 'abgesagt'
      and p_time < coalesce(end_time, to_char(time::time + interval '15 minutes', 'HH24:MI'))
      and time < p_end_time
  ) then
    raise exception 'slot_taken';
  end if;
  if exists(
    select 1 from termine
    where patient_id = v_pid and date = p_date and status <> 'abgesagt'
      and p_time < coalesce(end_time, to_char(time::time + interval '15 minutes', 'HH24:MI'))
      and time < p_end_time
  ) then
    raise exception 'patient_already_booked';
  end if;
  begin
    insert into termine(patient_id, patient_name, art, date, time, end_time, status, arzt_id, versicherung, tel, svnr, dob, practice_id)
      values (v_pid, v_patient.full_name, p_art, p_date, p_time, p_end_time, 'neu', p_arzt_id,
              v_patient.versicherung, v_patient.tel, v_patient.svnr, v_patient.dob, v_patient.practice_id)
      returning * into v_row;
  exception when unique_violation then
    if sqlerrm like '%termine_patient_slot_unique%' then
      raise exception 'patient_already_booked';
    else
      raise exception 'slot_taken';
    end if;
  end;
  return v_row;
end;
$$;
grant execute on function public.patient_book_termin(uuid,date,text,text,text) to authenticated;
