-- ══════════════════════════════════════════════════════════════
-- Phase 86: explicit Data API grants for every pre-existing table
--
-- Supabase notified the practice (2026-09-25) that starting 2026-10-30,
-- newly-created tables in the public schema no longer get Data API
-- privileges bootstrapped automatically -- every table needs its own
-- explicit GRANT to anon/authenticated/service_role, or PostgREST answers
-- "permission denied" for it.
--
-- Checked live against project ewilgwndhpxibkogxqbk before writing this:
-- right now every one of the 30 tables below already has full
-- select/insert/update/delete for all three roles, via a project-level
-- `alter default privileges ... grant ... on tables to anon, authenticated,
-- service_role` that Supabase set up automatically when this project was
-- created (visible in pg_default_acl). That's not retroactively revoked by
-- the Oct-30 change -- it only stops NEW objects from picking it up going
-- forward. So nothing is broken today.
--
-- The real risk is a full migration-history replay on a database that
-- never got that automatic bootstrap (a `db reset`, a fresh branch, a
-- project restore) done after 2026-10-30: every `create table` in every
-- phaseNN_*.sql file up to this point (phase85) was written assuming that
-- default-privilege mechanism would be there, so none of them carry their
-- own explicit grants. Replayed from scratch on a post-cutoff database,
-- every single one of those tables would come back with zero Data API
-- access.
--
-- Rather than editing ~85 historical migration files after the fact, this
-- one new migration grants the same privileges those tables already
-- effectively have today, so a from-scratch replay ends up in the same
-- working state regardless of whether the automatic default-privilege
-- bootstrap exists on the target database. Applying it against the live
-- project (which already has these grants) is a harmless no-op.
--
-- Deliberately matching the existing broad "grant everything at the table
-- level, let RLS be the real gate" pattern already used uniformly by every
-- one of these tables (confirmed live: even sensitive ones like
-- patient_rezepte, consent_records and audit_log grant full CRUD to anon,
-- which has zero matching RLS policy anywhere in this project and so never
-- gets real access) -- not retroactively tightening any of them here, to
-- avoid changing live behavior as a side effect of a grants-only migration.
-- patient_report_sends (phase85) is the one deliberate exception, and was
-- already fixed in place directly (least-privilege, since it's a new
-- table starting clean rather than inheriting the old default).
--
-- Going forward: every new phaseNN_*.sql that does `create table` should
-- add its own explicit grants right after, instead of relying on this
-- catch-up ever needing a sequel.
-- ══════════════════════════════════════════════════════════════

grant select, insert, update, delete on
  public.audit_log,
  public.client_error_log,
  public.consent_records,
  public.doctor_hidden_chats,
  public.guardian_active_child,
  public.guardian_sessions,
  public.lab_result_uploads,
  public.mkp_untersuchungen,
  public.patient_account_profiles,
  public.patient_active_profile,
  public.patient_arbeitsunfaehigkeit,
  public.patient_documents,
  public.patient_guardians,
  public.patient_impfungen,
  public.patient_join_requests,
  public.patient_lab_results,
  public.patient_messages,
  public.patient_pflegefreistellung,
  public.patient_rezepte,
  public.patient_sessions,
  public.patient_ueberweisungen,
  public.patient_vaccine_dismissals,
  public.patient_visits,
  public.patients,
  public.practice_vertretung,
  public.practices,
  public.staff_invites,
  public.staff_pilot_login_links,
  public.staff_profiles,
  public.termine
to anon, authenticated, service_role;
