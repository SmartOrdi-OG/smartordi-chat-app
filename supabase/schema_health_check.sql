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
  'patient_guardians','practice_vertretung','patient_visits','lab_result_uploads','patient_lab_results',
  'guardian_active_child','doctor_hidden_chats','patient_rezepte','patient_ueberweisungen',
  'client_error_log','patient_pflegefreistellung','patient_arbeitsunfaehigkeit',
  'patient_vaccine_dismissals','consent_records','staff_pilot_login_links',
  -- phase64: schema-only so far -- no app code reads/writes these yet (see
  -- that file's own header), but they still need to actually exist for the
  -- migration to have applied at all, so they're checked here too.
  'patient_account_profiles','patient_active_profile'
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
  'flag_expired_unpaid_trials',
  'patient_get_booking_enabled','patient_get_staff_roster',
  'public_get_practice_join_info','record_consent','patient_update_profile',
  -- phase64: not called by any app code yet (schema/RPC foundation only)
  'patient_get_profiles','patient_switch_profile',
  'patient_submit_profile_join_request','staff_link_account_profile',
  -- phase65
  'patient_change_username',
  -- phase69
  'patient_get_mkp_exams',
  -- phase73
  'patient_get_practice_contact',
  -- phase76
  'staff_add_linked_child'
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
  -- phase72: catches a deployed version still missing geschlecht from its
  -- return type -- without it, patient.html's symptom-picker figure
  -- (renderBodyFigure()) can never auto-select from the patient's own
  -- registered gender, silently falling back to the manual toggle forever
  -- even for patients who DID specify one.
  ('patient_get_profile', 'geschlecht text'),
  ('patient_get_documents', 'body_text text')
) as f(name, expect)

union all

-- 2c) Deployed function BODY, not just its signature -- closes the gap 2b's
-- own comment admits it can't ("cannot detect a function whose signature
-- never changed but whose internal logic is still an older version").
-- Found a live need for this the same day it was written: phase49's fix to
-- patient_book_termin() (a real cross-practice booking bug found during the
-- RLS audit) keeps the exact same argument list and return type as phase44's
-- version, so 2b's return-type check can't tell the two apart -- only the
-- function's actual source (pg_get_functiondef) can. Each row's "expect" is
-- a fragment that must appear in the function's real body per its LATEST
-- phaseNN_*.sql definition.
select 'function body' as check_type, f.name,
  case
    when not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = f.name
    ) then 'MISSING (see the plain function-existence check above)'
    when exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = f.name
        and pg_get_functiondef(p.oid) ilike '%'||f.expect||'%'
    ) then 'OK'
    else 'STALE -- deployed version is missing "'||f.expect||'" from its body; find + rerun the LATEST phaseNN_*.sql that redefines this function'
  end as status
from (values
  ('patient_book_termin', 'invalid_arzt'),
  -- phase61: catches the exact regression that shipped in phase33 --
  -- patient_send_message() silently dropping practice_id, which made every
  -- patient-sent chat message invisible to staff with no error anywhere.
  ('patient_send_message', 'v_practice_id'),
  -- phase62: catches a regression back to checking patients.pw_hash (a
  -- value that goes permanently stale the moment a patient changes their
  -- own password) instead of the real auth.users.encrypted_password --
  -- that locked every patient who ever changed their password out of
  -- every fresh login with a false "wrong password".
  ('patient_login_precheck', 'auth.users'),
  ('guardian_login_precheck', 'auth.users'),
  -- phase63: catches a deployed version that's missing the ownership check
  -- (current_patient_id()) -- without it, a patient could edit ANY row's
  -- contact details, not just their own.
  ('patient_update_profile', 'current_patient_id'),
  -- phase64: catches a deployed current_patient_id() that's still the OLD
  -- pre-phase64 coalesce (own row, then guardian_active_child) -- without
  -- patient_active_profile checked FIRST, an account can never actually
  -- switch into a linked child/adult profile no matter what the rest of
  -- this phase's schema/RPCs say, since this function is the single place
  -- every patient_*/RPC resolves "who is the caller" from.
  ('current_patient_id', 'patient_active_profile'),
  -- phase68: catches a deployed version that still never writes is_child
  -- onto the join request it creates -- without it, every child added via
  -- patient.html's own "+ Kind hinzufügen" ends up with is_child=false
  -- despite relation='child' being recorded correctly, which silently hid
  -- their Impfungen card the same way phase67 hides it for a real adult.
  ('patient_submit_profile_join_request', 'p_relation = ''child'''),
  -- phase74: catches a deployed version still missing p_dob/p_versicherung
  -- -- without it, "+ Kind hinzufügen" has nowhere to send the new
  -- profile's Geburtsdatum, and self-registration's Versicherung stays
  -- unreachable for this path.
  ('patient_submit_profile_join_request', 'p_versicherung'),
  -- phase75: catches a deployed version still missing p_geschlecht -- same
  -- gap phase74 fixed for dob/versicherung, this time for gender.
  ('patient_submit_profile_join_request', 'p_geschlecht'),
  -- phase77: catches a deployed version still missing the "picked owner is
  -- itself a linked (non-root) profile" resolution -- without it, linking a
  -- new child onto an owner search result that happens to be an already-
  -- linked sibling (not the account's root/direct profile) silently attaches
  -- the new child to that sibling's own dormant auth_user_id instead of the
  -- family's real login, so it never shows up when they actually log in.
  ('staff_add_linked_child', 'v_root_owner_auth')
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
  'practice_id','guardian_id','auth_user_id',
  -- phase65
  'is_child',
  -- phase72
  'geschlecht'
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

-- phase65
select 'patient_join_requests column', c,
  case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='patient_join_requests' and column_name=c)
       then 'OK' else 'MISSING' end
from unnest(array[
  'id','username','vorname','nachname','full_name','adresse','svnr','temp_password','pw_hash',
  'practice_id','status','submitted_at','reviewed_at','note','linked_auth_user_id','relation',
  'relation_label','is_child',
  -- phase67
  'dob','tel',
  -- phase72
  'geschlecht',
  -- phase74
  'versicherung'
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

select 'patient_lab_results column', c,
  case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='patient_lab_results' and column_name=c)
       then 'OK' else 'MISSING' end
from unnest(array[
  'bezeichnung','wert','ergebnis_text','gruppe','quelle','datum'
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
  'kostentraeger','status_code','von','an','an_adresse','an_tel','fachrichtung','dringlichkeit',
  'diagnose','wegen','notizen','arbeitsunfaehig','rezeptgebuehrenbefreit','document_id'
]) as c

union all

-- phase51_atteste.sql (Pflegefreistellung/Arbeitsunfähigkeit) -- same
-- reasoning as patient_ueberweisungen above: every column here is what
-- createPatientPflegefreistellung()/getPflegefreistellungenForPatient()
-- in vendor/patient-data.js actually selects/inserts.
select 'patient_pflegefreistellung column', c,
  case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='patient_pflegefreistellung' and column_name=c)
       then 'OK' else 'MISSING' end
from unnest(array[
  'antragsteller_name','verwandtschaftsverhaeltnis','von','bis','ort','ausstellungsdatum','document_id'
]) as c

union all

-- Same for createPatientArbeitsunfaehigkeit()/getArbeitsunfaehigkeitenForPatient().
select 'patient_arbeitsunfaehigkeit column', c,
  case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='patient_arbeitsunfaehigkeit' and column_name=c)
       then 'OK' else 'MISSING' end
from unnest(array[
  'krankenstandsadresse','von','bis','ausgehzeit_von','ausgehzeit_bis','bettruhe','grund',
  'versicherungstraeger','versicherungsnummer','ausstellungsdatum','document_id'
]) as c

union all

-- phase57_vaccine_dismissals.sql -- backs the × button next to a due
-- vaccine in doctor.html's Kartei Impfung tab. If this table is missing,
-- refreshVaccineDismissals() (vendor/patient-data.js) fails on every single
-- page load of doctor.html/secretary.html, which is exactly what trips the
-- red "Einige Daten konnten nicht geladen werden" banner -- even though
-- nothing about the real patient list/termine/messages is actually broken.
select 'patient_vaccine_dismissals column', c,
  case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='patient_vaccine_dismissals' and column_name=c)
       then 'OK' else 'MISSING' end
from unnest(array[
  'id','patient_id','vaccine_label','dismissed_by','dismissed_at'
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
  'patient_guardians','practice_vertretung','patient_visits','lab_result_uploads','patient_lab_results',
  'guardian_active_child','doctor_hidden_chats','patient_rezepte','patient_ueberweisungen',
  'client_error_log','patient_pflegefreistellung','patient_arbeitsunfaehigkeit',
  'patient_vaccine_dismissals','consent_records','staff_pilot_login_links',
  'patient_account_profiles','patient_active_profile'
]) as t

union all

-- 5) At least one policy exists. RLS enabled + zero policies means Postgres
-- denies EVERY row to EVERY non-superuser caller -- not a leak, but it
-- silently breaks every feature that touches this table. guardian_active_
-- child is a deliberate, documented exception (phase31_patient_auth.sql):
-- it's reachable ONLY from inside SECURITY DEFINER functions, by design,
-- with zero policies on purpose. staff_pilot_login_links is the same kind
-- of exception, for the same reason (phase60_pilot_login_links.sql):
-- reachable ONLY via the service-role key inside the pilot-login/
-- send-pilot-login-link Edge Functions, never by any authenticated/anon
-- client role.
select 'RLS policy exists' as check_type, t as name,
  case
    when t='guardian_active_child' then 'N/A -- intentionally zero policies (RPC-only access via SECURITY DEFINER functions, see phase31_patient_auth.sql)'
    when t='staff_pilot_login_links' then 'N/A -- intentionally zero policies (service-role Edge Functions only, see phase60_pilot_login_links.sql)'
    when t in ('patient_account_profiles','patient_active_profile') then 'N/A -- intentionally zero policies (RPC-only access via SECURITY DEFINER functions, same trust boundary as guardian_active_child, see phase64_unified_account_profiles.sql)'
    when exists (select 1 from pg_policies where schemaname='public' and tablename=t) then 'OK'
    else 'MISSING -- RLS is enabled but has zero policies -- this table is completely inaccessible to every real caller, likely breaking whatever feature reads/writes it'
  end as status
from unnest(array[
  'patients','termine','patient_messages','patient_documents','mkp_untersuchungen',
  'patient_impfungen','staff_profiles','staff_invites','practices','patient_join_requests',
  'patient_guardians','practice_vertretung','patient_visits','lab_result_uploads','patient_lab_results',
  'guardian_active_child','doctor_hidden_chats','patient_rezepte','patient_ueberweisungen',
  'client_error_log','patient_pflegefreistellung','patient_arbeitsunfaehigkeit',
  'patient_vaccine_dismissals','consent_records','staff_pilot_login_links',
  'patient_account_profiles','patient_active_profile'
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
    when t='staff_pilot_login_links' then 'N/A -- intentionally zero policies (service-role Edge Functions only, see phase60_pilot_login_links.sql)'
    when t='client_error_log' then 'N/A -- insert-only with a deliberately unscoped with_check; scoping is enforced by the trg_set_practice_id trigger, not this policy (see phase46_client_error_log.sql)'
    when t in ('patient_account_profiles','patient_active_profile') then 'N/A -- intentionally zero policies (RPC-only access via SECURITY DEFINER functions, same trust boundary as guardian_active_child, see phase64_unified_account_profiles.sql)'
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
  'patient_guardians','practice_vertretung','patient_visits','lab_result_uploads','patient_lab_results',
  'guardian_active_child','doctor_hidden_chats','patient_rezepte','patient_ueberweisungen',
  'client_error_log','patient_pflegefreistellung','patient_arbeitsunfaehigkeit',
  'patient_vaccine_dismissals','consent_records','staff_pilot_login_links',
  'patient_account_profiles','patient_active_profile'
]) as t

order by check_type, name;
