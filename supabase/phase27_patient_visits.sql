-- ══════════════════════════════════════════════════════════════
-- Phase 27: patient_visits
--
-- Real bug found while adding test coverage for Kartei's "Verlauf" tab:
-- every logged visit (Neue Behandlung -- date/type/complaint/vitals/
-- diagnosis/notes/therapy) was kept in a plain in-memory JS array
-- (`const VISITS = []` in doctor.html) with NO table behind it at all.
-- A doctor's entire visit-history documentation for every patient was
-- silently lost on every page reload, and never appeared on another
-- device/browser -- this table + the doctor.html changes alongside it
-- fix that by making Verlauf entries real, persisted, multi-tenant rows,
-- same as every other Kartei tab (documents, lab results, MKP exams).
--
-- Staff-only, same access model as patient_documents/mkp_untersuchungen:
-- no anon/patient-facing RPC exists here -- patients never see the raw
-- internal visit log directly, only whatever a doctor explicitly sends
-- them via the "Bericht senden" (Patientenbericht) modal.
--
-- Run this in the Supabase SQL editor for this project, after phase12
-- (needs public.current_practice_id() and public.set_practice_id_from_staff()).
-- ══════════════════════════════════════════════════════════════

create table public.patient_visits (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid references public.practices(id),
  patient_id uuid not null references public.patients(id) on delete cascade,
  visit_date date not null,
  visit_type text not null,
  beschwerde text,
  temperature text,
  blutdruck text,
  schmerz text,
  diagnose text not null default '',
  notes text,
  therapy text,
  created_by uuid references public.staff_profiles(id),
  created_at timestamptz not null default now()
);
create index patient_visits_patient_id_idx on public.patient_visits(patient_id, visit_date desc);

alter table public.patient_visits enable row level security;

drop trigger if exists trg_set_practice_id on public.patient_visits;
create trigger trg_set_practice_id before insert on public.patient_visits
  for each row execute function public.set_practice_id_from_staff();

create policy "staff access scoped to own practice" on public.patient_visits
  for all to authenticated using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());
-- no anon policy => anon (patient sessions) gets zero direct access, same as patient_documents.
