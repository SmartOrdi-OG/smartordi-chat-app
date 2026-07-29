-- ══════════════════════════════════════════════════════════════
-- Phase 42: patient_book_termin() -- real time-RANGE overlap check,
-- not just an exact start-time match
--
-- patient_book_termin() (phase33_patient_login_cutover.sql) only ever
-- compared `date = p_date and time = p_time` against existing termine for
-- the same arzt_id (and, separately, the same patient) -- a staff-booked
-- appointment that runs longer than the patient-booking page's own fixed
-- 20-minute slots (e.g. 09:00-09:45) was never actually blocked: a real
-- patient could pick 09:15 or 09:30 as if they were free, since neither
-- equals '09:00' exactly, creating a silent double-booking. patient.html's
-- OWN client-side pre-check for local/demo accounts already does a real
-- [start,end) range comparison (see its own comment, "Compares real
-- [start,end) ranges rather than exact start times") -- this brings the
-- server-side check actually enforced for real (Supabase-backed) patients
-- up to the same standard, since the client-side pre-check is explicitly
-- skipped for them (RLS blocks a patient from seeing other patients'
-- schedules at all, so there's nothing to pre-check against -- the
-- rejection has always been meant to happen here). Found in a full
-- app-wide bug audit (2026-07-29).
--
-- Overlap test for half-open ranges [start,end): A overlaps B iff
-- A.start < B.end AND B.start < A.end. An existing row with no end_time
-- (shouldn't normally happen for a real termin, but defensively handled
-- the same way patient.html's own client-side check already does) is
-- treated as a 15-minute slot.
--
-- Run this in the Supabase SQL editor, after phase33_patient_login_cutover.sql.
-- ══════════════════════════════════════════════════════════════

create or replace function public.patient_book_termin(p_arzt_id uuid, p_date date,
                                                        p_time text, p_end_time text, p_art text)
returns termine
language plpgsql security definer set search_path = public as $$
declare v_pid uuid; v_patient patients; v_row termine;
begin
  v_pid := current_patient_id();
  if v_pid is null then raise exception 'invalid_session'; end if;
  select * into v_patient from patients where id = v_pid;
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
