-- Phase 77: fixes a real bug in phase76's staff_add_linked_child() -- found
-- live (2026-08-19) the same day it shipped: secretary.html's "Weiteres
-- Kind" owner-search deliberately lists ANY existing children's-account
-- patient (see that search's own comment: "the first child's account"),
-- which can legitimately be either the account's ROOT/direct profile (e.g.
-- "Abdullah", whose own patients.auth_user_id IS the real login every
-- session actually authenticates as) OR an already-LINKED sibling profile
-- (e.g. "Omar", added earlier onto Abdullah's account) -- a linked
-- profile's own patients.auth_user_id is a real Supabase Auth user too
-- (ensurePatientAuthUser() provisions one for every patient row, to keep
-- the "every row has an auth account" invariant intact -- see phase76's own
-- comment), but it's a PHANTOM one nobody ever actually signs in with.
--
-- Real report: staff picked "Omar" (a linked sibling) as the owner for a
-- third child ("Ali") -- staff_add_linked_child() linked Ali to Omar's own
-- (unused) auth_user_id instead of the account's real root login (Abdullah's).
-- Ali's patients row and the patient_account_profiles link were both created
-- successfully (no error anywhere), but patient_get_profiles() -- which
-- filters strictly by `pap.owner_auth_user_id = auth.uid()` -- never surfaces
-- Ali when the family actually logs in, since their real session's auth.uid()
-- is always Abdullah's, never Omar's dormant one. Confirmed directly against
-- production data before writing this fix.
--
-- Fix: if the picked "owner" patient is ITSELF already a linked profile
-- (has its own row in patient_account_profiles as patient_id), resolve to
-- THAT link's owner_auth_user_id instead of the picked patient's own -- same
-- transitive-to-the-real-root resolution, regardless of which sibling staff
-- happened to search for.
--
-- Run this in the Supabase SQL editor for this project
-- (https://ewilgwndhpxibkogxqbk.supabase.co). Then run
-- supabase/schema_health_check.sql to confirm it applied cleanly.
-- ══════════════════════════════════════════════════════════════

create or replace function public.staff_add_linked_child(
  p_owner_patient_id uuid, p_new_patient_id uuid,
  p_relation text default 'child', p_relation_label text default null
)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_owner_auth uuid; v_owner_practice uuid; v_new_practice uuid; v_root_owner_auth uuid;
begin
  if p_relation not in ('child','father','mother','other') then
    raise exception 'invalid_relation';
  end if;
  select auth_user_id, practice_id into v_owner_auth, v_owner_practice
    from public.patients where id = p_owner_patient_id;
  if v_owner_auth is null then
    raise exception 'owner_has_no_login';
  end if;
  -- The picked "owner" patient might itself be an already-linked sibling
  -- (not the account's root/direct profile) -- follow that link to the real
  -- login instead of this patient's own dormant auth_user_id.
  select owner_auth_user_id into v_root_owner_auth
    from public.patient_account_profiles where patient_id = p_owner_patient_id;
  if v_root_owner_auth is not null then
    v_owner_auth := v_root_owner_auth;
  end if;
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

-- Repair any row this bug already produced (e.g. "Ali Elsayed", linked to
-- "Omar"'s dormant auth_user_id instead of the family's real login) -- same
-- transitive resolution as the fixed function above, applied once by hand
-- since the function fix alone doesn't touch already-written rows. Matches
-- a row whose owner_auth_user_id happens to equal some OTHER patient's own
-- (dormant) auth_user_id, where that other patient is itself already a
-- linked (non-root) profile -- and re-points it at that link's real root
-- owner instead. A row already linked to a real root account never matches
-- (a root account's own patient row never appears as patient_id in this
-- table in the first place), so this is a no-op for every already-correct
-- row.
update public.patient_account_profiles pap
set owner_auth_user_id = root.owner_auth_user_id
from public.patients p
join public.patient_account_profiles root on root.patient_id = p.id
where pap.owner_auth_user_id = p.auth_user_id
  and p.id <> pap.patient_id;
