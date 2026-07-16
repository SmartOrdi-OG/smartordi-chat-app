-- ══════════════════════════════════════════════════════════════
-- Phase 1: patients, patient_messages, termine, patient_sessions
--
-- Moves real patient accounts, appointments, and chat messages out of
-- per-browser localStorage into shared Supabase tables, so the same real
-- data is visible from any device (laptop, phone, home-screen PWA icon).
-- Staff (Supabase Auth "authenticated" role, already true for doctors and
-- secretaries) keep full direct table access, same as the existing
-- patient_join_requests policy. Patients have no real Supabase Auth yet,
-- so they get zero direct table access -- every patient-facing operation
-- goes through a SECURITY DEFINER RPC that resolves patient_id from an
-- opaque session token, mirroring the existing check_join_request_status/
-- validate_staff_invite pattern.
--
-- Run this whole file once in the Supabase SQL editor for this project
-- (https://ewilgwndhpxibkogxqbk.supabase.co).
-- ══════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── patients ──────────────────────────────────────────────────
create table public.patients (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  pw_hash text,                    -- bcrypt hash via crypt()/gen_salt('bf'); null = cannot log in yet
  temp_password text,              -- write-only staging column; a trigger hashes it into pw_hash and nulls it in the same statement
  first_login boolean not null default true,
  join_status text not null default 'approved' check (join_status in ('pending','approved','rejected')),
  join_note text,
  join_submitted_at timestamptz,
  name text not null,
  full_name text not null,
  fach text,
  dob date,
  adresse text,
  tel text,
  email text,
  versicherung text,
  svnr text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index patients_full_name_idx on public.patients(full_name);

alter table public.patients enable row level security;
create policy "staff full access to patients" on public.patients
  for all to authenticated using (true) with check (true);
-- no anon policy => anon gets zero direct access; anon must go through RPCs below.

-- Reusable hashing trigger (also used on patient_join_requests, see below)
create or replace function public.hash_patient_password()
returns trigger language plpgsql as $$
begin
  if new.temp_password is not null then
    new.pw_hash := crypt(new.temp_password, gen_salt('bf'));
    new.temp_password := null;
  end if;
  return new;
end;
$$;
create trigger trg_hash_patient_password
  before insert or update of temp_password on public.patients
  for each row execute function public.hash_patient_password();

-- ── patient_join_requests: add password-carrying columns ──────
-- (table already exists per a prior migration; these are additive)
alter table public.patient_join_requests add column if not exists temp_password text;
alter table public.patient_join_requests add column if not exists pw_hash text;
create trigger trg_hash_join_request_password
  before insert or update of temp_password on public.patient_join_requests
  for each row execute function public.hash_patient_password();

-- ── termine ───────────────────────────────────────────────────
create table public.termine (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,            -- the old client-generated 't_...' id, kept only so the one-time local-data upload can upsert idempotently
  patient_id uuid references public.patients(id),
  patient_name text not null,       -- display-cache/fallback for rows with no matching patients row (demo bookings, pre-migration legacy)
  art text,
  date date not null,
  time text not null,               -- kept as 'HH:MM' TEXT, not a Postgres time type -- every existing callsite does string equality/localeCompare on 'HH:MM'; a native time column would round-trip as 'HH:MM:SS' over PostgREST and silently break those comparisons.
  end_time text,
  status text not null default 'neu' check (status in ('neu','bestaetigt','abgesagt')),
  arzt_id uuid references public.staff_profiles(id),
  versicherung text,
  tel text,
  svnr text,
  dob date,
  reason text[],
  reason_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index termine_patient_id_idx on public.termine(patient_id);
create index termine_arzt_date_idx on public.termine(arzt_id, date);

alter table public.termine enable row level security;
create policy "staff full access to termine" on public.termine
  for all to authenticated using (true) with check (true);

-- ── patient_messages ──────────────────────────────────────────
create table public.patient_messages (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  dir text not null check (dir in ('in','out')),   -- 'in' = from patient, 'out' = from staff
  type text not null default 'text' check (type in ('text','voice','doc','uw')), -- non-text kept only for shape-compat with the legacy demo seed; Phase 1 never writes anything but 'text'
  text text,
  sent_by uuid references public.staff_profiles(id), -- who on staff sent it, null when dir='in'
  created_at timestamptz not null default now()
);
create index patient_messages_patient_id_idx on public.patient_messages(patient_id, created_at);

alter table public.patient_messages enable row level security;
create policy "staff full access to patient_messages" on public.patient_messages
  for all to authenticated using (true) with check (true);

-- ── patient_sessions ──────────────────────────────────────────
create table public.patient_sessions (
  token uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  last_seen_at timestamptz not null default now()
);
alter table public.patient_sessions enable row level security;
-- Deliberately NO policies at all -- neither anon nor authenticated gets any
-- direct access. Only SECURITY DEFINER functions owned by postgres (which
-- carries BYPASSRLS, same as validate_staff_invite/check_join_request_status
-- already rely on) can touch this table.

-- ── Realtime: staff pages need Postgres change notifications ──
alter publication supabase_realtime add table public.termine;
alter publication supabase_realtime add table public.patient_messages;

-- ══════════════════════════════════════════════════════════════
-- RPCs (anon-callable; every one resolves patient_id from an opaque
-- session token instead of trusting a client-supplied id)
-- ══════════════════════════════════════════════════════════════

-- internal helper -- NOT exposed to anon/authenticated directly, only
-- callable from within other SECURITY DEFINER functions owned by the same role
create or replace function public.patient_id_from_token(p_token uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select patient_id into v_id from patient_sessions
    where token = p_token and expires_at > now();
  if v_id is not null then
    update patient_sessions set last_seen_at = now() where token = p_token;
  end if;
  return v_id;
end;
$$;
revoke all on function public.patient_id_from_token(uuid) from public, anon, authenticated;

create or replace function public.patient_login(p_username text, p_password text)
returns table(token uuid, patient_id uuid, full_name text, name text,
              first_login boolean, join_status text, join_note text)
language plpgsql security definer set search_path = public as $$
declare v_patient patients; v_token uuid;
begin
  select * into v_patient from patients where username = lower(p_username);
  if not found or v_patient.pw_hash is null
     or crypt(p_password, v_patient.pw_hash) <> v_patient.pw_hash then
    return; -- empty result set = invalid credentials (same "no rows" contract as check_join_request_status)
  end if;
  if v_patient.join_status <> 'approved' then
    return query select null::uuid, v_patient.id, v_patient.full_name, v_patient.name,
                        v_patient.first_login, v_patient.join_status, v_patient.join_note;
    return;
  end if;
  insert into patient_sessions(patient_id) values (v_patient.id) returning patient_sessions.token into v_token;
  return query select v_token, v_patient.id, v_patient.full_name, v_patient.name,
                      v_patient.first_login, v_patient.join_status, v_patient.join_note;
end;
$$;
grant execute on function public.patient_login(text,text) to anon, authenticated;

create or replace function public.patient_change_password(p_token uuid, p_new_password text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_pid uuid;
begin
  v_pid := patient_id_from_token(p_token);
  if v_pid is null then return false; end if;
  if length(p_new_password) < 6 then raise exception 'password_too_short'; end if;
  update patients set pw_hash = crypt(p_new_password, gen_salt('bf')), first_login = false where id = v_pid;
  return true;
end;
$$;
grant execute on function public.patient_change_password(uuid,text) to anon, authenticated;

create or replace function public.patient_get_profile(p_token uuid)
returns table(id uuid, username text, name text, full_name text, fach text, dob date,
              adresse text, tel text, email text, versicherung text, svnr text, first_login boolean)
language plpgsql security definer set search_path = public as $$
declare v_pid uuid;
begin
  v_pid := patient_id_from_token(p_token);
  if v_pid is null then return; end if;
  return query select p.id,p.username,p.name,p.full_name,p.fach,p.dob,p.adresse,p.tel,p.email,p.versicherung,p.svnr,p.first_login
    from patients p where p.id = v_pid;
end;
$$;
grant execute on function public.patient_get_profile(uuid) to anon, authenticated;

create or replace function public.patient_get_messages(p_token uuid)
returns setof patient_messages
language plpgsql security definer set search_path = public as $$
declare v_pid uuid;
begin
  v_pid := patient_id_from_token(p_token);
  if v_pid is null then return; end if;
  return query select * from patient_messages where patient_id = v_pid order by created_at asc;
end;
$$;
grant execute on function public.patient_get_messages(uuid) to anon, authenticated;

create or replace function public.patient_send_message(p_token uuid, p_text text)
returns patient_messages
language plpgsql security definer set search_path = public as $$
declare v_pid uuid; v_row patient_messages;
begin
  v_pid := patient_id_from_token(p_token);
  if v_pid is null then raise exception 'invalid_or_expired_session'; end if;
  insert into patient_messages(patient_id, dir, type, text) values (v_pid, 'in', 'text', p_text)
    returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.patient_send_message(uuid,text) to anon, authenticated;

create or replace function public.patient_get_termine(p_token uuid)
returns setof termine
language plpgsql security definer set search_path = public as $$
declare v_pid uuid;
begin
  v_pid := patient_id_from_token(p_token);
  if v_pid is null then return; end if;
  return query select * from termine where patient_id = v_pid order by date, time;
end;
$$;
grant execute on function public.patient_get_termine(uuid) to anon, authenticated;

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
  insert into termine(patient_id, patient_name, art, date, time, end_time, status, arzt_id, versicherung, tel, svnr, dob)
    values (v_pid, v_patient.full_name, p_art, p_date, p_time, p_end_time, 'neu', p_arzt_id,
            v_patient.versicherung, v_patient.tel, v_patient.svnr, v_patient.dob)
    returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.patient_book_termin(uuid,uuid,date,text,text,text) to anon, authenticated;

create or replace function public.patient_set_symptoms(p_token uuid, p_termin_id uuid,
                                                          p_reason text[], p_reason_note text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_pid uuid;
begin
  v_pid := patient_id_from_token(p_token);
  if v_pid is null then return false; end if;
  update termine set reason = p_reason, reason_note = p_reason_note, updated_at = now()
    where id = p_termin_id and patient_id = v_pid;
  return found;
end;
$$;
grant execute on function public.patient_set_symptoms(uuid,uuid,text[],text) to anon, authenticated;
