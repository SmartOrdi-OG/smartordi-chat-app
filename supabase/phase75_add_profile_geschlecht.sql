-- ══════════════════════════════════════════════════════════════
-- Phase 75: Geschlecht on "Kind/Erwachsene:n hinzufügen" (add an extra
-- profile onto an existing account)
--
-- Real user feedback (2026-08-19, same day as phase74's Geburtsdatum
-- fix): the "+ Kind hinzufügen" modal still had no way to record the new
-- child's Geschlecht either -- patient-login.html's own self-registration
-- form already asks for it (phase72_patient_geschlecht.sql), and it drives
-- patient.html's symptom-picker body figure auto-selection
-- (renderBodyFigure()) once that child actually uses the app. patient_
-- join_requests.geschlecht already exists (phase72) -- only patient_
-- submit_profile_join_request() itself was never extended to accept it,
-- same gap phase74 just fixed for dob/versicherung.
--
-- secretary.html's approveJoinRequest() needs NO change for this: it
-- already copies req.geschlecht onto the resulting patients row
-- unconditionally (added in phase72, generic across every path that can
-- set patient_join_requests.geschlecht) -- it was just never reachable
-- for this specific path until now.
--
-- Run this in the Supabase SQL editor, after phase74_versicherung_and_
-- add_profile_dob.sql. Then run schema_health_check.sql to confirm it
-- applied cleanly.
-- ══════════════════════════════════════════════════════════════

-- Return type/parameter list is changing again -- has to be dropped first,
-- same reason/pattern as phase74's own change to this function.
-- p_geschlecht defaults to null so this stays callable exactly as before
-- for any caller that doesn't pass it yet.
drop function if exists public.patient_submit_profile_join_request(uuid,text,text,text,text,text,text,date,text);
create or replace function public.patient_submit_profile_join_request(
  p_practice_id uuid, p_vorname text, p_nachname text, p_adresse text, p_svnr text,
  p_relation text, p_relation_label text, p_dob date default null, p_versicherung text default null,
  p_geschlecht text default null
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
  if p_geschlecht is not null and p_geschlecht not in ('m','w','d') then
    raise exception 'invalid_geschlecht';
  end if;
  v_username := 'profil-' || replace(gen_random_uuid()::text, '-', '');
  v_password := encode(gen_random_bytes(24), 'hex');
  insert into public.patient_join_requests(
    username, vorname, nachname, full_name, adresse, svnr, temp_password,
    practice_id, linked_auth_user_id, relation, relation_label, dob, versicherung, geschlecht,
    -- phase68 -- preserved here: without this, "child" additions would
    -- regress back to a missing Impfungen card (is_child defaulting to
    -- false again despite relation='child' being recorded correctly).
    is_child
  ) values (
    v_username, p_vorname, p_nachname, trim(p_vorname || ' ' || p_nachname), p_adresse, p_svnr, v_password,
    p_practice_id, auth.uid(), p_relation, p_relation_label, p_dob, p_versicherung, p_geschlecht,
    (p_relation = 'child')
  ) returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.patient_submit_profile_join_request(uuid,text,text,text,text,text,text,date,text,text) to authenticated;
