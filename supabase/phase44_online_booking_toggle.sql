-- ══════════════════════════════════════════════════════════════
-- Phase 44: practice-wide "Online-Terminbuchung" on/off switch, toggled
-- from the secretary's account
--
-- User request: a way to close online appointment booking for patients
-- from the Sekretärin account -- e.g. the practice is fully booked for a
-- while, or wants to handle scheduling by phone only for a period. Same
-- shape as phase34_chat_toggle.sql's practice-wide "Chat aktivieren"
-- switch (one boolean on `practices`, defaulting to enabled so every
-- existing practice keeps working exactly as before), but for
-- patient_book_termin() instead of chat.
--
-- Enforced SERVER-SIDE in patient_book_termin() itself, not just hidden in
-- the UI -- patient.html's own booking card is also hidden/replaced with a
-- notice when this is off, but that alone would only be a UI nicety; the
-- actual block has to live in the RPC a determined patient could otherwise
-- still call directly. Existing appointments are completely unaffected --
-- this only blocks NEW patient-initiated bookings; staff can still book
-- appointments for a patient from doctor.html/secretary.html as normal.
--
-- Run this in the Supabase SQL editor, after phase33_patient_login_cutover.sql
-- and phase42_patient_book_termin_overlap_check.sql (this replaces that
-- file's patient_book_termin() definition with one more check added).
-- ══════════════════════════════════════════════════════════════

alter table public.practices add column if not exists online_booking_enabled boolean not null default true;

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

-- Patient-facing read of the practice-wide switch -- patients have no
-- direct table access to `practices` under RLS, same reason
-- patient_get_chat_enabled() exists instead of a raw select.
create or replace function public.patient_get_booking_enabled()
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_patient_id uuid; v_practice_id uuid; v_enabled boolean;
begin
  v_patient_id := current_patient_id();
  if v_patient_id is null then return true; end if;
  select practice_id into v_practice_id from patients where id = v_patient_id;
  select online_booking_enabled into v_enabled from practices where id = v_practice_id;
  return coalesce(v_enabled, true);
end;
$$;
grant execute on function public.patient_get_booking_enabled() to authenticated;
