-- ══════════════════════════════════════════════════════════════
-- Phase 70: patient_lab_results (structured, numeric/text lab values)
--
-- Distinct from lab_result_uploads (phase24) -- that table is a PDF/
-- document upload inbox (a file waiting to be matched to a patient), not a
-- structured value. This table stores the actual measured value itself
-- (Bezeichnung/Wert/Ergebnis-Text/Gruppe), for cases where the source data
-- IS structured -- first consumer is the Normdatensatz (ENDS 1) import's
-- #L (Laborbefunde) block (see vendor/migration-normdatensatz.js), which
-- has no attached PDF to upload, just plain values from the old system.
--
-- Modeled on patient_rezepte (phase38_rezepte_ueberweisungen.sql):
-- practice_id + trg_set_practice_id trigger, staff-only RLS (no
-- patient-facing RPC -- same reasoning as Rezepte/Verlauf/MKP: patients
-- don't get a raw imported lab value pushed to them automatically).
--
-- Run this in the Supabase SQL editor, after phase12 (needs
-- public.current_practice_id() and public.set_practice_id_from_staff()).
-- ══════════════════════════════════════════════════════════════

create table public.patient_lab_results (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid references public.practices(id),
  patient_id uuid not null references public.patients(id) on delete cascade,
  datum date not null default current_date,
  bezeichnung text not null,
  wert numeric,
  ergebnis_text text,
  gruppe text,
  quelle text,
  created_by text,
  created_at timestamptz not null default now()
);
create index patient_lab_results_patient_id_idx on public.patient_lab_results(patient_id, datum desc);

alter table public.patient_lab_results enable row level security;
drop trigger if exists trg_set_practice_id on public.patient_lab_results;
create trigger trg_set_practice_id before insert on public.patient_lab_results
  for each row execute function public.set_practice_id_from_staff();
create policy "staff access scoped to own practice" on public.patient_lab_results
  for all to authenticated using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());
