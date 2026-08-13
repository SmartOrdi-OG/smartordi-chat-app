-- ══════════════════════════════════════════════════════════════
-- Phase 68: fix is_child never being set on the "+ Kind/Erwachsene:n
-- hinzufügen" (add-profile) request path
--
-- Real user feedback (2026-08-12): a child added via patient.html's own
-- "+ Kind hinzufügen" button (relation='child') showed up with the
-- Impfungen card missing entirely once phase67's adult-hiding logic
-- shipped -- exactly the same as a real adult with no vaccination
-- records. Root cause: patient_submit_profile_join_request() (phase64)
-- never wrote is_child onto the patient_join_requests row it creates --
-- only patient-login.html's own self-registration "Für mich / Für mein
-- Kind" toggle (phase65) ever set it. secretary.html's approveJoinRequest()
-- always did carry req.is_child through correctly; it just never had a
-- true value to carry for THIS path, so every child added this way ended
-- up with patients.is_child = false (the column's default), even though
-- their relation was correctly recorded as 'child' the whole time.
--
-- This redefines patient_submit_profile_join_request() to set is_child
-- from the same p_relation the caller already sends, and backfills every
-- ALREADY-approved patient whose linked profile relation says 'child' but
-- whose own is_child flag never caught up.
--
-- Run this in the Supabase SQL editor, after phase65_patient_username_
-- change_and_is_child.sql. Then run schema_health_check.sql to confirm it
-- applied cleanly.
-- ══════════════════════════════════════════════════════════════

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
    practice_id, linked_auth_user_id, relation, relation_label, is_child
  ) values (
    v_username, p_vorname, p_nachname, trim(p_vorname || ' ' || p_nachname), p_adresse, p_svnr, v_password,
    p_practice_id, auth.uid(), p_relation, p_relation_label, (p_relation = 'child')
  ) returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.patient_submit_profile_join_request(uuid,text,text,text,text,text,text) to authenticated;

-- Backfill: any patient already linked into someone's account as a "child"
-- relation, whose own is_child flag never got set (because it was added
-- before this fix).
update public.patients p
set is_child = true
from public.patient_account_profiles ap
where ap.patient_id = p.id
  and ap.relation = 'child'
  and p.is_child = false;
