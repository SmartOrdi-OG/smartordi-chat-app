-- ══ Give patients and guardians real Supabase Auth, instead of the
-- hand-rolled patient_sessions/guardian_sessions opaque-token mechanism ══
--
-- Every other weakness this project has fixed has been a bug in existing
-- code; this one is a gap in the ARCHITECTURE itself: patients/guardians
-- have never had real Supabase Auth (see phase1_patients_termine_messages.
-- sql's own header comment admitting this was deferred as "too large on
-- its own"). Staff get Supabase Auth's battle-tested password hashing,
-- session JWTs (auto-refreshed, properly expiring), and brute-force
-- protection for free via sb.auth.signInWithPassword() -- patients instead
-- get a bespoke pgcrypto bcrypt implementation plus a from-scratch lockout
-- mechanism (phase14_patient_login_hardening.sql) built specifically to
-- compensate for not having what staff already had from day one.
--
-- This phase only changes WHO/WHAT authenticates a patient/guardian, not
-- how the rest of the app talks to their data: every existing patient_*/
-- guardian_* RPC keeps its SECURITY DEFINER shape and keeps being the only
-- way patient data is ever read/written (RLS on patients/termine/
-- patient_messages/etc. still grants zero direct access to anon/
-- authenticated-as-patient -- unchanged, see phase12_multi_tenant_rls.sql).
-- Only the identity source changes: from a p_token uuid argument resolved
-- via patient_id_from_token(), to auth.uid() resolved via the new
-- current_patient_id() below -- the exact same pattern current_practice_id()
-- (phase12_multi_tenant_rls.sql) already established for staff.
--
-- Since Supabase Auth requires an email (or phone) identifier but patients
-- only ever have a staff-assigned username (delivered via QR code, see
-- secretary.html's createPatientAccount()), each patient/guardian gets a
-- deterministic, NEVER-SHOWN synthetic email built from their own row id
-- (p_<patients.id>@patients.smartordi.internal /
-- g_<patient_guardians.id>@guardians.smartordi.internal) -- the login
-- screen still only ever asks for username + password.
--
-- Run this in the Supabase SQL editor. This file only adds columns/
-- functions -- it does not touch any existing patient_sessions/
-- guardian_sessions data, and does not migrate any existing patient. The
-- actual one-time migration (copying each patient's existing password hash
-- into a real auth.users row) is a separate Edge Function, handed off
-- separately once this SQL has been run.

alter table public.patients add column if not exists auth_user_id uuid unique references auth.users(id);
alter table public.patient_guardians add column if not exists auth_user_id uuid unique references auth.users(id);

-- Tracks which child a guardian's real Supabase Auth session is currently
-- "acting as" -- a guardian's own auth.uid() identifies the GUARDIAN, not a
-- child, so this is the missing link current_patient_id() below needs to
-- resolve a guardian-selected child the same way it resolves a patient
-- logging in directly. No RLS policies at all (same trust boundary as
-- patient_sessions/guardian_sessions today) -- only reachable from inside
-- a SECURITY DEFINER function.
create table public.guardian_active_child (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  updated_at timestamptz not null default now()
);
alter table public.guardian_active_child enable row level security;

-- Resolves the CALLING (real Supabase Auth) patient's own id -- checks a
-- direct patient account first, then falls back to whichever child a
-- guardian has currently selected via guardian_select_child(). Every
-- existing patient_* RPC will call this instead of patient_id_from_token(
-- p_token) going forward (see phase32/phase33 for the actual RPC rewiring
-- -- this file only adds the helper).
create or replace function public.current_patient_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select id from public.patients where auth_user_id = auth.uid()),
    (select patient_id from public.guardian_active_child where auth_user_id = auth.uid())
  );
$$;

-- Resolves the CALLING guardian's own id (distinct from current_patient_id()
-- -- needed by guardian_get_children()/guardian_select_child() themselves,
-- which act on behalf of the GUARDIAN, not a selected child).
create or replace function public.current_guardian_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.patient_guardians where auth_user_id = auth.uid();
$$;
