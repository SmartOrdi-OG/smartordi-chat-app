-- ══ Harden patient_login: brute-force lockout + temp-password expiry ══
--
-- Security review findings (see TODO.md, launch-readiness roadmap item #3):
--
-- 1. patient_login has NO rate limiting or lockout at all. Unlike staff
--    accounts (real Supabase Auth, which has its own built-in brute-force
--    protection), patient login is a custom anon-callable RPC that just
--    checks a bcrypt hash -- nothing stops repeated password guesses
--    against a known username.
-- 2. A patient's QR first-login link embeds their temp_password as a
--    plaintext URL query parameter (patient-login.html's tryQrLogin()).
--    That credential currently stays valid FOREVER until the patient
--    manually changes their password -- if the QR/link is ever captured
--    (shared, screenshotted, synced to a cloud photo library) before the
--    real patient uses it, there was no time limit on the exposure.
--
-- This phase adds:
-- - failed_login_attempts / locked_until on patients: after 5 wrong
--   passwords in a row, the account is locked for 15 minutes. Resets to 0
--   the moment a fresh temp_password is issued (a password reset is a
--   legitimate new credential, not a further failed attempt).
-- - temp_password_set_at on patients (and patient_join_requests, since
--   both share the same hashing trigger): a temp password that hasn't been
--   changed (first_login still true) stops working after 7 days, bounding
--   how long a leaked QR/link stays exploitable. Once the patient sets
--   their own permanent password (patient_change_password), first_login
--   becomes false and this expiry no longer applies.
--
-- Run this in the Supabase SQL editor.

alter table public.patients add column if not exists failed_login_attempts int not null default 0;
alter table public.patients add column if not exists locked_until timestamptz;
alter table public.patients add column if not exists temp_password_set_at timestamptz;
-- Only needed so the shared hash_patient_password() trigger below can
-- assign these on either table without erroring -- not otherwise used on
-- join requests (they have no login concept of their own).
alter table public.patient_join_requests add column if not exists failed_login_attempts int not null default 0;
alter table public.patient_join_requests add column if not exists locked_until timestamptz;
alter table public.patient_join_requests add column if not exists temp_password_set_at timestamptz;

create or replace function public.hash_patient_password()
returns trigger language plpgsql as $$
begin
  if new.temp_password is not null then
    new.pw_hash := crypt(new.temp_password, gen_salt('bf'));
    new.temp_password := null;
    new.temp_password_set_at := now();
    -- Issuing a fresh credential (new QR, or a staff-triggered password
    -- reset) is a legitimate new start, not a continuation of whatever
    -- lockout state existed before.
    new.failed_login_attempts := 0;
    new.locked_until := null;
  end if;
  return new;
end;
$$;

create or replace function public.patient_login(p_username text, p_password text)
returns table(token uuid, patient_id uuid, full_name text, name text,
              first_login boolean, join_status text, join_note text, anamnese jsonb)
language plpgsql security definer set search_path = public as $$
declare v_patient patients; v_token uuid;
begin
  select * into v_patient from patients where username = lower(p_username);
  if not found then
    return; -- empty result set = invalid credentials, same contract as before
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
    return; -- same empty-result contract for a wrong password, no extra signal leaked
  end if;

  update patients set failed_login_attempts = 0, locked_until = null where id = v_patient.id;

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
