-- ══ GDPR/DSGVO follow-up: let the patient themselves request erasure,
-- not just staff ══
--
-- phase17_data_retention.sql already built the hard part -- reconciling
-- Art. 17 DSGVO (right to erasure) with the 10-year statutory retention
-- (§ 51 ÄrzteG) -- but only exposed it via request_patient_deletion(uuid),
-- an RPC gated to `authenticated` (staff) and authorized via
-- current_practice_id(). A patient has no Supabase Auth session at all
-- (see patient_sessions/patient_id_from_token(), used by every other
-- patient-facing RPC), so that function is unusable from patient.html:
-- current_practice_id() would resolve to null for an anon caller and the
-- practice_id ownership check would always fail closed.
--
-- This extracts the actual retention-reconciliation logic (compute last
-- treatment date, anonymize immediately or schedule the legal cutoff)
-- into a shared internal function, then adds a second, patient-facing
-- entry point that authorizes via the patient's own session token instead
-- of current_practice_id() -- same SECURITY DEFINER + token-resolution
-- pattern as patient_login/patient_get_profile/etc. Both entry points now
-- call the same underlying logic, so the legal behavior (immediate vs.
-- scheduled) is identical no matter who asks.
--
-- Run this in the Supabase SQL editor, after phase17_data_retention.sql.

-- ── shared core: no authorization inside -- callers must resolve/verify
-- the patient_id themselves first. p_requested_by is the staff member's
-- auth.uid() when a staff member initiated it, or null for a patient's
-- own request (there's no staff member to attribute it to). ──
create or replace function public._apply_patient_deletion_request(p_patient_id uuid, p_requested_by uuid default null)
returns table(anonymized_immediately boolean, effective_or_scheduled_date date)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_last_date date;
  v_created date;
  v_cutoff date;
begin
  select created_at::date into v_created from public.patients where id = p_patient_id;
  select max(date) into v_last_date from public.termine where patient_id = p_patient_id and status <> 'abgesagt';
  v_last_date := greatest(coalesce(v_last_date, v_created), v_created);
  v_cutoff := v_last_date + interval '10 years';

  if v_cutoff <= current_date then
    perform public.anonymize_patient(p_patient_id);
    return query select true, current_date;
  else
    update public.patients set
      retention_status = 'deletion_scheduled',
      deletion_requested_at = now(),
      deletion_requested_by = p_requested_by,
      scheduled_deletion_date = v_cutoff
    where id = p_patient_id;
    return query select false, v_cutoff;
  end if;
end;
$function$;
revoke all on function public._apply_patient_deletion_request(uuid, uuid) from public, anon, authenticated;

-- ── staff-facing entry point (existing, now delegates to the shared core
-- instead of duplicating it) -- unchanged behavior/signature. ──
create or replace function public.request_patient_deletion(p_patient_id uuid)
returns table(anonymized_immediately boolean, effective_or_scheduled_date date)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (
    select 1 from public.patients
    where id = p_patient_id and practice_id = public.current_practice_id()
  ) then
    raise exception 'not_found_or_forbidden';
  end if;
  return query select * from public._apply_patient_deletion_request(p_patient_id, auth.uid());
end;
$function$;
grant execute on function public.request_patient_deletion(uuid) to authenticated;

-- ── NEW: patient-facing entry point. Authorizes via the patient's own
-- opaque session token (same as every other patient_* RPC) instead of
-- current_practice_id() -- a patient's token can only ever resolve to
-- their OWN patient_id, so no separate ownership check is needed. ──
create or replace function public.patient_request_deletion(p_token uuid)
returns table(anonymized_immediately boolean, effective_or_scheduled_date date)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_patient_id uuid;
begin
  v_patient_id := public.patient_id_from_token(p_token);
  if v_patient_id is null then
    raise exception 'invalid_session';
  end if;
  return query select * from public._apply_patient_deletion_request(v_patient_id, null);
end;
$function$;
grant execute on function public.patient_request_deletion(uuid) to anon, authenticated;
