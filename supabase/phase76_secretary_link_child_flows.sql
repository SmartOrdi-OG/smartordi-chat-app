-- Phase 76: secretary.html's "+ Neuer Patient" -> "Kind" gets a second
-- choice ("Weiteres Kind (bestehendes Kinder-Konto)") for the walk-in
-- scenario staff actually deals with: a parent standing at the desk with a
-- second/third child whose SIBLING already has an account in this practice.
-- Staff links the new child directly onto that existing login themselves,
-- no QR/scan/approval round-trip needed (staff has already reviewed
-- everything in person).
--
-- Real user request (2026-08-19), verbatim design:
--   1. "أول طفل" (first child): unchanged account-creation mechanics --
--      still createPatientAccount()'s existing QR/first-login pipeline
--      (secretary.html), needs NO new SQL at all. Only patient-login.html's
--      first-login screen copy/behavior changes for an is_child account
--      (leaves the username blank + mandatory instead of pre-filled +
--      optional, so the parent picks BOTH themselves) -- pure front-end,
--      see that file's own comments.
--   2. "طفل على حساب موجود" (child on an existing account): staff searches
--      for the first child's account and links the new child straight onto
--      it. THIS is what needs the new RPC below -- patient_account_profiles
--      (phase64) has no RLS policies at all (SECURITY DEFINER-only, same
--      trust boundary as every other table in that migration), so a
--      staff-initiated insert into it can only ever happen through a
--      function like staff_link_account_profile() -- but that one requires
--      a patient_join_requests row to already exist (the self-service "Kind/
--      Erwachsene:n hinzufügen" shape), which this staff-initiated walk-in
--      flow never creates. staff_add_linked_child() below takes the owner
--      and new-patient ids directly instead.
--   3. A parent adding a sibling THEMSELVES (from their own device) still
--      goes through patient.html's own "+ Kind hinzufügen" QR-scan flow,
--      completely unchanged by this file.
--
-- Run this in the Supabase SQL editor for this project
-- (https://ewilgwndhpxibkogxqbk.supabase.co). Then run
-- supabase/schema_health_check.sql to confirm it applied cleanly -- see
-- that file's own header for why this check matters (a real 2026-07-24
-- incident: a migration silently never fully applied, and a later
-- unrelated change assumed it had).
-- ══════════════════════════════════════════════════════════════

create or replace function public.staff_add_linked_child(
  p_owner_patient_id uuid, p_new_patient_id uuid,
  p_relation text default 'child', p_relation_label text default null
)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_owner_auth uuid; v_owner_practice uuid; v_new_practice uuid;
begin
  if p_relation not in ('child','father','mother','other') then
    raise exception 'invalid_relation';
  end if;
  select auth_user_id, practice_id into v_owner_auth, v_owner_practice
    from public.patients where id = p_owner_patient_id;
  -- Every patient row created through this app's own flows already gets a
  -- real Supabase Auth account (createPatientAccount()/approveJoinRequest()/
  -- etc. all call ensurePatientAuthUser()) -- a null here means the "owner"
  -- id doesn't actually resolve to a loggable-in account at all, so there
  -- would be nothing to link the new child onto.
  if v_owner_auth is null then
    raise exception 'owner_has_no_login';
  end if;
  -- current_practice_id() (phase12) resolves the CALLING staff member's own
  -- practice -- both the owner and the new child must belong to it, same
  -- cross-tenant isolation every other staff-facing RPC in this project
  -- enforces (see schema_health_check.sql's own "RLS actually scopes
  -- access" section).
  if v_owner_practice is distinct from public.current_practice_id() then
    return false;
  end if;
  select practice_id into v_new_practice from public.patients where id = p_new_patient_id;
  if v_new_practice is distinct from public.current_practice_id() then
    return false;
  end if;
  insert into public.patient_account_profiles(owner_auth_user_id, patient_id, relation, relation_label)
    values (v_owner_auth, p_new_patient_id, p_relation, p_relation_label)
  on conflict (patient_id) do nothing;
  return true;
end;
$$;
grant execute on function public.staff_add_linked_child(uuid,uuid,text,text) to authenticated;
