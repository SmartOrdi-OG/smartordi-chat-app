-- ══════════════════════════════════════════════════════════════
-- Phase 74: Versicherung on self-registration + Geburtsdatum on
-- "Kind/Erwachsene:n hinzufügen" (add an extra profile onto an existing
-- account)
--
-- Real user feedback (2026-08-19, with a screenshot of the "+ Kind
-- hinzufügen" modal): two gaps found while testing the children-account
-- feature live:
-- 1) patient.html's "Kind/Erwachsene:n hinzufügen" modal (supabase/
--    phase64_unified_account_profiles.sql's patient_submit_profile_join_
--    request()) never asked for the new profile's Geburtsdatum at all --
--    there was nowhere for the value to even go. Every OTHER path that
--    creates a patients row (self-registration, secretary.html's "+ Neuer
--    Patient") already requires it.
-- 2) The main self-registration form (patient-login.html's "Anmeldung
--    beantragen"/screen-request) never asked for a Versicherung
--    (insurance provider) either -- secretary.html's own "+ Neuer
--    Patient" already has this as a dropdown (ÖGK/BVAEB/SVS/Andere,
--    Austria's real statutory funds); self-registration had no way to
--    supply it at all, so it stayed empty ("—") until staff filled it in
--    by hand later.
--
-- This adds the two missing patient_join_requests columns (dob already
-- exists there since phase67 -- only patient_submit_profile_join_request()
-- itself was never extended to accept/store it). The app-side change
-- (adding the two new inputs, matching secretary.html's exact ÖGK/BVAEB/
-- SVS/Andere option set for Versicherung) ships alongside this file.
--
-- This redefinition also carries forward phase68_fix_add_profile_is_child.
-- sql's is_child write (p_relation = 'child') -- dropped/recreating this
-- function must never silently lose that fix.
--
-- Run this in the Supabase SQL editor, after phase64_unified_account_
-- profiles.sql, phase67_join_request_dob_tel_required.sql, and
-- phase68_fix_add_profile_is_child.sql. Then run schema_health_check.sql
-- to confirm it applied cleanly.
-- ══════════════════════════════════════════════════════════════

alter table public.patient_join_requests add column if not exists versicherung text;

-- Return type/parameter list is changing -- has to be dropped first, same
-- reason/pattern as phase65/phase72's own patient_get_profile() changes.
-- p_dob/p_versicherung default to null so this stays callable exactly as
-- before for any caller that doesn't pass them yet.
drop function if exists public.patient_submit_profile_join_request(uuid,text,text,text,text,text,text);
create or replace function public.patient_submit_profile_join_request(
  p_practice_id uuid, p_vorname text, p_nachname text, p_adresse text, p_svnr text,
  p_relation text, p_relation_label text, p_dob date default null, p_versicherung text default null
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
    practice_id, linked_auth_user_id, relation, relation_label, dob, versicherung,
    -- phase68 -- preserved here: without this, "child" additions would
    -- regress back to a missing Impfungen card (is_child defaulting to
    -- false again despite relation='child' being recorded correctly).
    is_child
  ) values (
    v_username, p_vorname, p_nachname, trim(p_vorname || ' ' || p_nachname), p_adresse, p_svnr, v_password,
    p_practice_id, auth.uid(), p_relation, p_relation_label, p_dob, p_versicherung,
    (p_relation = 'child')
  ) returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.patient_submit_profile_join_request(uuid,text,text,text,text,text,text,date,text) to authenticated;
