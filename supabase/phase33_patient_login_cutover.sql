-- ══ Cut patient/guardian login over to real Supabase Auth ══
--
-- phase31/phase32 added the plumbing (auth_user_id columns, synthetic-email
-- helpers, current_patient_id()/current_guardian_id()) and every existing
-- patient/guardian already has a real Auth user (via create-patient-auth-
-- user going forward, migrate-patients-to-auth for everyone who predated
-- it). This phase is the actual cutover: every patient_*/guardian_* RPC
-- drops its p_token/p_guardian_token argument in favor of resolving
-- identity from the caller's real Supabase Auth session (auth.uid(), via
-- current_patient_id()/current_guardian_id()) -- the same pattern staff-
-- side RPCs already use via current_practice_id().
--
-- Login itself can't be a single direct sb.auth.signInWithPassword() call
-- the way staff's already is, for two reasons this file's new *_precheck
-- functions exist to solve:
--
-- 1. A patient only ever knows their USERNAME, never the synthetic email
--    (p_<id>@patients.smartordi.internal) Supabase Auth actually needs --
--    so there has to be a lookup step before sign-in can even be
--    attempted, and it has to run as `anon` (no session exists yet).
--
-- 2. patients.failed_login_attempts/locked_until/temp_password_set_at
--    (phase14_patient_login_hardening.sql) is bespoke lockout logic this
--    project built specifically because patients never had Supabase
--    Auth's own protections -- switching to real Auth doesn't get that
--    logic for free (GoTrue's own rate-limiting is separate/generic, not
--    "lock THIS account for 15 minutes after 5 wrong attempts"), and the
--    user explicitly asked to keep it working exactly as it does today.
--
-- So patient_login_precheck(username, password) keeps doing the SAME
-- password-hash check and lockout bookkeeping the old patient_login RPC
-- did, but instead of minting a patient_sessions token on success, it
-- returns the synthetic email -- the client then immediately calls
-- sb.auth.signInWithPassword({email, password}) with the SAME password
-- just verified, which succeeds because create-patient-auth-user/
-- migrate-patients-to-auth already kept the real Auth password in sync.
-- A wrong password never reaches signInWithPassword at all (precheck
-- returns null first), so this doesn't cost an extra failed-Auth-attempt
-- on top of the bespoke lockout counter.
--
-- guardian_login_precheck mirrors this but simpler -- guardians never had
-- the lockout feature to begin with (see phase28's own comments), so
-- there's no counter/lockout logic to preserve for them.
--
-- Run this in the Supabase SQL editor, after phase31 and phase32.

-- ══════════════════════════════════════════════════════════════
-- Login precheck (anon-callable -- no session exists yet)
-- ══════════════════════════════════════════════════════════════

create or replace function public.patient_login_precheck(p_username text, p_password text)
returns text
language plpgsql security definer set search_path = public as $$
declare v_patient patients;
begin
  select * into v_patient from patients where username = lower(p_username);
  if not found then
    return null; -- generic invalid-credentials contract, no existence leak
  end if;

  if v_patient.locked_until is not null and v_patient.locked_until > now() then
    raise exception 'account_locked';
  end if;

  if v_patient.first_login and v_patient.temp_password_set_at is not null
     and v_patient.temp_password_set_at < now() - interval '7 days' then
    raise exception 'temp_password_expired';
  end if;

  if v_patient.pw_hash is null or crypt(p_password, v_patient.pw_hash) <> v_patient.pw_hash then
    update patients set
      failed_login_attempts = failed_login_attempts + 1,
      locked_until = case when failed_login_attempts + 1 >= 5 then now() + interval '15 minutes' else locked_until end
      where id = v_patient.id;
    return null;
  end if;

  update patients set failed_login_attempts = 0, locked_until = null where id = v_patient.id;

  -- Not yet approved (self-registered, pending/rejected join request) --
  -- the client's own check_join_request_status fallback handles telling
  -- the patient about that; this just declines to hand back a sign-in
  -- email for an account that doesn't have real access yet, same as the
  -- old patient_login returning a null token for this case.
  if v_patient.join_status <> 'approved' then
    return null;
  end if;

  if v_patient.auth_user_id is null then
    -- Shouldn't happen for any patient with a working pw_hash --
    -- create-patient-auth-user/migrate-patients-to-auth already cover
    -- every such account -- but fail closed rather than hand back an
    -- email with no matching Auth user (sign-in would just reject it
    -- anyway, this just avoids the pointless round-trip).
    return null;
  end if;

  return 'p_' || v_patient.id::text || '@patients.smartordi.internal';
end;
$$;
grant execute on function public.patient_login_precheck(text,text) to anon, authenticated;

create or replace function public.guardian_login_precheck(p_username text, p_password text)
returns text
language plpgsql security definer set search_path = public as $$
declare v_g patient_guardians;
begin
  select * into v_g from patient_guardians where username = lower(p_username);
  if not found or v_g.pw_hash is null or crypt(p_password, v_g.pw_hash) <> v_g.pw_hash then
    return null;
  end if;
  if v_g.auth_user_id is null then
    return null;
  end if;
  return 'g_' || v_g.id::text || '@guardians.smartordi.internal';
end;
$$;
grant execute on function public.guardian_login_precheck(text,text) to anon, authenticated;

-- ══════════════════════════════════════════════════════════════
-- Password change -- sb.auth.updateUser({password}) now does the actual
-- password update; these just flip first_login off, same as the old
-- patient_change_password/guardian_change_password did alongside theirs.
-- ══════════════════════════════════════════════════════════════

create or replace function public.patient_mark_password_changed()
returns boolean language plpgsql security definer set search_path = public as $$
declare v_pid uuid;
begin
  v_pid := current_patient_id();
  if v_pid is null then return false; end if;
  update patients set first_login = false where id = v_pid;
  return true;
end;
$$;
grant execute on function public.patient_mark_password_changed() to authenticated;

create or replace function public.guardian_mark_password_changed()
returns boolean language plpgsql security definer set search_path = public as $$
declare v_gid uuid;
begin
  v_gid := current_guardian_id();
  if v_gid is null then return false; end if;
  update patient_guardians set first_login = false where id = v_gid;
  return true;
end;
$$;
grant execute on function public.guardian_mark_password_changed() to authenticated;

-- ══════════════════════════════════════════════════════════════
-- Every remaining patient_*/guardian_* RPC: drop p_token, resolve
-- identity via current_patient_id()/current_guardian_id() instead.
-- Each needs an explicit DROP first since the argument list changes
-- (CREATE OR REPLACE can't do that, only alter a function's body).
-- ══════════════════════════════════════════════════════════════

drop function if exists public.patient_get_profile(uuid);
create or replace function public.patient_get_profile()
returns table(id uuid, username text, name text, full_name text, fach text, dob date,
              adresse text, tel text, email text, versicherung text, svnr text, first_login boolean,
              join_status text, join_note text, anamnese jsonb)
language plpgsql security definer set search_path = public as $$
declare v_pid uuid;
begin
  v_pid := current_patient_id();
  if v_pid is null then return; end if;
  return query select p.id,p.username,p.name,p.full_name,p.fach,p.dob,p.adresse,p.tel,p.email,p.versicherung,p.svnr,p.first_login,
    p.join_status, p.join_note, p.anamnese
    from patients p where p.id = v_pid;
end;
$$;
grant execute on function public.patient_get_profile() to authenticated;

drop function if exists public.patient_get_messages(uuid);
create or replace function public.patient_get_messages()
returns setof patient_messages
language plpgsql security definer set search_path = public as $$
declare v_pid uuid;
begin
  v_pid := current_patient_id();
  if v_pid is null then return; end if;
  return query select * from patient_messages where patient_id = v_pid order by created_at asc;
end;
$$;
grant execute on function public.patient_get_messages() to authenticated;

drop function if exists public.patient_send_message(uuid,text);
create or replace function public.patient_send_message(p_text text)
returns patient_messages
language plpgsql security definer set search_path = public as $$
declare v_pid uuid; v_row patient_messages;
begin
  v_pid := current_patient_id();
  if v_pid is null then raise exception 'invalid_session'; end if;
  insert into patient_messages(patient_id, dir, type, text) values (v_pid, 'in', 'text', p_text)
    returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.patient_send_message(text) to authenticated;

drop function if exists public.patient_get_termine(uuid);
create or replace function public.patient_get_termine()
returns setof termine
language plpgsql security definer set search_path = public as $$
declare v_pid uuid;
begin
  v_pid := current_patient_id();
  if v_pid is null then return; end if;
  return query select * from termine where patient_id = v_pid order by date, time;
end;
$$;
grant execute on function public.patient_get_termine() to authenticated;

drop function if exists public.patient_book_termin(uuid,uuid,date,text,text,text);
create or replace function public.patient_book_termin(p_arzt_id uuid, p_date date,
                                                        p_time text, p_end_time text, p_art text)
returns termine
language plpgsql security definer set search_path = public as $$
declare v_pid uuid; v_patient patients; v_row termine;
begin
  v_pid := current_patient_id();
  if v_pid is null then raise exception 'invalid_session'; end if;
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
grant execute on function public.patient_book_termin(uuid,date,text,text,text) to authenticated;

drop function if exists public.patient_set_symptoms(uuid,uuid,text[],text);
create or replace function public.patient_set_symptoms(p_termin_id uuid, p_reason text[], p_reason_note text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_pid uuid;
begin
  v_pid := current_patient_id();
  if v_pid is null then return false; end if;
  update termine set reason = p_reason, reason_note = p_reason_note, updated_at = now()
    where id = p_termin_id and patient_id = v_pid;
  return found;
end;
$$;
grant execute on function public.patient_set_symptoms(uuid,text[],text) to authenticated;

drop function if exists public.patient_get_documents(uuid);
create or replace function public.patient_get_documents()
returns table(id uuid, category text, title text, filename text, mime_type text,
              size_bytes int, body_text text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_pid uuid;
begin
  v_pid := current_patient_id();
  if v_pid is null then return; end if;
  return query select pd.id, pd.category, pd.title, pd.filename, pd.mime_type, pd.size_bytes, pd.body_text, pd.created_at
    from patient_documents pd where pd.patient_id = v_pid order by pd.created_at desc;
end;
$$;
grant execute on function public.patient_get_documents() to authenticated;

drop function if exists public.patient_get_document_file(uuid,uuid);
create or replace function public.patient_get_document_file(p_doc_id uuid)
returns table(filename text, mime_type text, file_data text)
language plpgsql security definer set search_path = public as $$
declare v_pid uuid;
begin
  v_pid := current_patient_id();
  if v_pid is null then return; end if;
  return query select pd.filename, pd.mime_type, pd.file_data
    from patient_documents pd where pd.id = p_doc_id and pd.patient_id = v_pid;
end;
$$;
grant execute on function public.patient_get_document_file(uuid) to authenticated;

drop function if exists public.patient_get_impfungen(uuid);
create or replace function public.patient_get_impfungen()
returns table(id uuid, vaccine_key text, vaccine_name text, dose_label text,
              datum date, next_due date, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_pid uuid;
begin
  v_pid := current_patient_id();
  if v_pid is null then return; end if;
  return query select pi.id, pi.vaccine_key, pi.vaccine_name, pi.dose_label, pi.datum, pi.next_due, pi.created_at
    from patient_impfungen pi where pi.patient_id = v_pid order by pi.datum desc;
end;
$$;
grant execute on function public.patient_get_impfungen() to authenticated;

drop function if exists public.patient_set_anamnese(uuid,jsonb);
create or replace function public.patient_set_anamnese(p_data jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_pid uuid;
begin
  v_pid := current_patient_id();
  if v_pid is null then return false; end if;
  update patients set anamnese = p_data where id = v_pid;
  return true;
end;
$$;
grant execute on function public.patient_set_anamnese(jsonb) to authenticated;

drop function if exists public.patient_get_working_hours(uuid);
create or replace function public.patient_get_working_hours()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_patient_id uuid; v_practice_id uuid; v_hours jsonb;
begin
  v_patient_id := current_patient_id();
  if v_patient_id is null then return null; end if;
  select practice_id into v_practice_id from patients where id = v_patient_id;
  select working_hours into v_hours from practices where id = v_practice_id;
  return v_hours;
end;
$$;
grant execute on function public.patient_get_working_hours() to authenticated;

drop function if exists public.patient_request_deletion(uuid);
create or replace function public.patient_request_deletion()
returns table(anonymized_immediately boolean, effective_or_scheduled_date date)
language plpgsql security definer set search_path = public as $$
declare v_pid uuid;
begin
  v_pid := current_patient_id();
  if v_pid is null then raise exception 'invalid_session'; end if;
  return query select * from public._apply_patient_deletion_request(v_pid, null);
end;
$$;
grant execute on function public.patient_request_deletion() to authenticated;

create or replace function public.guardian_get_profile()
returns table(id uuid, username text, name text, full_name text, first_login boolean)
language plpgsql security definer set search_path = public as $$
declare v_gid uuid;
begin
  v_gid := current_guardian_id();
  if v_gid is null then return; end if;
  return query select g.id, g.username, g.name, g.full_name, g.first_login
    from patient_guardians g where g.id = v_gid;
end;
$$;
grant execute on function public.guardian_get_profile() to authenticated;

drop function if exists public.guardian_get_children(uuid);
create or replace function public.guardian_get_children()
returns table(id uuid, username text, name text, full_name text, fach text, dob date)
language plpgsql security definer set search_path = public as $$
declare v_gid uuid;
begin
  v_gid := current_guardian_id();
  if v_gid is null then return; end if;
  return query select p.id, p.username, p.name, p.full_name, p.fach, p.dob
    from patients p where p.guardian_id = v_gid order by p.full_name;
end;
$$;
grant execute on function public.guardian_get_children() to authenticated;

-- Verifies the child actually belongs to this guardian, then records it as
-- the child this guardian's Auth session is now "acting as"
-- (guardian_active_child, phase31) -- everything downstream
-- (patient_get_profile, patient_get_termine, patient_set_anamnese, ...)
-- then works completely unmodified via current_patient_id(), scoped to the
-- child, for as long as this guardian stays signed in.
drop function if exists public.guardian_select_child(uuid,uuid);
create or replace function public.guardian_select_child(p_child_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_gid uuid; v_child patients;
begin
  v_gid := current_guardian_id();
  if v_gid is null then return false; end if;
  select * into v_child from patients where id = p_child_id and guardian_id = v_gid;
  if not found then return false; end if;
  insert into guardian_active_child(auth_user_id, patient_id)
    values (auth.uid(), v_child.id)
    on conflict (auth_user_id) do update set patient_id = excluded.patient_id, updated_at = now();
  return true;
end;
$$;
grant execute on function public.guardian_select_child(uuid) to authenticated;

-- ══════════════════════════════════════════════════════════════
-- Retire the token-based functions these all replace. patient_sessions/
-- guardian_sessions themselves are deliberately left in place (unused,
-- harmless) rather than dropped -- no code reads or writes them anymore
-- after this file, but dropping tables is not something to do in the same
-- breath as a login cutover.
-- ══════════════════════════════════════════════════════════════

drop function if exists public.patient_login(text,text);
drop function if exists public.guardian_login(text,text);
drop function if exists public.patient_change_password(uuid,text);
drop function if exists public.guardian_change_password(uuid,text);
drop function if exists public.patient_logout(uuid);
drop function if exists public.patient_id_from_token(uuid);
drop function if exists public.guardian_id_from_token(uuid);
