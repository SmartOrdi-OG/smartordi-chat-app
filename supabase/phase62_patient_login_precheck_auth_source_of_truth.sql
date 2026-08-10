-- ══════════════════════════════════════════════════════════════
-- Phase 62: patient_login_precheck()/guardian_login_precheck() were
-- checking a password against the WRONG, permanently-stale column --
-- every patient/guardian who ever changed their own password got locked
-- out of every fresh login (new device, new browser, incognito, after
-- their existing session token eventually expired) with a generic "wrong
-- password", even though the password they typed was correct.
--
-- Real report, reproduced live: a patient set their own password on first
-- login, kept working fine in the SAME already-signed-in tab (chat sent
-- and received normally), but a fresh incognito login with the exact same
-- new username/password failed with "wrong password" -- twice in a row,
-- even after deliberately changing the password again.
--
-- Root cause: since phase33_patient_login_cutover.sql, patients.pw_hash
-- and the patient's REAL Supabase Auth password (auth.users.
-- encrypted_password) are two entirely separate values that are only
-- EVER kept in sync at account-creation time (create-patient-auth-user /
-- migrate-patients-to-auth) and on a STAFF-initiated reset
-- (resetPatientPassword() in secretary.html explicitly updates both --
-- see ensurePatientAuthUser() alongside the temp_password trigger). But
-- patientChangePassword()/guardianChangePassword() (vendor/patient-
-- portal-data.js) -- the normal, expected "set your own password" flow
-- every patient goes through on first login -- only ever calls
-- sb.auth.updateUser({password}), which updates auth.users alone.
-- patients.pw_hash is left holding the OLD (often just-expired temp)
-- password's hash forever after that.
--
-- patient_login_precheck() independently re-verified the password against
-- that now-permanently-stale patients.pw_hash BEFORE ever attempting the
-- real sb.auth.signInWithPassword() call -- so a patient's brand new,
-- correct password gets rejected at this precheck stage on every single
-- login from a session that doesn't already have a live Auth token
-- cached (i.e. every fresh device/browser, or any session after the
-- existing one's JWT eventually expires). This affects every patient/
-- guardian who has ever used the ordinary "change your password" screen,
-- likely close to all of them.
--
-- Fix: verify against auth.users.encrypted_password (the one value
-- sb.auth.signInWithPassword() itself actually trusts) instead of
-- patients.pw_hash/patient_guardians.pw_hash. Same bcrypt format, same
-- crypt()-based verification, same fail-closed/lockout/temp-password-
-- expiry behavior otherwise -- see phase32_auth_password_hash_helper.sql's
-- own comment confirming GoTrue and this project's pgcrypto hashing share
-- the same bcrypt format, which is exactly why this comparison is valid.
-- This also retroactively un-sticks every ALREADY-affected account with
-- zero data migration needed, since auth.users already holds each
-- patient's real, current password -- pw_hash was simply never the
-- right thing to check in the first place, post phase33.
--
-- Run this in the Supabase SQL editor for this project
-- (https://ewilgwndhpxibkogxqbk.supabase.co), after phase61.
-- ══════════════════════════════════════════════════════════════

create or replace function public.patient_login_precheck(p_username text, p_password text)
returns text
language plpgsql security definer set search_path = public as $$
declare v_patient patients; v_encrypted_password text;
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

  if v_patient.auth_user_id is null then
    -- No real Auth user linked yet -- nothing to verify the password
    -- against. Same fail-closed contract as before.
    return null;
  end if;

  select encrypted_password into v_encrypted_password from auth.users where id = v_patient.auth_user_id;

  if v_encrypted_password is null or crypt(p_password, v_encrypted_password) <> v_encrypted_password then
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
  -- email for an account that doesn't have real access yet.
  if v_patient.join_status <> 'approved' then
    return null;
  end if;

  return 'p_' || v_patient.id::text || '@patients.smartordi.internal';
end;
$$;
grant execute on function public.patient_login_precheck(text,text) to anon, authenticated;

create or replace function public.guardian_login_precheck(p_username text, p_password text)
returns text
language plpgsql security definer set search_path = public as $$
declare v_g patient_guardians; v_encrypted_password text;
begin
  select * into v_g from patient_guardians where username = lower(p_username);
  if not found or v_g.auth_user_id is null then
    return null;
  end if;

  select encrypted_password into v_encrypted_password from auth.users where id = v_g.auth_user_id;

  if v_encrypted_password is null or crypt(p_password, v_encrypted_password) <> v_encrypted_password then
    return null;
  end if;

  return 'g_' || v_g.id::text || '@guardians.smartordi.internal';
end;
$$;
grant execute on function public.guardian_login_precheck(text,text) to anon, authenticated;
