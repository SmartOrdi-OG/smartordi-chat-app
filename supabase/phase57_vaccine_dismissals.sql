-- ══════════════════════════════════════════════════════════════
-- Phase 57: patient_vaccine_dismissals
--
-- Backs the × button next to a due vaccine in doctor.html's Kartei Impfung
-- tab (vendor/kartei-impfung.js's populateKarteiImpfung()). The Dashboard's
-- own "Impfungen fällig" widget (and secretary.html's matching Übersicht
-- one) were dropped entirely on 2026-08-07 -- both doctor and patient
-- showed little real interest in that duplicate nagging surface -- leaving
-- the Kartei booklet as the one remaining place a due vaccine shows up.
-- This lets a doctor permanently hide a specific vaccine's due reminder for
-- a specific patient from there, instead of it resurfacing every time the
-- tab is opened.
--
-- One row per (patient, vaccine label) the doctor has dismissed. Keyed by
-- the vaccine's display label (e.g. "Grippeimpfung (Auffrischung)"), not a
-- specific due-date -- dueVaccinationsForPatient() in doctor.html
-- recomputes "next due" dynamically, so pinning to a date would make the
-- dismissal silently stop applying the moment that date rolls over even
-- though nothing about the doctor's actual intent changed. It only stops
-- applying once a NEW patient_impfungen entry advances the label itself
-- (e.g. "D2" becomes "D3"), which is the natural point a fresh reminder is
-- warranted again.
--
-- Run this in the Supabase SQL editor for this project
-- (https://ewilgwndhpxibkogxqbk.supabase.co), after phase56.
-- ══════════════════════════════════════════════════════════════

create table public.patient_vaccine_dismissals (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  vaccine_label text not null,
  dismissed_by text,           -- staff username (sessionStorage's smartordi_user.username), not a staff_profiles.id -- that's the only staff identifier actually available client-side at dismiss time
  dismissed_at timestamptz not null default now(),
  unique(patient_id, vaccine_label)
);
create index patient_vaccine_dismissals_patient_id_idx on public.patient_vaccine_dismissals(patient_id);

alter table public.patient_vaccine_dismissals enable row level security;
-- Same shape as patient_impfungen's own policy (phase5) -- broad staff
-- access, no anon policy => anon/patients get zero direct access (this is a
-- staff-only workflow, never surfaced to the patient-facing app).
create policy "staff full access to patient_vaccine_dismissals" on public.patient_vaccine_dismissals
  for all to authenticated using (true) with check (true);
