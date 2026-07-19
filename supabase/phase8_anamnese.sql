-- ══ Phase 8: move Anamnese (medical history questionnaire) to Supabase ══
--
-- Anamnese was deliberately left local-only when patients/termine/messages
-- were migrated (see the phase1 migration's scope notes) since it was lower
-- priority at the time. That gap is now a real, reported bug: a patient who
-- filled in their Anamnese on one device/browser gets wrongly asked to fill
-- it in again on any other device (or after clearing browser storage),
-- because patient_login only ever checked a browser-local record for
-- whether it had already been done -- it had no way to know the real
-- answer lives in a different browser entirely.
--
-- Stored as a single jsonb column (not one column per question) because the
-- actual field set already varies per medical specialty (see
-- vendor/anamnese-shared.js's per-Fach sections) -- a flexible free-form
-- document is a better fit than a rigid schema here.
--
-- Run this in the Supabase SQL editor.

alter table public.patients add column if not exists anamnese jsonb;

-- patient_login's return type is changing (new anamnese column), which
-- Postgres doesn't allow via CREATE OR REPLACE alone -- drop first.
drop function if exists public.patient_login(text,text);

create or replace function public.patient_login(p_username text, p_password text)
returns table(token uuid, patient_id uuid, full_name text, name text,
              first_login boolean, join_status text, join_note text, anamnese jsonb)
language plpgsql security definer set search_path = public as $$
declare v_patient patients; v_token uuid;
begin
  select * into v_patient from patients where username = lower(p_username);
  if not found or v_patient.pw_hash is null
     or crypt(p_password, v_patient.pw_hash) <> v_patient.pw_hash then
    return; -- empty result set = invalid credentials
  end if;
  if v_patient.join_status <> 'approved' then
    return query select null::uuid, v_patient.id, v_patient.full_name, v_patient.name,
                        v_patient.first_login, v_patient.join_status, v_patient.join_note, v_patient.anamnese;
    return;
  end if;
  insert into patient_sessions(patient_id) values (v_patient.id) returning patient_sessions.token into v_token;
  return query select v_token, v_patient.id, v_patient.full_name, v_patient.name,
                      v_patient.first_login, v_patient.join_status, v_patient.join_note, v_patient.anamnese;
end;
$$;
grant execute on function public.patient_login(text,text) to anon, authenticated;

-- Patients have no direct table access (RLS grants none to anon) -- this is
-- the only way a real patient can save their own Anamnese answers.
create or replace function public.patient_set_anamnese(p_token uuid, p_data jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_pid uuid;
begin
  v_pid := patient_id_from_token(p_token);
  if v_pid is null then return false; end if;
  update patients set anamnese = p_data where id = v_pid;
  return true;
end;
$$;
grant execute on function public.patient_set_anamnese(uuid,jsonb) to anon, authenticated;

-- Staff already have full direct access to the patients table (same
-- policy that already covers every other column here), so doctor.html's
-- own Anamnese tab reads/writes this new column via a normal
-- sb.from('patients').update(...) call -- no separate RPC needed for staff.
