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
-- ══════════════════════════════════════════════════════════════

-- 1) Every table the app currently reads/writes via sb.from(...)
select 'table' as check_type, t as name,
  case when exists (select 1 from information_schema.tables where table_schema='public' and table_name=t)
       then 'OK' else 'MISSING -- find + rerun the phaseNN_*.sql that creates this table' end as status
from unnest(array[
  'patients','termine','patient_messages','patient_documents','mkp_untersuchungen',
  'patient_impfungen','staff_profiles','staff_invites','practices','patient_join_requests',
  'patient_guardians','practice_vertretung','patient_visits','lab_result_uploads'
]) as t

union all

-- 2) Every RPC function the app currently calls via sb.rpc(...)
select 'function', f,
  case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = f
  ) then 'OK' else 'MISSING -- find + rerun the phaseNN_*.sql that creates this function' end
from unnest(array[
  'check_join_request_status','consume_staff_invite','guardian_change_password',
  'guardian_get_children','guardian_login','guardian_select_child','patient_book_termin',
  'patient_change_password','patient_get_document_file','patient_get_documents',
  'patient_get_impfungen','patient_get_messages','patient_get_profile','patient_get_termine',
  'patient_login','patient_logout','patient_request_deletion','patient_send_message',
  'patient_set_anamnese','patient_set_symptoms','request_patient_deletion','validate_staff_invite'
]) as f

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
  'practice_id','guardian_id'
]) as c

union all

select 'termine column', c,
  case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='termine' and column_name=c)
       then 'OK' else 'MISSING' end
from unnest(array[
  'id','legacy_id','patient_id','patient_name','art','date','time','end_time','status','arzt_id',
  'versicherung','tel','svnr','dob','reason','reason_note','started_at','completed_at','created_at','practice_id'
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

order by check_type, name;
