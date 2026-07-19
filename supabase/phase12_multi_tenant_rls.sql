-- ══ Multi-tenant Phase 2: enforce the practice boundary via RLS ══
--
-- Phase 1 (phase11_multi_tenant_schema.sql) only added the practice_id
-- columns and backfilled them -- it changed zero access rules. This phase
-- is the part that actually matters: it rewrites RLS so a staff member can
-- only see/write rows belonging to THEIR OWN practice, instead of every
-- row in the entire database.
--
-- Scope of this phase, deliberately: patients, termine, patient_messages,
-- patient_documents, mkp_untersuchungen, patient_impfungen. These are every
-- table whose current INSERT paths are fully visible in this repo's own
-- SQL/JS (either a direct staff-side `sb.from(...).insert()` call, or one of
-- the patient-facing RPCs defined in phase1_patients_termine_messages.sql),
-- so it's possible to guarantee every new row gets a correct practice_id.
--
-- Deliberately NOT included yet: staff_profiles, staff_invites,
-- practice_settings, patient_join_requests. Their current insert/RPC paths
-- (register.html's direct staff_profiles insert is fine, but the team-invite
-- acceptance flow goes through a `consume_staff_invite` RPC, and the
-- self-registration flow through something like `check_join_request_status`)
-- predate this project's SQL version control -- their exact current bodies
-- aren't in this repo, so rewriting their RLS blind risks silently breaking
-- staff onboarding or patient self-registration. Paste those functions'
-- current `pg_get_functiondef(...)` output before that phase can be done
-- safely.
--
-- How new rows get the right practice_id without any application-code
-- changes: a BEFORE INSERT trigger auto-stamps practice_id from the
-- inserting STAFF member's own practice_id whenever it isn't already set.
-- That covers every staff-side insert (doctor.html/secretary.html never set
-- practice_id explicitly today). The two RPCs that let a PATIENT insert a
-- row directly (patient_send_message, patient_book_termin) are updated in
-- this same file to set practice_id explicitly from the patient's own
-- record instead -- a patient has no Supabase Auth session for the trigger
-- to resolve a staff practice_id from, so relying on the trigger there would
-- silently stamp NULL and make the row invisible to every staff member
-- (this is exactly the kind of regression this migration must not
-- reintroduce -- a patient's own message failing to reach the secretary
-- was a real bug fixed earlier this project).
--
-- Run this in the Supabase SQL editor, AFTER phase11_multi_tenant_schema.sql
-- has already been run.

-- Re-run the backfill in case any row was created in the gap between
-- running phase11 and this file (safe/idempotent either way).
do $$
declare v_practice_id uuid;
begin
  select id into v_practice_id from public.practices order by created_at asc limit 1;
  if v_practice_id is not null then
    update public.staff_profiles set practice_id = v_practice_id where practice_id is null;
    update public.patients set practice_id = v_practice_id where practice_id is null;
    update public.termine set practice_id = v_practice_id where practice_id is null;
    update public.patient_messages set practice_id = v_practice_id where practice_id is null;
    update public.patient_documents set practice_id = v_practice_id where practice_id is null;
    update public.mkp_untersuchungen set practice_id = v_practice_id where practice_id is null;
    update public.patient_impfungen set practice_id = v_practice_id where practice_id is null;
  end if;
end $$;

-- Resolves the CALLING (real Supabase Auth) staff member's own practice --
-- security definer so it can read staff_profiles regardless of that table's
-- own RLS (avoids a circular RLS evaluation, since staff_profiles' policy
-- doesn't use this function itself in this phase).
create or replace function public.current_practice_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select practice_id from public.staff_profiles where id = auth.uid();
$$;

create or replace function public.set_practice_id_from_staff()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.practice_id is null then
    new.practice_id := public.current_practice_id();
  end if;
  return new;
end;
$$;

-- ── practices ── (RLS was enabled with no policy in phase11; add the real
-- one now that current_practice_id() exists -- a staff member can only see/
-- edit their OWN practice's row, never another practice's.)
drop policy if exists "staff access scoped to own practice" on public.practices;
create policy "staff access scoped to own practice" on public.practices
  for all to authenticated using (id = public.current_practice_id())
  with check (id = public.current_practice_id());

-- ── patients ──
drop trigger if exists trg_set_practice_id on public.patients;
create trigger trg_set_practice_id before insert on public.patients
  for each row execute function public.set_practice_id_from_staff();
drop policy if exists "staff full access to patients" on public.patients;
create policy "staff access scoped to own practice" on public.patients
  for all to authenticated using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());

-- ── termine ── (also patient-booked via patient_book_termin, updated below)
drop trigger if exists trg_set_practice_id on public.termine;
create trigger trg_set_practice_id before insert on public.termine
  for each row execute function public.set_practice_id_from_staff();
drop policy if exists "staff full access to termine" on public.termine;
create policy "staff access scoped to own practice" on public.termine
  for all to authenticated using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());

-- ── patient_messages ── (also patient-sent via patient_send_message, updated below)
drop trigger if exists trg_set_practice_id on public.patient_messages;
create trigger trg_set_practice_id before insert on public.patient_messages
  for each row execute function public.set_practice_id_from_staff();
drop policy if exists "staff full access to patient_messages" on public.patient_messages;
create policy "staff access scoped to own practice" on public.patient_messages
  for all to authenticated using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());

-- ── patient_documents ── (staff-only inserts, no patient-facing insert RPC exists)
drop trigger if exists trg_set_practice_id on public.patient_documents;
create trigger trg_set_practice_id before insert on public.patient_documents
  for each row execute function public.set_practice_id_from_staff();
drop policy if exists "staff full access to patient_documents" on public.patient_documents;
create policy "staff access scoped to own practice" on public.patient_documents
  for all to authenticated using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());

-- ── mkp_untersuchungen ── (staff-only inserts)
drop trigger if exists trg_set_practice_id on public.mkp_untersuchungen;
create trigger trg_set_practice_id before insert on public.mkp_untersuchungen
  for each row execute function public.set_practice_id_from_staff();
drop policy if exists "staff full access to mkp_untersuchungen" on public.mkp_untersuchungen;
create policy "staff access scoped to own practice" on public.mkp_untersuchungen
  for all to authenticated using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());

-- ── patient_impfungen ── (staff-only inserts)
drop trigger if exists trg_set_practice_id on public.patient_impfungen;
create trigger trg_set_practice_id before insert on public.patient_impfungen
  for each row execute function public.set_practice_id_from_staff();
drop policy if exists "staff full access to patient_impfungen" on public.patient_impfungen;
create policy "staff access scoped to own practice" on public.patient_impfungen
  for all to authenticated using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());

-- ── Patient-facing RPCs that insert directly: give them the patient's own
-- practice_id explicitly (see the module comment above for why the trigger
-- alone isn't enough for these two). Bodies are otherwise byte-for-byte
-- identical to phase1_patients_termine_messages.sql.

create or replace function public.patient_send_message(p_token uuid, p_text text)
returns patient_messages
language plpgsql security definer set search_path = public as $$
declare v_pid uuid; v_practice_id uuid; v_row patient_messages;
begin
  v_pid := patient_id_from_token(p_token);
  if v_pid is null then raise exception 'invalid_or_expired_session'; end if;
  select practice_id into v_practice_id from patients where id = v_pid;
  insert into patient_messages(patient_id, dir, type, text, practice_id) values (v_pid, 'in', 'text', p_text, v_practice_id)
    returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.patient_send_message(uuid,text) to anon, authenticated;

create or replace function public.patient_book_termin(p_token uuid, p_arzt_id uuid, p_date date,
                                                        p_time text, p_end_time text, p_art text)
returns termine
language plpgsql security definer set search_path = public as $$
declare v_pid uuid; v_patient patients; v_row termine;
begin
  v_pid := patient_id_from_token(p_token);
  if v_pid is null then raise exception 'invalid_or_expired_session'; end if;
  select * into v_patient from patients where id = v_pid;
  if exists(select 1 from termine where arzt_id = p_arzt_id and date = p_date and time = p_time and status <> 'abgesagt') then
    raise exception 'slot_taken';
  end if;
  insert into termine(patient_id, patient_name, art, date, time, end_time, status, arzt_id, versicherung, tel, svnr, dob, practice_id)
    values (v_pid, v_patient.full_name, p_art, p_date, p_time, p_end_time, 'neu', p_arzt_id,
            v_patient.versicherung, v_patient.tel, v_patient.svnr, v_patient.dob, v_patient.practice_id)
    returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.patient_book_termin(uuid,uuid,date,text,text,text) to anon, authenticated;
