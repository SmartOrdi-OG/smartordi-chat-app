-- ══════════════════════════════════════════════════════════════
-- Phase 64: unified account profiles (Phase A of 3 -- SCHEMA/RPC ONLY,
-- no UI wiring yet -- doctor.html/secretary.html/patient.html are
-- UNCHANGED by this file)
--
-- Real request (2026-08-11): a patient wants ONE login (one username/
-- password) that can hold several independent patient profiles under it --
-- e.g. a parent's own profile (their own practice, their own clinical
-- record) plus one or more of their children's profiles (each with their
-- OWN practice, e.g. a paediatric clinic, and their OWN clinical record,
-- with zero data crossover between profiles). Either kind of profile can be
-- the FIRST one an account ever gets (a child can be the original
-- self-registered account, with an adult added onto it later, or an adult
-- can register first and add children onto it afterward) -- there is no
-- fixed "owner" role between profiles, just whichever real Supabase Auth
-- identity (one auth.users row = one login) they all happen to be linked to.
--
-- This deliberately supersedes and will eventually replace the standalone
-- guardian login system (patient_guardians/guardian_sessions/guardian_login,
-- phase28_guardian_child_accounts.sql) -- that system requires a SEPARATE
-- login for whoever manages a child's account, which is exactly what this
-- feature was requested to avoid. phase28/guardian_* are NOT touched or
-- removed by this file -- current_patient_id() below still falls through to
-- guardian_active_child exactly as before, so any already-existing guardian
-- account keeps working unmodified until a later phase migrates/retires it
-- deliberately (see the design discussion this phase came out of -- the
-- guardian system is being retired, not kept alongside this one long-term,
-- but that migration is its own separate phase, not bundled in here).
--
-- ── Design ──
-- `patient_account_profiles` links one auth_user_id (a real login) to
-- every ADDITIONAL patient profile it can act as, beyond whichever single
-- patient row already carries that login directly on patients.auth_user_id
-- (that direct link -- however this account first registered -- keeps
-- working completely unchanged; this table only carries the EXTRA profiles
-- added on top of it). A patient_id can only ever be linked into ONE
-- account (unique constraint) -- a profile cannot be shared between two
-- different logins.
--
-- `patient_active_profile` is an explicit "which profile is this login
-- currently viewing" override, defaulting to nothing (= the account's own
-- direct row) until patient_switch_profile() is actually called. This is
-- the missing piece that makes switching possible at all: current_patient_
-- id()'s OLD coalesce always preferred the caller's own direct patients row
-- first, which meant an account that also happens to own a patients row of
-- its own could NEVER switch into a linked child's profile -- the guardian_
-- active_child fallback only ever fired for an identity with NO direct
-- patients row (a pure standalone guardian). Flipping the coalesce order
-- below (explicit selection wins, own row is only the fallback default) is
-- the actual fix -- and is fully backward compatible: an account that never
-- calls patient_switch_profile() has an empty patient_active_profile row,
-- so coalesce() falls straight through to the exact same "own direct row"
-- resolution every existing patient already gets today.
--
-- ── What this file deliberately does NOT do yet (later phases) ──
-- - No UI anywhere calls any of this yet.
-- - No RPC here actually CREATES a child/adult's patients row -- that still
--   goes through the existing join-request + secretary-approval flow
--   (patient_join_requests, secretary.html's approveJoinRequest()) exactly
--   as it does for any new patient today, per an explicit decision: adding
--   a profile to an existing account must not skip the practice's own
--   review of a new patient, the same way self-registration doesn't skip
--   it. This file only adds the metadata (linked_auth_user_id/relation/
--   relation_label columns) a join request needs to carry that context, and
--   staff_link_account_profile() to perform the actual linking once staff
--   have approved it -- wiring approveJoinRequest() to call it is a later
--   phase's job, once the "Kind/Erwachsene:n hinzufügen" UI exists to
--   submit these requests in the first place.
--
-- Run this in the Supabase SQL editor, after phase31_patient_auth.sql
-- (current_patient_id()/current_guardian_id()) and phase19_patient_join_
-- requests_rls.sql. Then run schema_health_check.sql to confirm it applied
-- cleanly -- see this migration's own accompanying chat message for why
-- that check matters (a real 2026-07-24 incident: a migration silently
-- never fully applied and a later change assumed it had).
-- ══════════════════════════════════════════════════════════════

-- ── patient_account_profiles ──
create table public.patient_account_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_auth_user_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid not null unique references public.patients(id) on delete cascade,
  relation text not null check (relation in ('child','father','mother','other')),
  relation_label text,     -- free text, only meaningful when relation = 'other'
  created_at timestamptz not null default now()
);
alter table public.patient_account_profiles enable row level security;
-- Deliberately no RLS policies at all -- same trust boundary as patient_
-- sessions/guardian_sessions/guardian_active_child already established:
-- anon/authenticated get zero direct REST access (RLS enabled + no policy
-- = deny-all for those roles), only the SECURITY DEFINER functions below
-- (owned by postgres, which bypasses RLS) can read/write this table.
create index if not exists patient_account_profiles_owner_idx on public.patient_account_profiles(owner_auth_user_id);

-- ── patient_active_profile ──
create table public.patient_active_profile (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  updated_at timestamptz not null default now()
);
alter table public.patient_active_profile enable row level security;
-- Same "no policies, SECURITY DEFINER-only" trust boundary as above.

-- ── current_patient_id(): explicit active-profile selection now wins,
-- own direct row is the fallback default (was the ONLY resolution before),
-- guardian_active_child stays as the last fallback for the still-live
-- standalone guardian system (phase28) -- see header comment. ──
create or replace function public.current_patient_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select patient_id from public.patient_active_profile where auth_user_id = auth.uid()),
    (select id from public.patients where auth_user_id = auth.uid()),
    (select patient_id from public.guardian_active_child where auth_user_id = auth.uid())
  );
$$;

-- Every profile this login can act as: its own direct patients row (if it
-- has one) plus every row linked to it in patient_account_profiles.
-- is_active flags whichever one current_patient_id() currently resolves
-- to, so the UI can highlight it without a second round-trip.
create or replace function public.patient_get_profiles()
returns table(patient_id uuid, full_name text, relation text, relation_label text,
              practice_id uuid, practice_name text, is_active boolean)
language sql stable security definer set search_path = public as $$
  select * from (
    select p.id as patient_id, p.full_name, 'self'::text as relation, null::text as relation_label,
           p.practice_id, pr.name as practice_name, (p.id = public.current_patient_id()) as is_active
    from public.patients p
    left join public.practices pr on pr.id = p.practice_id
    where p.auth_user_id = auth.uid()
    union all
    select p.id, p.full_name, pap.relation, pap.relation_label,
           p.practice_id, pr.name, (p.id = public.current_patient_id())
    from public.patient_account_profiles pap
    join public.patients p on p.id = pap.patient_id
    left join public.practices pr on pr.id = p.practice_id
    where pap.owner_auth_user_id = auth.uid()
  ) profiles
  order by (relation <> 'self'), full_name;
$$;
grant execute on function public.patient_get_profiles() to authenticated;

-- Switches which profile current_patient_id() resolves to for THIS login,
-- for every subsequent patient_*/RPC call this session makes -- but only
-- ever to a profile this login is actually allowed to act as (its own
-- direct row, or one explicitly linked to it in patient_account_profiles).
-- This ownership check is the one thing standing between "a family
-- switching between their own linked profiles" and "any patient reading
-- any other patient's entire medical record by guessing a uuid" -- it is
-- the single most safety-critical line in this whole file.
create or replace function public.patient_switch_profile(p_patient_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_allowed boolean;
begin
  select exists(
    select 1 from public.patients where id = p_patient_id and auth_user_id = auth.uid()
    union all
    select 1 from public.patient_account_profiles where patient_id = p_patient_id and owner_auth_user_id = auth.uid()
  ) into v_allowed;
  if not v_allowed then
    return false;
  end if;
  insert into public.patient_active_profile(auth_user_id, patient_id)
    values (auth.uid(), p_patient_id)
    on conflict (auth_user_id) do update set patient_id = excluded.patient_id, updated_at = now();
  return true;
end;
$$;
grant execute on function public.patient_switch_profile(uuid) to authenticated;

-- ── patient_join_requests: carry "which existing account is this profile
-- being added to" through the review process, alongside the family
-- relationship (needed for both the "add a child" and "add an adult"
-- cases -- an adult profile being added onto an existing account goes
-- through this exact same review path, not a shortcut, per an explicit
-- decision). All three columns stay null for an ordinary, brand-new self-
-- registration (today's only case) -- nothing about the existing flow
-- changes for it. ──
alter table public.patient_join_requests add column if not exists linked_auth_user_id uuid references auth.users(id);
alter table public.patient_join_requests add column if not exists relation text check (relation in ('child','father','mother','other'));
alter table public.patient_join_requests add column if not exists relation_label text;

-- Submits a request to add a profile onto the CALLER's own existing
-- account/login -- distinct from patient-login.html's anon self-
-- registration submission (performJoinRequestSubmit()), which stays
-- completely unchanged and is still how a brand-new account's very first
-- profile gets created. This one requires an existing authenticated
-- session (auth.uid() must already resolve to a real login) and always
-- stamps linked_auth_user_id from that session server-side -- never a
-- client-supplied value, so one account can never submit a request that
-- silently attaches to a DIFFERENT account.
--
-- username/temp_password below are unusable, system-generated placeholders
-- -- a profile added this way is only ever reached by switching from the
-- caller's own existing login (patient_switch_profile()), it never gets
-- separate credentials of its own. These only exist to satisfy patient_
-- join_requests' existing column shape (shared with real self-registration
-- rows further up); their values are never shown to anyone and are not
-- usable to log in with on their own.
create or replace function public.patient_submit_profile_join_request(
  p_practice_id uuid, p_vorname text, p_nachname text, p_adresse text, p_svnr text,
  p_relation text, p_relation_label text
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_username text; v_password text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if p_relation not in ('child','father','mother','other') then
    raise exception 'invalid_relation';
  end if;
  v_username := 'profil-' || replace(gen_random_uuid()::text, '-', '');
  v_password := encode(gen_random_bytes(24), 'hex');
  insert into public.patient_join_requests(
    username, vorname, nachname, full_name, adresse, svnr, temp_password,
    practice_id, linked_auth_user_id, relation, relation_label
  ) values (
    v_username, p_vorname, p_nachname, trim(p_vorname || ' ' || p_nachname), p_adresse, p_svnr, v_password,
    p_practice_id, auth.uid(), p_relation, p_relation_label
  ) returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.patient_submit_profile_join_request(uuid,text,text,text,text,text,text) to authenticated;

-- Staff-side: links an APPROVED "add profile" join request's resulting
-- patients row into the requesting account's patient_account_profiles. The
-- patients row itself is still created the exact same way any approved join
-- request's patients row is created today, via secretary.html's existing
-- upsertPatientIdentity() (matched by username) -- this function only
-- performs the linking step on top of that, once a later phase wires the
-- two together. Deliberately takes ONLY the join request id, not a separate
-- patient id argument: resolving the patient internally (by this exact
-- request's own username, the same key upsertPatientIdentity() already
-- provisions it under) instead of trusting a second, independently-supplied
-- uuid closes off an entire class of mistake -- a caller-supplied patient id
-- would have let staff link ANY existing patient (even one from an
-- unrelated request, or in principle a different patient entirely) into
-- someone else's account with no cross-check at all.
--
-- Scoped to the staff member's own practice (a request submitted to
-- Practice A can only ever be linked by Practice A's own staff, never
-- another practice reading/guessing another practice's request id) and
-- requires the request to actually be an "add to existing account" one
-- (linked_auth_user_id not null) that has already been approved -- linking
-- never bypasses the same review step every other new patient goes through.
create or replace function public.staff_link_account_profile(p_join_request_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_req public.patient_join_requests; v_patient_id uuid;
begin
  select * into v_req from public.patient_join_requests where id = p_join_request_id;
  if not found then return false; end if;
  if v_req.practice_id is distinct from public.current_practice_id() then
    return false;
  end if;
  if v_req.linked_auth_user_id is null then
    return false;
  end if;
  if v_req.status <> 'approved' then
    return false;
  end if;
  select id into v_patient_id from public.patients
    where username = v_req.username and practice_id = v_req.practice_id;
  if v_patient_id is null then
    return false; -- approved, but the patients row hasn't been provisioned yet -- caller should retry after upsertPatientIdentity() runs
  end if;
  insert into public.patient_account_profiles(owner_auth_user_id, patient_id, relation, relation_label)
    values (v_req.linked_auth_user_id, v_patient_id, v_req.relation, v_req.relation_label)
  on conflict (patient_id) do nothing;
  return true;
end;
$$;
grant execute on function public.staff_link_account_profile(uuid) to authenticated;
