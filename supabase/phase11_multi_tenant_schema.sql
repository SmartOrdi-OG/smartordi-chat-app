-- ══ Multi-tenant Phase 1: schema foundation (additive only -- no RLS or
-- application-code changes in this phase) ══
--
-- Every practice-scoped table (patients, termine, messages, documents,
-- vaccinations, staff, invites, join requests) has no practice_id at all --
-- there has only ever been ONE practice in the whole database, so every RLS
-- policy on these tables is simply "for all to authenticated using (true)":
-- any logged-in staff member can see every row in the entire database.
-- Before SmartOrdi can be sold to more than one independent practice, every
-- table needs a real practice_id boundary, and every RLS policy needs to
-- actually enforce it.
--
-- This is deliberately ONLY the first, low-risk slice of that work: it
-- creates the new `practices` table, migrates today's single practice into
-- it as the first row, and adds a nullable `practice_id` column (backfilled
-- to that first practice) to every table that will need one. It does NOT
-- touch any RLS policy and does NOT require any application-code change --
-- today's single practice keeps working exactly as before after running
-- this. Rewriting RLS to actually enforce the boundary (and updating every
-- staff-side query to filter/set practice_id) is a separate, later phase,
-- given how high the stakes are of getting a security/access boundary
-- wrong on a database that already holds real patient data.
--
-- Run this in the Supabase SQL editor.

create table if not exists public.practices (
  id uuid primary key default gen_random_uuid(),
  name text,
  adresse text,
  tel text,
  plan text,
  created_at timestamptz not null default now()
);

-- Migrates today's one-and-only practice_settings row (the fixed id=true
-- singleton) into a real practices row, so every table below has something
-- real to backfill onto. Safe to run more than once -- only inserts while
-- practices is still empty.
insert into public.practices (name, adresse, tel, plan)
select 'Ordination', ps.adresse, ps.tel, ps.plan
from public.practice_settings ps
where ps.id = true
  and not exists (select 1 from public.practices);

alter table public.staff_profiles add column if not exists practice_id uuid references public.practices(id);
alter table public.patients add column if not exists practice_id uuid references public.practices(id);
alter table public.termine add column if not exists practice_id uuid references public.practices(id);
alter table public.patient_messages add column if not exists practice_id uuid references public.practices(id);
alter table public.patient_documents add column if not exists practice_id uuid references public.practices(id);
alter table public.mkp_untersuchungen add column if not exists practice_id uuid references public.practices(id);
alter table public.patient_impfungen add column if not exists practice_id uuid references public.practices(id);
alter table public.patient_join_requests add column if not exists practice_id uuid references public.practices(id);
alter table public.staff_invites add column if not exists practice_id uuid references public.practices(id);

-- Backfill: every existing row belongs to the one practice that existed
-- before this migration.
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
    update public.patient_join_requests set practice_id = v_practice_id where practice_id is null;
    update public.staff_invites set practice_id = v_practice_id where practice_id is null;
  end if;
end $$;
