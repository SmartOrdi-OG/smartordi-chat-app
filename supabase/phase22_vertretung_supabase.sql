-- ══ Vertretung (absence + substitute-doctor notice) was still stored in
-- the browser's own localStorage, unlike every other piece of practice
-- data (patients, termine, staff, practices, ...) already migrated to
-- Supabase in earlier phases -- meaning a doctor's Vertretung set on one
-- device/browser was invisible on any other device (their phone, a
-- colleague's screen, etc.), and the "Vertretung: bis ..." indicator on
-- Dashboard could only ever reflect whatever this one browser happened to
-- have saved locally. Moves it onto a real, practice-scoped table.
--
-- Run this in the Supabase SQL editor, after phase12 (needs
-- current_practice_id()/set_practice_id_from_staff()) and phase15 (needs
-- staff_profiles.id = auth.uid()).

create table if not exists public.practice_vertretung (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid references public.practices(id),
  -- One row per doctor -- doctor.html always reads/writes "my own"
  -- Vertretung (currentDoctorUsername() = auth.uid()), never a colleague's,
  -- so a plain unique doctor id (not a composite key) matches how the app
  -- actually uses this table and makes upsert-by-doctor trivial.
  arzt_id uuid not null unique references public.staff_profiles(id),
  von date,
  bis date,
  mode text,
  internal_username uuid references public.staff_profiles(id),
  name text,
  fach text,
  adresse text,
  tel text,
  email text,
  sent_to jsonb not null default '[]'::jsonb,
  sent_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.practice_vertretung enable row level security;

drop trigger if exists trg_set_practice_id on public.practice_vertretung;
create trigger trg_set_practice_id before insert on public.practice_vertretung
  for each row execute function public.set_practice_id_from_staff();

-- Same broad "any staff member at this practice" access as patients/termine/
-- etc. elsewhere in this schema (e.g. so a secretary can see/adjust a
-- doctor's Vertretung too), not a stricter "only the owning doctor" rule --
-- consistent with every other practice-scoped table here.
drop policy if exists "staff access scoped to own practice" on public.practice_vertretung;
create policy "staff access scoped to own practice" on public.practice_vertretung
  for all to authenticated using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());
