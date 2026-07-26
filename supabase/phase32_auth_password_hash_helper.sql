-- ══ Small helper for the real patient/guardian Auth migration (phase31) ══
--
-- Two places need to plant an EXISTING bcrypt hash (already computed by
-- the hash_patient_password() trigger, from either a staff-set
-- temp_password or a patient's own self-chosen password at signup)
-- directly into Supabase Auth's own auth.users.encrypted_password, instead
-- of setting a brand-new plaintext password: (1) approveJoinRequest() in
-- secretary.html, when a patient self-registered from their own device --
-- this device never sees their plaintext password, only patient_
-- join_requests.pw_hash; and (2) the one-time bulk migration for existing
-- patients (see the create-patient-auth-user / migrate-patients-to-auth
-- Edge Functions), which must preserve everyone's current password rather
-- than forcing a reset. auth.users isn't exposed through PostgREST, and
-- Supabase's Admin API (auth.admin.createUser/updateUserById) only ever
-- accepts a plaintext password it hashes itself -- there is no Admin API
-- call that accepts an already-hashed value. Both GoTrue and this
-- project's own pgcrypto hashing use the same bcrypt format, so copying
-- the hash directly is safe and well-precedented (the same technique
-- community Supabase migration guides use for importing users from
-- another system's existing bcrypt hashes).
--
-- Run this in the Supabase SQL editor, after phase31_patient_auth.sql.

create or replace function public._set_auth_password_hash(p_auth_user_id uuid, p_hash text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update auth.users set encrypted_password = p_hash, updated_at = now() where id = p_auth_user_id;
end;
$$;
-- Internal only -- called exclusively from the create-patient-auth-user/
-- migrate-patients-to-auth Edge Functions via the service-role key, never
-- from a patient/staff browser session directly.
revoke all on function public._set_auth_password_hash(uuid, text) from public, anon, authenticated;
