-- ══════════════════════════════════════════════════════════════
-- Phase 88: complete deletion at practice end, portal-only detach on
-- patient self-deletion, and an export path during the lock window
--
-- Legal frame (decided 2026-10-23): SmartOrdi is Auftragsverarbeiter.
-- When a practice's contract ends (pilot end, trial expiry, churn) we
-- must return the data (export) and then delete ALL of it (Art. 28(3)(g)
-- DSGVO). The DOCTOR keeps the medical documentation for 10 years
-- (§ 51 Abs 3 ÄrzteG) -- which is why the export must work up to the
-- deletion date, including while the practice is already locked.
--
-- What was wrong (found by the legal review, confirmed on the live DB):
-- anonymize_practice() (phase43) only called anonymize_patient() (phase17)
-- per patient, and anonymize_patient() predates most clinical tables. It
-- left behind: patient_visits (diagnose/therapy/notes), patient_rezepte,
-- patient_ueberweisungen, patient_arbeitsunfaehigkeit,
-- patient_pflegefreistellung, patient_lab_results, lab_result_uploads
-- (lab inbox, incl. the PDF in file_data), patient_vaccine_dismissals,
-- patient_report_sends, consent_records, doctor_hidden_chats,
-- patient_join_requests (name/SVNR/DOB), practice_vertretung,
-- client_error_log, staff_invites, the patients' Anamnese (jsonb), cave,
-- geschlecht, the patients' Supabase Auth logins (auth.users + profile
-- links), staff full_name, and -- worst -- every audit_log row kept a full
-- before/after snapshot of the row (diagnoses, SVNR, Anamnese ...).
--
-- Storage: there are NO Supabase Storage buckets in this project (checked
-- live 2026-10-23: storage.buckets is empty). Every file (documents, lab
-- PDFs, signatures, stamps) lives in a table column (file_data /
-- *_data_url) and is removed with its row below. schema_health_check.sql
-- now warns if a bucket ever appears, because then this function would
-- also have to delete those objects (via the Storage API -- Supabase
-- blocks direct DELETEs on storage.objects).
--
-- 1) purge_practice_data(p_practice_id) -- deletes every row of that
--    practice in every practice/patient table, deletes the patients' own
--    auth.users logins (only when not linked to anything outside this
--    practice), scrubs staff identity, blanks the practice row, and
--    reduces every audit_log row of the practice to non-personal metadata
--    (table_name, action, created_at, practice_id; data/row_id/patient_id/
--    actor_id = null). Refuses to run on a practice whose retention_status
--    is 'active' -- the only callers are run_scheduled_practice_deletions()
--    (unchanged eligibility: deletion_scheduled + date reached) and the
--    one-time backfill for already-anonymized practices at the end.
--    anonymize_practice() keeps its name (cron + docs call it) and now
--    delegates to it.
--    run_scheduled_practice_deletions() additionally SKIPS a practice that
--    was flagged automatically (churn_confirmed_at is null) but is no
--    longer locked (paid between the 03:00 flag and the 03:15 sweep) --
--    this only ever deletes FEWER practices, never more.
--    Not deleted on purpose: the staff members' own auth.users logins
--    (scrubbed staff_profiles stay; deleting the logins is a decision for
--    the owner -- see TODO.md), the practices row itself (tombstone;
--    audit_log.practice_id references it) and its Stripe ids (accounting
--    reference, the invoices themselves live at Stripe).
--
-- 2) anonymize_patient(p_patient_id) -- the per-patient path (10-year
--    retention elapsed, phase17/20) is made complete the same way: every
--    clinical table, lab inbox, consents, report-send log, portal login,
--    and that patient's audit_log payloads. The patients row stays (scrubbed)
--    because termine/audit rows of the still-active practice point to it.
--
-- 3) Patient self-deletion while the practice is active (phase20,
--    _apply_patient_deletion_request): before this phase it did NOT touch
--    medical records (correct, § 51 ÄrzteG) but it also did NOT remove the
--    portal login -- the patient kept using the account until the
--    10-year date. Now the portal account is removed immediately
--    (_detach_patient_portal_account: sessions, profile links,
--    username/password, auth_user_id, and the auth.users login itself when
--    nothing else uses it), while the clinical record stays with the
--    practice until the retention date. "Last treatment" now also counts
--    visits, Rezepte, Überweisungen, lab results and documents, not only
--    Termine -- this can only move the date LATER, never earlier.
--
-- 4) Export during the lock (day 91-104 for a pilot, 31-44 for a trial,
--    the 60 days of phase43 for a churned customer): practice_export_status()
--    and practice_export_table() -- SECURITY DEFINER, admin staff only,
--    read-only, own practice only, work while the practice is locked as
--    long as it is not yet anonymized. The RLS lock on the clinical
--    tables (phase21) is NOT relaxed, so normal use stays blocked.
--
-- Run after phase87. Then run schema_health_check.sql (new section 8 must
-- show OK for "no storage buckets" and for every anonymized practice).
--
-- NOT applied live yet (2026-10-23): the Supabase MCP tool in that session
-- held every statement of this file for a destructive-statement
-- confirmation that nobody could give, so it timed out. Verified instead
-- on a local Postgres 16 replica built from the live schema (all public
-- tables/constraints/functions/triggers): end-to-end pilot practice
-- created -> locked -> export -> flagged -> purged, plus self-deletion,
-- 10-year anonymization, lock window, paid-after-flag and the backfill.
-- Apply it by hand in the SQL editor (it is one transaction-safe file).
-- ══════════════════════════════════════════════════════════════

-- ── helper: delete a Supabase Auth login only if nothing else still uses it ──
create or replace function public._delete_auth_user_if_unlinked(p_auth_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_auth_user_id is null then
    return false;
  end if;
  if exists (select 1 from public.patients where auth_user_id = p_auth_user_id)
     or exists (select 1 from public.patient_account_profiles where owner_auth_user_id = p_auth_user_id)
     or exists (select 1 from public.patient_guardians where auth_user_id = p_auth_user_id)
     or exists (select 1 from public.staff_profiles where id = p_auth_user_id)
     or exists (select 1 from public.patient_join_requests where linked_auth_user_id = p_auth_user_id)
     or exists (select 1 from public.staff_invites where used_by = p_auth_user_id or invited_by = p_auth_user_id)
  then
    return false;
  end if;
  delete from auth.users where id = p_auth_user_id;
  return true;
end;
$function$;
revoke all on function public._delete_auth_user_if_unlinked(uuid) from public, anon, authenticated;

-- ── helper: remove a patient's PORTAL account, keep the clinical record ──
create or replace function public._detach_patient_portal_account(p_patient_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_auth uuid;
  v_owners uuid[];
  v_other uuid;
  o uuid;
begin
  select auth_user_id into v_auth from public.patients where id = p_patient_id;
  -- logins that had this patient as an ADDITIONAL profile (phase64)
  select coalesce(array_agg(owner_auth_user_id), '{}') into v_owners
  from public.patient_account_profiles where patient_id = p_patient_id;

  delete from public.patient_sessions where patient_id = p_patient_id;
  delete from public.patient_active_profile where patient_id = p_patient_id;
  delete from public.patient_account_profiles where patient_id = p_patient_id;
  delete from public.guardian_active_child where patient_id = p_patient_id;

  update public.patients set
    username = 'deleted_' || p_patient_id::text,
    pw_hash = null, temp_password = null, temp_password_set_at = null,
    auth_user_id = null, failed_login_attempts = 0, locked_until = null,
    updated_at = now()
  where id = p_patient_id;

  -- The login itself: delete it when nothing else uses it; if it still
  -- owns other profiles (e.g. a parent whose children stay), point it at
  -- one of them so current_patient_id() keeps resolving for that login.
  foreach o in array (case when v_auth is null then v_owners else array_append(v_owners, v_auth) end) loop
    if not public._delete_auth_user_if_unlinked(o) then
      if not exists (select 1 from public.patients where auth_user_id = o)
         and not exists (select 1 from public.patient_active_profile where auth_user_id = o) then
        select patient_id into v_other from public.patient_account_profiles
        where owner_auth_user_id = o order by created_at limit 1;
        if v_other is not null then
          insert into public.patient_active_profile(auth_user_id, patient_id) values (o, v_other)
          on conflict (auth_user_id) do update set patient_id = excluded.patient_id, updated_at = now();
        end if;
      end if;
    end if;
  end loop;
end;
$function$;
revoke all on function public._detach_patient_portal_account(uuid) from public, anon, authenticated;

-- ── per-patient complete anonymization (retention elapsed) ──
create or replace function public.anonymize_patient(p_patient_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  delete from public.patient_messages where patient_id = p_patient_id;
  delete from public.patient_rezepte where patient_id = p_patient_id;
  delete from public.patient_ueberweisungen where patient_id = p_patient_id;
  delete from public.patient_arbeitsunfaehigkeit where patient_id = p_patient_id;
  delete from public.patient_pflegefreistellung where patient_id = p_patient_id;
  delete from public.patient_documents where patient_id = p_patient_id;
  delete from public.mkp_untersuchungen where patient_id = p_patient_id;
  delete from public.patient_impfungen where patient_id = p_patient_id;
  delete from public.patient_vaccine_dismissals where patient_id = p_patient_id;
  delete from public.patient_visits where patient_id = p_patient_id;
  delete from public.patient_lab_results where patient_id = p_patient_id;
  delete from public.lab_result_uploads where matched_patient_id = p_patient_id;
  delete from public.patient_report_sends where patient_id = p_patient_id;
  delete from public.consent_records where patient_id = p_patient_id;
  delete from public.doctor_hidden_chats where patient_id = p_patient_id;

  perform public._detach_patient_portal_account(p_patient_id);

  update public.termine set
    patient_name = 'Gelöscht (DSGVO)', reason = null, reason_note = null,
    versicherung = null, tel = null, svnr = null, dob = null
  where patient_id = p_patient_id;

  update public.patients set
    name = 'Gelöscht', full_name = 'Gelöscht (DSGVO)',
    fach = null, dob = null, adresse = null, tel = null, email = null,
    versicherung = null, svnr = null, geschlecht = null,
    diagnosen = null, allergie = null, blutgruppe = null, legacy_history = null,
    anamnese = null, cave = null, join_note = null, guardian_id = null,
    consent_given_at = null,
    retention_status = 'anonymized', updated_at = now()
  where id = p_patient_id;

  -- Last: the audit triggers above just wrote fresh snapshots too.
  update public.audit_log set data = null
  where patient_id = p_patient_id and data is not null;
end;
$function$;
revoke all on function public.anonymize_patient(uuid) from public, anon, authenticated;

-- ── whole-practice complete deletion ──
create or replace function public.purge_practice_data(p_practice_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text;
  v_patients uuid[];
  v_auth uuid[];
  v_guardians uuid[];
  a uuid;
begin
  select retention_status into v_status from public.practices where id = p_practice_id for update;
  if v_status is null then
    raise exception 'practice_not_found';
  end if;
  if v_status = 'active' then
    raise exception 'practice_still_active: refusing to purge %', p_practice_id;
  end if;

  select coalesce(array_agg(id), '{}') into v_patients from public.patients where practice_id = p_practice_id;
  select coalesce(array_agg(distinct x), '{}') into v_auth from (
    select auth_user_id as x from public.patients where id = any(v_patients) and auth_user_id is not null
    union select owner_auth_user_id from public.patient_account_profiles where patient_id = any(v_patients)
  ) s;
  -- guardians (phase28, retired) whose every child is in this practice
  select coalesce(array_agg(g.id), '{}') into v_guardians
  from public.patient_guardians g
  where (g.practice_id = p_practice_id or exists (select 1 from public.patients p where p.guardian_id = g.id and p.id = any(v_patients)))
    and not exists (select 1 from public.patients p where p.guardian_id = g.id and not (p.id = any(v_patients)));
  select v_auth || coalesce(array_agg(auth_user_id), '{}') into v_auth
  from public.patient_guardians where id = any(v_guardians) and auth_user_id is not null;

  delete from public.patient_messages where practice_id = p_practice_id or patient_id = any(v_patients);
  delete from public.patient_rezepte where practice_id = p_practice_id or patient_id = any(v_patients);
  delete from public.patient_ueberweisungen where practice_id = p_practice_id or patient_id = any(v_patients);
  delete from public.patient_arbeitsunfaehigkeit where practice_id = p_practice_id or patient_id = any(v_patients);
  delete from public.patient_pflegefreistellung where practice_id = p_practice_id or patient_id = any(v_patients);
  delete from public.patient_documents where practice_id = p_practice_id or patient_id = any(v_patients);
  delete from public.mkp_untersuchungen where practice_id = p_practice_id or patient_id = any(v_patients);
  delete from public.patient_impfungen where practice_id = p_practice_id or patient_id = any(v_patients);
  delete from public.patient_vaccine_dismissals where practice_id = p_practice_id or patient_id = any(v_patients);
  delete from public.patient_visits where practice_id = p_practice_id or patient_id = any(v_patients);
  delete from public.patient_lab_results where practice_id = p_practice_id or patient_id = any(v_patients);
  delete from public.lab_result_uploads where practice_id = p_practice_id or matched_patient_id = any(v_patients);
  delete from public.patient_report_sends where practice_id = p_practice_id or patient_id = any(v_patients);
  delete from public.consent_records where practice_id = p_practice_id or patient_id = any(v_patients);
  delete from public.doctor_hidden_chats where practice_id = p_practice_id or patient_id = any(v_patients);
  delete from public.termine where practice_id = p_practice_id or patient_id = any(v_patients);
  delete from public.patient_join_requests where practice_id = p_practice_id;
  delete from public.practice_vertretung where practice_id = p_practice_id;
  delete from public.client_error_log where practice_id = p_practice_id;
  delete from public.staff_invites where practice_id = p_practice_id;

  delete from public.patient_sessions where patient_id = any(v_patients);
  delete from public.patient_active_profile where patient_id = any(v_patients);
  delete from public.patient_account_profiles where patient_id = any(v_patients);
  delete from public.guardian_active_child where patient_id = any(v_patients);
  update public.patients set guardian_id = null where id = any(v_patients) and guardian_id is not null;
  delete from public.patient_guardians where id = any(v_guardians);
  delete from public.patients where id = any(v_patients);

  foreach a in array v_auth loop
    perform public._delete_auth_user_if_unlinked(a);
  end loop;

  delete from public.staff_pilot_login_links
  where staff_id in (select id from public.staff_profiles where practice_id = p_practice_id);
  update public.staff_profiles set
    -- full_name is a generated column (vorname || nachname)
    vorname = 'Gelöscht', nachname = '(Praxis geschlossen)',
    fach = null,
    email = 'geloescht_' || id::text || '@anonymized.smartordi.internal',
    stempel_data_url = null, sig_data_url = null
  where practice_id = p_practice_id;

  update public.practices set
    name = 'Gelöschte Praxis', adresse = null, tel = null,
    lab_email_token = null, working_hours = null,
    retention_status = 'anonymized'
  where id = p_practice_id;

  -- Last, after every trigger above has fired: keep only non-personal
  -- metadata (table_name, action, created_at, practice_id).
  update public.audit_log set data = null, row_id = null, patient_id = null, actor_id = null
  where (practice_id = p_practice_id or patient_id = any(v_patients))
    and (data is not null or row_id is not null or patient_id is not null or actor_id is not null);
end;
$function$;
revoke all on function public.purge_practice_data(uuid) from public, anon, authenticated;

create or replace function public.anonymize_practice(p_practice_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.purge_practice_data(p_practice_id);
end;
$function$;
revoke all on function public.anonymize_practice(uuid) from public, anon, authenticated;

create or replace function public.run_scheduled_practice_deletions()
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
    select id from public.practices
    where retention_status = 'deletion_scheduled' and scheduled_data_deletion_date <= current_date
      -- auto-flagged (phase50/87) but paid in the meantime: not due any more
      and not (churn_confirmed_at is null and public.practice_trial_active(id))
  loop
    perform public.purge_practice_data(r.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;
revoke all on function public.run_scheduled_practice_deletions() from public, anon, authenticated;

-- ── patient / staff deletion request: detach the portal now, keep the record ──
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
  select max(d) into v_last_date from (
    select max(date) as d from public.termine where patient_id = p_patient_id and status <> 'abgesagt'
    union all select max(visit_date) from public.patient_visits where patient_id = p_patient_id
    union all select max(datum) from public.patient_rezepte where patient_id = p_patient_id
    union all select max(datum) from public.patient_ueberweisungen where patient_id = p_patient_id
    union all select max(datum) from public.patient_lab_results where patient_id = p_patient_id
    union all select max(created_at::date) from public.patient_documents where patient_id = p_patient_id
  ) s;
  v_last_date := greatest(coalesce(v_last_date, v_created), v_created);
  v_cutoff := v_last_date + interval '10 years';

  if v_cutoff <= current_date then
    perform public.anonymize_patient(p_patient_id);
    return query select true, current_date;
  else
    perform public._detach_patient_portal_account(p_patient_id);
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

-- ── 4) export during the lock ──
create or replace function public.practice_export_status()
returns table(allowed boolean, locked boolean, export_until date)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_staff record;
  v_p record;
  v_locked boolean;
  v_until date;
begin
  select s.practice_id, s.is_admin into v_staff from public.staff_profiles s where s.id = auth.uid();
  if v_staff.practice_id is null then
    return query select false, false, null::date;
    return;
  end if;
  select * into v_p from public.practices where id = v_staff.practice_id;
  v_locked := not public.practice_trial_active(v_staff.practice_id);
  if v_p.retention_status = 'deletion_scheduled' then
    -- run_scheduled_practice_deletions() runs at 03:15 UTC on that date
    v_until := v_p.scheduled_data_deletion_date - 1;
  elsif v_locked and v_p.payment_method is null and v_p.stripe_subscription_id is null
        and public.practice_trial_ends_at(v_p.trial_start, v_p.is_pilot, v_p.pilot_until) is not null then
    -- flag_expired_unpaid_trials() (03:00 UTC) flags at the first run
    -- AFTER ends_at + 14 days, the sweep deletes 15 minutes later
    v_until := ((public.practice_trial_ends_at(v_p.trial_start, v_p.is_pilot, v_p.pilot_until)
                 + interval '14 days') at time zone 'UTC' - interval '3 hours')::date;
  end if;
  return query select (coalesce(v_staff.is_admin, false) and v_p.retention_status <> 'anonymized'), v_locked, v_until;
end;
$function$;
revoke all on function public.practice_export_status() from public, anon;
grant execute on function public.practice_export_status() to authenticated;

create or replace function public.practice_export_table(p_table text, p_after uuid default null, p_limit int default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_practice uuid;
  v_ok boolean;
  v_rows jsonb;
begin
  select allowed into v_ok from public.practice_export_status();
  if not coalesce(v_ok, false) then
    raise exception 'export_forbidden' using errcode = '42501';
  end if;
  if p_table <> all (array[
    'patients','termine','patient_visits','patient_rezepte','patient_ueberweisungen',
    'patient_arbeitsunfaehigkeit','patient_pflegefreistellung','patient_lab_results',
    'lab_result_uploads','patient_documents','patient_messages','mkp_untersuchungen',
    'patient_impfungen','patient_vaccine_dismissals','consent_records','patient_report_sends'
  ]) then
    raise exception 'export_unknown_table';
  end if;
  v_practice := public.current_practice_id();
  execute format(
    'select coalesce(jsonb_agg(s.r order by s.id), ''[]''::jsonb) from (
       select t.id, to_jsonb(t) - ''pw_hash'' - ''temp_password'' as r
       from public.%I t
       where t.practice_id = $1 and ($2::uuid is null or t.id > $2)
       order by t.id limit $3) s', p_table)
  into v_rows
  using v_practice, p_after, least(greatest(coalesce(p_limit, 200), 1), 500);
  return v_rows;
end;
$function$;
revoke all on function public.practice_export_table(text, uuid, int) from public, anon;
grant execute on function public.practice_export_table(text, uuid, int) to authenticated;

-- ── one-time backfill: practices that were already "anonymized" under the
-- old, incomplete phase43 logic get the complete purge now. On 2026-10-23
-- these were exactly the 3 test practices (approved by the owner). ──
do $$
declare r record;
begin
  for r in select id from public.practices where retention_status = 'anonymized' loop
    perform public.purge_practice_data(r.id);
  end loop;
end $$;

-- orphaned audit payloads whose patient row no longer exists anywhere
update public.audit_log a set data = null
where a.data is not null and a.patient_id is not null
  and not exists (select 1 from public.patients p where p.id = a.patient_id);
