-- ══════════════════════════════════════════════════════════════
-- Phase 61: patient_send_message() never set practice_id -- patient chat
-- messages have been silently invisible to staff since phase33
--
-- Real report: a patient could join a practice and RECEIVE messages from
-- staff fine, but anything they SENT back never showed up for the
-- doctor/secretary, with no error on either side.
--
-- Root cause: phase12_multi_tenant_rls.sql's original patient_send_message()
-- correctly resolved and stored the sender's practice_id:
--
--   select practice_id into v_practice_id from patients where id = v_pid;
--   insert into patient_messages(patient_id, dir, type, text, practice_id)
--     values (v_pid, 'in', 'text', p_text, v_practice_id)
--
-- phase33_patient_login_cutover.sql rewrote the function (token -> real
-- Supabase Auth session) and dropped that entirely:
--
--   insert into patient_messages(patient_id, dir, type, text)
--     values (v_pid, 'in', 'text', p_text)
--
-- patient_messages does have a trg_set_practice_id trigger (phase12), but
-- it calls set_practice_id_from_staff(), which resolves practice_id via
-- `select practice_id from staff_profiles where id = auth.uid()` -- a
-- patient's auth.uid() has no staff_profiles row, so that always returns
-- null for a patient-sent message. The row inserts successfully (no error
-- shown to the patient), but staff's own RLS policy on this table requires
-- `practice_id = current_practice_id()`, which a null practice_id can never
-- satisfy -- so the message is silently invisible to staff forever. The
-- other direction (staff -> patient) was never affected: staff-inserted
-- rows get practice_id from that same trigger correctly, since the sender
-- IS in staff_profiles, and patient_get_messages() only filters by
-- patient_id (not practice_id), so the patient could always read those.
--
-- Run this in the Supabase SQL editor for this project
-- (https://ewilgwndhpxibkogxqbk.supabase.co), after phase60.
-- ══════════════════════════════════════════════════════════════

-- 1) Fix the function itself so every NEW patient-sent message gets a
-- correct practice_id, same as the original phase12 version.
create or replace function public.patient_send_message(p_text text)
returns patient_messages
language plpgsql security definer set search_path = public as $$
declare v_pid uuid; v_practice_id uuid; v_row patient_messages;
begin
  v_pid := current_patient_id();
  if v_pid is null then raise exception 'invalid_session'; end if;
  select practice_id into v_practice_id from patients where id = v_pid;
  insert into patient_messages(patient_id, dir, type, text, practice_id)
    values (v_pid, 'in', 'text', p_text, v_practice_id)
    returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.patient_send_message(text) to authenticated;

-- 2) Recover every message that already got silently stranded with a null
-- practice_id since phase33 shipped -- these are real messages patients
-- already sent that no staff member has ever been able to see. Backfilling
-- practice_id makes them appear for staff immediately, in their original
-- chronological position (created_at is untouched).
update public.patient_messages m
  set practice_id = p.practice_id
  from public.patients p
  where m.patient_id = p.id
    and m.practice_id is null;
