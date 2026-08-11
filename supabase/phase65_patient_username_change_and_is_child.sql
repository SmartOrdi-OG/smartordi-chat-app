-- ══════════════════════════════════════════════════════════════
-- Phase 65: patient-chosen username on first login + a simple "Kind"
-- classification flag on patients/patient_join_requests
--
-- Two independent, small fixes bundled together (real user feedback,
-- 2026-08-11):
--
-- 1) A patient's username used to be permanently whatever secretary.html's
--    "+ Neuer Patient"/QR flow auto-generated (slugified from their name,
--    e.g. "max.mustermann") -- easy to forget, especially since it's never
--    typed by the patient themselves at signup (they only ever scan a QR
--    and set a password). patient_change_username() lets a patient pick
--    their own, memorable one -- wired into patient-login.html's existing
--    first-login "Neues Passwort wählen" screen, alongside the password
--    field it already has.
--
-- 2) supabase/phase64_unified_account_profiles.sql's design deliberately
--    dropped the OLD "Kind" checkbox from secretary.html's "+ Neuer
--    Patient" (it used to create a whole separate guardian login --
--    superseded by that phase's unified-profile model). What it didn't
--    replace: a simple way to note in the patient's own record that this
--    is a child, for staff's own reference (shown in Stammdaten) -- not
--    tied to any account-creation mechanics at all this time, just a
--    plain classification column. patient_join_requests gets the same
--    column so a patient self-registering (or a parent using "Kind
--    hinzufügen") can set it too, carried through to the patients row on
--    approval by staff. patient_get_profile() (phase33) now also returns
--    it, so patient-login.html's mandatory first-login Anamnese can force
--    the pediatric (Kinderheilkunde) variant for a child's own account,
--    regardless of the practice's own Fachrichtung -- confirmed explicitly
--    (2026-08-11): a child linked to a general/non-pediatric practice
--    still needs the pediatric questions (Geburtsart, APGAR, Entwicklungs-
--    meilensteine, ...), not the adult Allgemeinanamnese.
--
-- Run this in the Supabase SQL editor, after phase31_patient_auth.sql
-- (current_patient_id()) and phase64_unified_account_profiles.sql. Then
-- run schema_health_check.sql to confirm it applied cleanly.
-- ══════════════════════════════════════════════════════════════

alter table public.patients add column if not exists is_child boolean not null default false;
alter table public.patient_join_requests add column if not exists is_child boolean;

-- Return type is changing (one extra column) -- create or replace alone
-- cannot do that in Postgres, the function has to be dropped first (same
-- pattern phase33_patient_login_cutover.sql itself already used for
-- patient_get_messages there).
drop function if exists public.patient_get_profile();
create or replace function public.patient_get_profile()
returns table(id uuid, username text, name text, full_name text, fach text, dob date,
              adresse text, tel text, email text, versicherung text, svnr text, first_login boolean,
              join_status text, join_note text, anamnese jsonb, is_child boolean)
language plpgsql security definer set search_path = public as $$
declare v_pid uuid;
begin
  v_pid := current_patient_id();
  if v_pid is null then return; end if;
  return query select p.id,p.username,p.name,p.full_name,p.fach,p.dob,p.adresse,p.tel,p.email,p.versicherung,p.svnr,p.first_login,
    p.join_status, p.join_note, p.anamnese, p.is_child
    from patients p where p.id = v_pid;
end;
$$;
grant execute on function public.patient_get_profile() to authenticated;

-- Lets the CALLING patient (current_patient_id()) change their own
-- username -- e.g. from a first-login screen, right after scanning a
-- staff-generated QR whose username they never chose themselves. Every
-- login lookup (patient_login_precheck() and every staff-side sb.from(
-- 'patients').eq('username',...) read) resolves username live at call
-- time, never caches it elsewhere -- safe to change at any point, no
-- stale references anywhere.
create or replace function public.patient_change_username(p_new_username text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_pid uuid; v_username text;
begin
  v_pid := current_patient_id();
  if v_pid is null then
    raise exception 'not_authenticated';
  end if;
  v_username := lower(trim(p_new_username));
  if v_username = '' or length(v_username) < 3 then
    raise exception 'username_too_short';
  end if;
  if exists(select 1 from public.patients where username = v_username and id <> v_pid) then
    raise exception 'username_taken';
  end if;
  update public.patients set username = v_username where id = v_pid;
  return true;
end;
$$;
grant execute on function public.patient_change_username(text) to authenticated;
