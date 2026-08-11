-- ══════════════════════════════════════════════════════════════
-- Phase 66: retire the standalone guardian login system (Phase C of the
-- unified-account-profiles work -- phase64/phase65 were Phases A/B)
--
-- Explicit decision (2026-08-11), asked and confirmed before starting:
-- 1) SOFT/SAFE deprecation, not a hard removal. patient_guardians/
--    guardian_sessions/guardian_active_child and every guardian_* RPC
--    (guardian_login_precheck, guardian_get_profile, guardian_get_
--    children, guardian_select_child, guardian_mark_password_changed,
--    current_guardian_id) are UNTOUCHED by this file -- any existing
--    guardian's username/password keeps working exactly as it does today.
--    Nothing here is destructive or hard to reverse.
-- 2) Existing guardian+child links get AUTO-MIGRATED into the unified
--    model (patient_account_profiles, phase64_unified_account_profiles.
--    sql) rather than requiring staff to manually re-link every family
--    through "+ Kind/Erwachsene:n hinzufügen".
--
-- What actually changes: patient-login.html's guardian login now routes
-- through patientGetProfiles()/patientSwitchProfile() -- the exact same
-- RPCs patient.html's own "Meine Profile" card already uses -- instead of
-- the old, guardian-specific child-picker screen, whenever this migration
-- has given it something to find. A guardian whose auth_user_id wasn't
-- set yet at the time this ran (still falls through the "not found" path
-- below) keeps using the old screen unmodified -- nothing breaks for them
-- either; this migration is safe to re-run later once they're picked up.
--
-- No new tables/columns/functions here -- this is a plain, idempotent data
-- migration, not a schema change. Still: run schema_health_check.sql
-- afterward per this repo's standing rule (2026-07-24 incident) -- it
-- won't have anything NEW to check for this file specifically, but it's
-- the same discipline for every SQL file handed over, and it will still
-- catch it if this INSERT itself silently failed to apply.
--
-- Run this in the Supabase SQL editor, after phase64_unified_account_
-- profiles.sql.
-- ══════════════════════════════════════════════════════════════

-- Every child (patients.guardian_id) whose guardian has already completed
-- the real-Supabase-Auth cutover (phase31/33 -- auth_user_id is not null)
-- gets carried over as a 'child' profile linked to that same auth_user_id.
-- patient_account_profiles.patient_id is already UNIQUE, so `on conflict
-- do nothing` makes this safe to run more than once -- e.g. if a
-- guardian's auth_user_id only gets backfilled after this first run, a
-- second run picks up exactly the newly-eligible ones and leaves
-- everything already-migrated untouched.
insert into public.patient_account_profiles (owner_auth_user_id, patient_id, relation)
select g.auth_user_id, p.id, 'child'
from public.patients p
join public.patient_guardians g on g.id = p.guardian_id
where g.auth_user_id is not null
on conflict (patient_id) do nothing;
