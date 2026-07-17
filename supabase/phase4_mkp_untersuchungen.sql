-- ══════════════════════════════════════════════════════════════
-- Phase 4: MKP (Mutter-Kind-Pass) Untersuchungen
--
-- Digitizes the doctor's own record of the 13 standard Austrian pediatric
-- checkups (Mutter-Kind-Pass, "4.-7. Lebenswoche" through "58.-62.
-- Lebensmonat" -- birth/U1 exams happen at the hospital, out of scope
-- here). This is a staff-only record: the parents already carry the
-- official physical booklet (it's the legally recognized document, e.g.
-- for Familienbeihilfe), so this isn't meant to duplicate/replace that --
-- it's the doctor's own searchable, backed-up copy with automatic
-- due-date tracking, never shown to the patient. No RPCs, no anon policy
-- at all -- only staff (authenticated) ever touch this table.
--
-- Each exam type's specific fields vary hugely (from ~5 fields to 30+),
-- so they're stored as jsonb (`data`) rather than one rigid column per
-- field -- the field list per exam_key is defined in doctor.html's
-- MKP_EXAMS, not enforced by the DB schema.
--
-- Run this in the Supabase SQL editor for this project
-- (https://ewilgwndhpxibkogxqbk.supabase.co), after phase1-3.
-- ══════════════════════════════════════════════════════════════

create table public.mkp_untersuchungen (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  exam_key text not null,
  data jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  uploaded_by uuid references public.staff_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(patient_id, exam_key)
);
create index mkp_untersuchungen_patient_id_idx on public.mkp_untersuchungen(patient_id);

alter table public.mkp_untersuchungen enable row level security;
create policy "staff full access to mkp_untersuchungen" on public.mkp_untersuchungen
  for all to authenticated using (true) with check (true);
-- Deliberately no anon policy -- staff-only feature, never read by patient.html.
