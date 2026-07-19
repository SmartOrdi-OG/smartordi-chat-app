-- ══ GDPR/DSGVO item 4 (part 2): right to erasure reconciled with the
-- 10-year statutory retention (§ 51 ÄrzteG, researched earlier this
-- session) ══
--
-- Art. 17 DSGVO gives patients a right to erasure, but Art. 17(3)(b)
-- explicitly carves out an exception "for compliance with a legal
-- obligation" -- and Austrian doctors are legally required to keep patient
-- records for at least 10 years after the last treatment. So "delete my
-- data" can't simply run a DELETE the moment it's asked for; it has to:
--   - anonymize immediately if the 10-year clock has already run out, or
--   - schedule the anonymization for the exact date it runs out, and tell
--     the requester that date and why (the legal reason), rather than
--     silently refusing or silently deleting early.
--
-- "Last treatment" is approximated as the most recent non-cancelled
-- Termin date for that patient (falling back to account-creation date for
-- a patient who was never actually seen) -- there's no finer-grained
-- "treatment completed" flag in this schema, and this is a reasonable,
-- defensible proxy: the retention clock starts from the last actual
-- contact.
--
-- Anonymization deletes the patient's messages/documents/vaccination and
-- exam records outright (that IS the personal/health data DSGVO wants
-- erased), scrubs identifying fields on their own patients row and on
-- their termine rows, but deliberately does NOT touch audit_log: those
-- rows exist specifically for accountability/breach-investigation
-- purposes (Art. 5(2) DSGVO, see phase16) and keeping a historical trail
-- of what a row looked like before it was corrected/erased is itself a
-- recognized legitimate-interest/legal-defense basis. Revisit this
-- specific point with real legal counsel before relying on it commercially.
--
-- Run this in the Supabase SQL editor, after phase16_audit_log.sql.

alter table public.patients add column if not exists retention_status text not null default 'active' check (retention_status in ('active','deletion_scheduled','anonymized'));
alter table public.patients add column if not exists deletion_requested_at timestamptz;
alter table public.patients add column if not exists deletion_requested_by uuid references public.staff_profiles(id);
alter table public.patients add column if not exists scheduled_deletion_date date;

-- ── internal: does the actual scrubbing. Not directly callable by staff
-- or patients -- only from request_patient_deletion()/
-- run_scheduled_patient_deletions() below, same "revoke from
-- public/anon/authenticated" pattern already used for
-- patient_id_from_token(). ──
create or replace function public.anonymize_patient(p_patient_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  delete from public.patient_messages where patient_id = p_patient_id;
  delete from public.patient_documents where patient_id = p_patient_id;
  delete from public.mkp_untersuchungen where patient_id = p_patient_id;
  delete from public.patient_impfungen where patient_id = p_patient_id;
  delete from public.patient_sessions where patient_id = p_patient_id;

  update public.termine set
    patient_name = 'Gelöscht (DSGVO)', reason = null, reason_note = null,
    versicherung = null, tel = null, svnr = null, dob = null
  where patient_id = p_patient_id;

  update public.patients set
    username = 'deleted_' || p_patient_id::text,
    pw_hash = null, temp_password = null,
    name = 'Gelöscht', full_name = 'Gelöscht (DSGVO)',
    fach = null, dob = null, adresse = null, tel = null, email = null,
    versicherung = null, svnr = null,
    diagnosen = null, allergie = null, blutgruppe = null, legacy_history = null,
    retention_status = 'anonymized', updated_at = now()
  where id = p_patient_id;
end;
$function$;
revoke all on function public.anonymize_patient(uuid) from public, anon, authenticated;

-- ── staff-facing entry point. Enforces tenant isolation by hand (a
-- SECURITY DEFINER function bypasses RLS, so the same practice_id check
-- the RLS policy would normally do has to happen explicitly here). ──
create or replace function public.request_patient_deletion(p_patient_id uuid)
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
  if not exists (
    select 1 from public.patients
    where id = p_patient_id and practice_id = public.current_practice_id()
  ) then
    raise exception 'not_found_or_forbidden';
  end if;

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
      deletion_requested_by = auth.uid(),
      scheduled_deletion_date = v_cutoff
    where id = p_patient_id;
    return query select false, v_cutoff;
  end if;
end;
$function$;
grant execute on function public.request_patient_deletion(uuid) to authenticated;

-- ── sweeps every patient whose scheduled date has now arrived. Call this
-- periodically -- either via pg_cron (if enabled on your Supabase plan:
-- select cron.schedule('smartordi-retention-sweep', '0 3 * * *',
-- $$select public.run_scheduled_patient_deletions()$$);) or manually from
-- a staff admin action until pg_cron is set up. Safe to call as often as
-- you like -- a patient not yet due is simply skipped. ──
create or replace function public.run_scheduled_patient_deletions()
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  v_count int := 0;
begin
  for r in
    select id from public.patients
    where retention_status = 'deletion_scheduled' and scheduled_deletion_date <= current_date
  loop
    perform public.anonymize_patient(r.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;
grant execute on function public.run_scheduled_patient_deletions() to authenticated;
