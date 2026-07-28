-- ══════════════════════════════════════════════════════════════
-- Phase 36: search index + updated_at trigger for patients
--
-- First step of moving patient lookup/search away from "load every patient
-- into the browser and filter in JS" (which console.warn's past 3000 rows
-- in vendor/patient-data.js's refreshPatients()) toward real server-side
-- search. A live `ilike '%...%'` search needs its own index or the O(n)
-- scan just moves from JS to Postgres instead of actually going away --
-- same reasoning as phase35_practice_id_indexes.sql's own header comment.
-- patients_full_name_idx (phase1) is a plain btree, which only helps a
-- PREFIX search ('term%'), not the substring search ('%term%') a search-
-- as-you-type box needs -- hence the trigram index below.
--
-- Also adds a trigger to actually bump patients.updated_at on every
-- update -- it exists since phase1 but nothing ever set it past its
-- default (now() at insert time), so it has silently just equaled
-- created_at forever. A later phase needs a real "most recently active"
-- ordering to bound the initial patient list load to a sane default set;
-- that only works once this column means something.
--
-- Run this in the Supabase SQL editor.
-- ══════════════════════════════════════════════════════════════

create extension if not exists pg_trgm;

create index if not exists patients_full_name_trgm_idx
  on public.patients using gin (full_name gin_trgm_ops);
create index if not exists patients_svnr_trgm_idx
  on public.patients using gin (svnr gin_trgm_ops);

create or replace function public.set_patients_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_patients_updated_at on public.patients;
create trigger trg_patients_updated_at
  before update on public.patients
  for each row execute function public.set_patients_updated_at();
