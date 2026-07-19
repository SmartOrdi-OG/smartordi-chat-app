-- ══ Prevent double-booking: same doctor or same patient, same slot ══
--
-- Nothing anywhere in this app ever checked whether a patient already had a
-- DIFFERENT appointment (with a different doctor) at the exact same time --
-- a real risk once multiple doctors share one practice-wide calendar (which
-- they do, by design: patients belong to the practice, not to one specific
-- doctor). The only existing check at all was patient.html's own
-- self-booking RPC (patient_book_termin), and only for "is this SAME doctor
-- already booked then" -- never "is this patient already booked with
-- someone else then." The staff-side booking path (secretary.html's
-- createTermin/insertTermin) had NO conflict check whatsoever, not even for
-- the same doctor.
--
-- The real fix is at the database level: a unique index enforced by
-- Postgres itself can't be raced by two near-simultaneous requests the way
-- an application-side "check, then insert" always can. The partial "where
-- status <> 'abgesagt'" clause is required -- a cancelled appointment must
-- never block reusing that same slot.
--
-- If this fails with "could not create unique index -- key already exists,"
-- it means there's a REAL pre-existing double-booking in the data already;
-- run
--   select arzt_id, date, time, array_agg(id) from termine where status <> 'abgesagt' group by 1,2,3 having count(*) > 1;
-- (or the same with patient_id instead of arzt_id) to find and resolve it
-- by hand before re-running this file.
--
-- Run this in the Supabase SQL editor.

create unique index if not exists termine_arzt_slot_unique
  on public.termine(arzt_id, date, time)
  where status <> 'abgesagt';

create unique index if not exists termine_patient_slot_unique
  on public.termine(patient_id, date, time)
  where status <> 'abgesagt' and patient_id is not null;

-- Adds the missing patient-side conflict check, and wraps the insert so a
-- race caught by the unique indexes above (two requests that both passed
-- the "if exists" checks before either committed) still raises the SAME
-- clean, expected exception text instead of a raw Postgres constraint-name
-- error leaking to the patient. Otherwise identical to
-- phase12_multi_tenant_rls.sql's version of this function.
create or replace function public.patient_book_termin(p_token uuid, p_arzt_id uuid, p_date date,
                                                        p_time text, p_end_time text, p_art text)
returns termine
language plpgsql security definer set search_path = public as $$
declare v_pid uuid; v_patient patients; v_row termine;
begin
  v_pid := patient_id_from_token(p_token);
  if v_pid is null then raise exception 'invalid_or_expired_session'; end if;
  select * into v_patient from patients where id = v_pid;
  if exists(select 1 from termine where arzt_id = p_arzt_id and date = p_date and time = p_time and status <> 'abgesagt') then
    raise exception 'slot_taken';
  end if;
  if exists(select 1 from termine where patient_id = v_pid and date = p_date and time = p_time and status <> 'abgesagt') then
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
grant execute on function public.patient_book_termin(uuid,uuid,date,text,text,text) to anon, authenticated;
