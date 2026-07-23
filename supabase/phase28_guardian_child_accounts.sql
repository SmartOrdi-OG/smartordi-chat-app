-- ══════════════════════════════════════════════════════════════
-- Phase 28: real guardian/child accounts
--
-- Until now, a "guardian" account (a parent logging in on behalf of a
-- child patient too young to have their own login) only ever lived in
-- localStorage -- created via secretary.html's createChildPatientAccount(),
-- never synced to Supabase. It vanished on any device other than the one
-- that created it, and staff on a different browser never saw the child at
-- all. This phase makes both the guardian's own login and the guardian-
-- child link real.
--
-- Design: a CHILD is an ordinary row in `patients` -- they need the exact
-- same Kartei/appointments/messages/Anamnese infrastructure as any other
-- patient, so they get it for free by just being one. A new `guardian_id`
-- column links a child row to whoever logs in on their behalf. A GUARDIAN
-- is deliberately NOT a patient (no clinical data, shouldn't clutter the
-- staff "Patienten" search/list) -- they get their own small table and
-- session mechanism that mirrors patients/patient_sessions exactly.
--
-- Once a guardian logs in and picks which child to view, guardian_select_
-- child() mints a completely ordinary patient_sessions token for that
-- child. From that point on, the browser uses every existing patient_*
-- RPC completely unmodified, scoped to the child -- exactly like a real
-- patient session. No changes needed to patient_get_termine/patient_set_
-- anamnese/patient_set_symptoms/patient_send_message/etc.
--
-- Run this whole file once in the Supabase SQL editor for this project,
-- after every earlier phaseNN_*.sql file has already been run.
-- ══════════════════════════════════════════════════════════════

create table public.patient_guardians (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid references public.practices(id),
  username text unique not null,
  pw_hash text,                    -- bcrypt hash via crypt()/gen_salt('bf'); null = cannot log in yet
  temp_password text,              -- write-only staging column; reuses public.hash_patient_password() below
  first_login boolean not null default true,
  name text not null,
  full_name text not null,
  created_at timestamptz not null default now()
);

alter table public.patient_guardians enable row level security;

-- Same auto-stamp-practice_id-from-the-inserting-staff-member trigger
-- already used by patients/termine/etc (phase12) -- reused as-is, it only
-- needs a `practice_id` column to exist on the target table.
create trigger trg_set_practice_id before insert on public.patient_guardians
  for each row execute function public.set_practice_id_from_staff();

create policy "staff access scoped to own practice" on public.patient_guardians
  for all to authenticated using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());
-- Deliberately no anon policy -- a guardian has no Supabase Auth session,
-- same reasoning as patients: every guardian-facing operation below goes
-- through a SECURITY DEFINER RPC that resolves an opaque session token.

-- Same reusable hashing trigger already used by patients/patient_join_requests
-- (phase1) -- works on any table with temp_password/pw_hash columns.
create trigger trg_hash_guardian_password
  before insert or update of temp_password on public.patient_guardians
  for each row execute function public.hash_patient_password();

-- ── patients: link a child row to its guardian ──
alter table public.patients add column if not exists guardian_id uuid references public.patient_guardians(id);
create index if not exists patients_guardian_id_idx on public.patients(guardian_id);

-- ── guardian_sessions (mirrors patient_sessions exactly) ──
create table public.guardian_sessions (
  token uuid primary key default gen_random_uuid(),
  guardian_id uuid not null references public.patient_guardians(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  last_seen_at timestamptz not null default now()
);
alter table public.guardian_sessions enable row level security;
-- Deliberately no policies at all -- only SECURITY DEFINER functions owned
-- by postgres (BYPASSRLS) can touch this table, same as patient_sessions.

-- ══════════════════════════════════════════════════════════════
-- RPCs
-- ══════════════════════════════════════════════════════════════

create or replace function public.guardian_id_from_token(p_token uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select guardian_id into v_id from guardian_sessions
    where token = p_token and expires_at > now();
  if v_id is not null then
    update guardian_sessions set last_seen_at = now() where token = p_token;
  end if;
  return v_id;
end;
$$;
revoke all on function public.guardian_id_from_token(uuid) from public, anon, authenticated;

create or replace function public.guardian_login(p_username text, p_password text)
returns table(token uuid, guardian_id uuid, full_name text, name text, first_login boolean)
language plpgsql security definer set search_path = public as $$
declare v_g patient_guardians; v_token uuid;
begin
  select * into v_g from patient_guardians where username = lower(p_username);
  if not found or v_g.pw_hash is null
     or crypt(p_password, v_g.pw_hash) <> v_g.pw_hash then
    return; -- empty result set = invalid credentials, same contract as patient_login
  end if;
  insert into guardian_sessions(guardian_id) values (v_g.id) returning guardian_sessions.token into v_token;
  return query select v_token, v_g.id, v_g.full_name, v_g.name, v_g.first_login;
end;
$$;
grant execute on function public.guardian_login(text,text) to anon, authenticated;

create or replace function public.guardian_change_password(p_token uuid, p_new_password text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_gid uuid;
begin
  v_gid := guardian_id_from_token(p_token);
  if v_gid is null then return false; end if;
  if length(p_new_password) < 6 then raise exception 'password_too_short'; end if;
  update patient_guardians set temp_password = p_new_password, first_login = false where id = v_gid;
  return true;
end;
$$;
grant execute on function public.guardian_change_password(uuid,text) to anon, authenticated;

-- Every real child linked to this guardian -- includes `username` so the
-- browser can set a normal-looking local session identity once a child is
-- picked, same shape every other patient session already carries.
create or replace function public.guardian_get_children(p_token uuid)
returns table(id uuid, username text, name text, full_name text, fach text, dob date)
language plpgsql security definer set search_path = public as $$
declare v_gid uuid;
begin
  v_gid := guardian_id_from_token(p_token);
  if v_gid is null then return; end if;
  return query select p.id, p.username, p.name, p.full_name, p.fach, p.dob
    from patients p where p.guardian_id = v_gid order by p.full_name;
end;
$$;
grant execute on function public.guardian_get_children(uuid) to anon, authenticated;

-- Verifies the child actually belongs to this guardian, then mints an
-- ordinary patient_sessions token for it -- everything downstream
-- (patient_get_profile, patient_get_termine, patient_set_anamnese,
-- patient_set_symptoms, patient_send_message, patient_book_termin, ...)
-- then works completely unmodified, scoped to the child.
create or replace function public.guardian_select_child(p_token uuid, p_child_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_gid uuid; v_child patients; v_new_token uuid;
begin
  v_gid := guardian_id_from_token(p_token);
  if v_gid is null then return null; end if;
  select * into v_child from patients where id = p_child_id and guardian_id = v_gid;
  if not found then return null; end if;
  insert into patient_sessions(patient_id) values (v_child.id) returning patient_sessions.token into v_new_token;
  return v_new_token;
end;
$$;
grant execute on function public.guardian_select_child(uuid,uuid) to anon, authenticated;
