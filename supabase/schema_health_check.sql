-- ══════════════════════════════════════════════════════════════
-- Schema health check -- READ-ONLY, changes nothing.
--
-- Run this anytime you suspect a migration didn't fully apply -- e.g.
-- right after running a new phaseNN_*.sql file (to CONFIRM it actually
-- took, not just assume it), or if the app shows the red
-- "Einige Daten konnten nicht geladen werden" banner. Every row below
-- should say "OK" -- anything showing "MISSING" tells you exactly which
-- phaseNN_*.sql file needs to be (re-)run, instead of guessing.
--
-- Built after a real incident (2026-07-24): supabase/phase8_anamnese.sql
-- had silently never been fully applied on this project (missing both the
-- patients.anamnese column and the patient_set_anamnese function) -- which
-- broke the Anamnese screen, and, combined with an unrelated later
-- performance fix that started selecting that column explicitly, made the
-- ENTIRE patient list disappear with no visible error until the app-side
-- warning-banner fix shipped. This script exists so that class of problem
-- is ever only a copy-paste-and-run away from being caught early, not
-- discovered live while a doctor is trying to work.
--
-- This list is kept in sync with what the deployed app code actually
-- calls/selects (grepped directly from the *.html/vendor/*.js files, not
-- guessed from memory) -- if a new phaseNN_*.sql file adds a table/
-- function/column the app depends on, add it here too.
--
-- A second, real incident (2026-07-25) showed this wasn't enough on its
-- own: patient_login existed (section 2 below said "OK"), but the LIVE
-- version predated phase8_anamnese.sql adding the anamnese column to its
-- RETURNS TABLE -- so every login re-checked an anamnese value the
-- deployed function never actually returned, and the Anamnese screen kept
-- re-appearing forever. A function can be "installed" and still be a
-- stale, pre-migration version -- existence alone doesn't prove that.
--
-- Section 2b below closes that specific gap for the two functions this has
-- actually happened to (patient_login, patient_get_documents): it checks
-- that the deployed function's real return type (pg_get_function_result)
-- still contains the specific column the LATEST phaseNN_*.sql adds to it,
-- not just that a function by that name exists at all. This only catches
-- a changed RETURN TYPE or ARGUMENT LIST -- it cannot detect a function
-- whose signature never changed but whose internal logic is still an
-- older version (Postgres doesn't expose a function's body as a stable,
-- comparable string the way it does its signature). Whenever you next
-- change an EXISTING function's arguments or return columns (not just
-- create a brand-new one), add a row here too -- same discipline as every
-- other section.
-- ══════════════════════════════════════════════════════════════

-- 1) Every table the app currently reads/writes via sb.from(...)
select 'table' as check_type, t as name,
  case when exists (select 1 from information_schema.tables where table_schema='public' and table_name=t)
       then 'OK' else 'MISSING -- find + rerun the phaseNN_*.sql that creates this table' end as status
from unnest(array[
  'patients','termine','patient_messages','patient_documents','mkp_untersuchungen',
  'patient_impfungen','staff_profiles','staff_invites','practices','patient_join_requests',
  'patient_guardians','practice_vertretung','patient_visits','lab_result_uploads',
  'guardian_active_child','doctor_hidden_chats','patient_rezepte','patient_ueberweisungen',
  'client_error_log'
]) as t

union all

-- 2) Every RPC function the app currently calls via sb.rpc(...)
select 'function', f,
  case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = f
  ) then 'OK' else 'MISSING -- find + rerun the phaseNN_*.sql that creates this function' end
from unnest(array[
  'check_join_request_status','consume_staff_invite',
  'guardian_get_children','guardian_select_child','patient_book_termin',
  'patient_get_document_file','patient_get_documents',
  'patient_get_impfungen','patient_get_messages','patient_get_profile','patient_get_termine',
  'patient_request_deletion','patient_send_message',
  'patient_set_anamnese','patient_set_symptoms','patient_get_working_hours',
  'request_patient_deletion','validate_staff_invite','send_termine_reminders',
  'current_patient_id','current_guardian_id',
  'patient_login_precheck','guardian_login_precheck','patient_mark_password_changed',
  'guardian_mark_password_changed','guardian_get_profile','patient_get_chat_enabled',
  'anonymize_patient','run_scheduled_patient_deletions',
  'anonymize_practice','run_scheduled_practice_deletions',
  'patient_get_booking_enabled','patient_get_staff_roster',
  'public_get_practice_join_info'
]) as f

union all

-- 2b) Deployed function SIGNATURES, not just their names -- catches a stale
-- pre-migration version still live under the same function name (see the
-- 2026-07-25 patient_login incident above). Each row's "expect" is a
-- fragment that must appear in the function's actual return type
-- (pg_get_function_result) per its LATEST phaseNN_*.sql definition.
select 'function signature' as check_type, f.name,
  case
    when not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = f.name
    ) then 'MISSING (see the plain function-existence check above)'
    when exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = f.name
        and pg_get_function_result(p.oid) ilike '%'||f.expect||'%'
    ) then 'OK'
    else 'STALE -- deployed version is missing "'||f.expect||'" from its return type; find + rerun the LATEST phaseNN_*.sql that redefines this function'
  end as status
from (values
  ('patient_get_profile', 'anamnese jsonb'),
  ('patient_get_documents', 'body_text text')
) as f(name, expect)

union all

-- 3) Columns the app's own performance-optimized explicit select() lists
-- depend on (vendor/patient-data.js's *_COLUMNS constants) -- this is
-- exactly the class of column that broke silently on 2026-07-24.
select 'patients column', c,
  case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='patients' and column_name=c)
       then 'OK' else 'MISSING' end
from unnest(array[
  'id','username','name','full_name','fach','dob','adresse','tel','email','versicherung','svnr',
  'anamnese','diagnosen','allergie','blutgruppe','legacy_history','join_status','join_note',
  'practice_id','guardian_id','auth_user_id'
]) as c

union all

select 'termine column', c,
  case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='termine' and column_name=c)
       then 'OK' else 'MISSING' end
from unnest(array[
  'id','legacy_id','patient_id','patient_name','art','date','time','end_time','status','arzt_id',
  'versicherung','tel','svnr','dob','reason','reason_note','started_at','completed_at','created_at','practice_id',
  'reminder_sent_at'
]) as c

union all

select 'patient_messages column', c,
  case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='patient_messages' and column_name=c)
       then 'OK' else 'MISSING' end
from unnest(array[
  'id','patient_id','dir','type','text','sent_by','created_at','doc_id','filename','doc_sub','practice_id'
]) as c

union all

select 'patient_impfungen column', c,
  case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='patient_impfungen' and column_name=c)
       then 'OK' else 'MISSING' end
from unnest(array[
  'id','patient_id','vaccine_key','vaccine_name','dose_label','datum','next_due','charge','uploaded_by','created_at','practice_id'
]) as c

union all

select 'practices column', c,
  case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='practices' and column_name=c)
       then 'OK' else 'MISSING' end
from unnest(array[
  'working_hours','chat_enabled','retention_status','churn_confirmed_at','scheduled_data_deletion_date',
  'online_booking_enabled'
]) as c

union all

select 'patient_guardians column', c,
  case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='patient_guardians' and column_name=c)
       then 'OK' else 'MISSING' end
from unnest(array[
  'id','practice_id','username','pw_hash','temp_password','first_login','name','full_name','created_at','auth_user_id'
]) as c

union all

select 'patient_rezepte column', c,
  case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='patient_rezepte' and column_name=c)
       then 'OK' else 'MISSING' end
from unnest(array[
  'med1','packungen1','dosierung1','med2','packungen2','dosierung2',
  'med3','packungen3','dosierung3','med4','packungen4','dosierung4'
]) as c

union all

-- patient_rezepte's own sibling table (phase38) never got the same column
-- check -- found in a full app-wide bug audit (2026-07-29). Every one of
-- these is explicitly selected/inserted by createPatientUeberweisung()/
-- getUeberweisungenForPatient() in vendor/patient-data.js.
select 'patient_ueberweisungen column', c,
  case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='patient_ueberweisungen' and column_name=c)
       then 'OK' else 'MISSING' end
from unnest(array[
  'kostentraeger','status_code','von','an','fachrichtung','dringlichkeit',
  'diagnose','wegen','notizen','arbeitsunfaehig','rezeptgebuehrenbefreit','document_id'
]) as c

union all

-- ══════════════════════════════════════════════════════════════
-- 4/5/6) RLS (row-level security) health -- added 2026-07-30, after the
-- user asked whether this whole script already covers everything before
-- selling the product to real practices. It didn't: every check above only
-- catches a missing/stale TABLE, FUNCTION, or COLUMN -- none of it notices
-- if a table's actual access-control policies are missing, disabled, or
-- (the real class of bug this session's launch-readiness audit found more
-- than once, e.g. the patient/guardian staff-roster bug) fully unscoped, so
-- every practice can see every OTHER practice's rows. RLS is the single
-- most consequential thing in this whole database to get right and the
-- one this old health check never actually looked at.
--
-- These 3 checks are a heuristic safety net, not a substitute for reading
-- the actual policy definitions -- they catch the "structurally obviously
-- wrong" cases (RLS off entirely; RLS on with zero policies, meaning the
-- table is 100% inaccessible to every real user; every existing policy's
-- condition text contains no scoping function at all) but can't verify a
-- policy's LOGIC is actually correct, only that it isn't glaringly absent.
-- ══════════════════════════════════════════════════════════════

-- 4) RLS actually turned on. A table with RLS disabled has NO row-level
-- access control at all -- any authenticated (or even anon, depending on
-- grants) caller sees every row from every practice, unconditionally.
select 'RLS enabled' as check_type, t as name,
  case when exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=t and c.relrowsecurity=true
  ) then 'OK' else 'MISSING -- RLS is not enabled on this table -- every row is visible/writable with no access control at all' end as status
from unnest(array[
  'patients','termine','patient_messages','patient_documents','mkp_untersuchungen',
  'patient_impfungen','staff_profiles','staff_invites','practices','patient_join_requests',
  'patient_guardians','practice_vertretung','patient_visits','lab_result_uploads',
  'guardian_active_child','doctor_hidden_chats','patient_rezepte','patient_ueberweisungen',
  'client_error_log'
]) as t

union all

-- 5) At least one policy exists. RLS enabled + zero policies means Postgres
-- denies EVERY row to EVERY non-superuser caller -- not a leak, but it
-- silently breaks every feature that touches this table. guardian_active_
-- child is a deliberate, documented exception (phase31_patient_auth.sql):
-- it's reachable ONLY from inside SECURITY DEFINER functions, by design,
-- with zero policies on purpose.
select 'RLS policy exists' as check_type, t as name,
  case
    when t='guardian_active_child' then 'N/A -- intentionally zero policies (RPC-only access via SECURITY DEFINER functions, see phase31_patient_auth.sql)'
    when exists (select 1 from pg_policies where schemaname='public' and tablename=t) then 'OK'
    else 'MISSING -- RLS is enabled but has zero policies -- this table is completely inaccessible to every real caller, likely breaking whatever feature reads/writes it'
  end as status
from unnest(array[
  'patients','termine','patient_messages','patient_documents','mkp_untersuchungen',
  'patient_impfungen','staff_profiles','staff_invites','practices','patient_join_requests',
  'patient_guardians','practice_vertretung','patient_visits','lab_result_uploads',
  'guardian_active_child','doctor_hidden_chats','patient_rezepte','patient_ueberweisungen',
  'client_error_log'
]) as t

union all

-- 6) At least one policy actually scopes access to something (this
-- practice/this user/this patient), rather than every policy being a bare
-- `using (true)` -- exactly the multi-tenant leak pattern phase12/15/18/19
-- closed one table at a time earlier this project. A table can legitimately
-- have ONE unscoped policy on purpose (patient_join_requests' anon INSERT,
-- since a self-registering visitor has no session at all to scope by) as
-- long as ANOTHER policy on the same table (its staff SELECT/UPDATE) does
-- scope -- this checks per-TABLE ("does at least one policy scope"), not
-- per-policy, for exactly that reason. client_error_log is a second,
-- different kind of exception: it's INSERT-only, and its one policy is
-- deliberately `with check (true)` (phase46_client_error_log.sql) since an
-- insert can't be trusted to supply its own correct practice_id anyway --
-- scoping there is enforced by the trg_set_practice_id trigger server-side,
-- not by the policy's own with_check text, which this heuristic can't see.
select 'RLS actually scopes access' as check_type, t as name,
  case
    when t='guardian_active_child' then 'N/A -- intentionally zero policies (RPC-only access via SECURITY DEFINER functions, see phase31_patient_auth.sql)'
    when t='client_error_log' then 'N/A -- insert-only with a deliberately unscoped with_check; scoping is enforced by the trg_set_practice_id trigger, not this policy (see phase46_client_error_log.sql)'
    when not exists (select 1 from pg_policies where schemaname='public' and tablename=t)
      then 'MISSING (see the RLS policy exists check above)'
    when exists (
      select 1 from pg_policies where schemaname='public' and tablename=t
        and (coalesce(qual,'') ~* 'current_practice_id\(\)|auth\.uid\(\)|current_patient_id\(\)|current_guardian_id\(\)'
          or coalesce(with_check,'') ~* 'current_practice_id\(\)|auth\.uid\(\)|current_patient_id\(\)|current_guardian_id\(\)')
    ) then 'OK'
    else 'WARNING -- every policy on this table looks fully unscoped (no practice/user/patient scoping function found in any qual/with_check) -- verify manually, this may leak rows across every practice'
  end as status
from unnest(array[
  'patients','termine','patient_messages','patient_documents','mkp_untersuchungen',
  'patient_impfungen','staff_profiles','staff_invites','practices','patient_join_requests',
  'patient_guardians','practice_vertretung','patient_visits','lab_result_uploads',
  'guardian_active_child','doctor_hidden_chats','patient_rezepte','patient_ueberweisungen',
  'client_error_log'
]) as t

order by check_type, name;
