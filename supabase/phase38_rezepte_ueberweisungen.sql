-- ══════════════════════════════════════════════════════════════
-- Phase 38: patient_rezepte + patient_ueberweisungen (structured storage)
--
-- Rezept (prescription) and Überweisung (referral) previously existed ONLY
-- as generated PDFs (patient_documents, category 'rezept'/'ueberweisung')
-- -- the actual medication names/dosages or referral destination/reason
-- lived only transiently in doctor.html's in-memory form fields at
-- generation time, never persisted structured (see TODO.md's ELGA
-- investigation). These two new tables store that same data structured,
-- alongside (not instead of) the existing generated PDF.
--
-- Modeled on patient_visits (phase27_patient_visits.sql): practice_id +
-- trg_set_practice_id trigger, staff-only RLS (no patient-facing RPC --
-- patients already see the generated PDF via patient_documents, same as
-- Verlauf/MKP/document uploads).
--
-- Deliberate deviation from patient_visits/patient_documents/patient_
-- impfungen/mkp_untersuchungen's own created_by/uploaded_by precedent
-- (uuid references staff_profiles(id)): every existing call site for
-- those columns actually passes session.username (a plain string), never
-- a real staff_profiles.id uuid -- this stores that username as plain
-- text instead of inventing a uuid FK relationship the app doesn't
-- actually populate. The other four tables' pre-existing mismatch is left
-- untouched here -- out of scope for this migration, flagged in TODO.md.
--
-- Run this in the Supabase SQL editor, after phase12 (needs
-- public.current_practice_id() and public.set_practice_id_from_staff()).
-- ══════════════════════════════════════════════════════════════

create table public.patient_rezepte (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid references public.practices(id),
  patient_id uuid not null references public.patients(id) on delete cascade,
  datum date not null default current_date,
  med1 text, packungen1 text, dosierung1 text,
  med2 text, packungen2 text, dosierung2 text,
  notizen text,
  rezeptgebuehrenbefreit boolean not null default false,
  document_id uuid references public.patient_documents(id) on delete set null,
  created_by text,
  created_at timestamptz not null default now()
);
create index patient_rezepte_patient_id_idx on public.patient_rezepte(patient_id, datum desc);

alter table public.patient_rezepte enable row level security;
drop trigger if exists trg_set_practice_id on public.patient_rezepte;
create trigger trg_set_practice_id before insert on public.patient_rezepte
  for each row execute function public.set_practice_id_from_staff();
create policy "staff access scoped to own practice" on public.patient_rezepte
  for all to authenticated using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());

create table public.patient_ueberweisungen (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid references public.practices(id),
  patient_id uuid not null references public.patients(id) on delete cascade,
  datum date not null default current_date,
  kostentraeger text,
  status_code text,
  von text,
  an text not null default '',
  fachrichtung text,
  dringlichkeit text,
  diagnose text,
  wegen text,
  notizen text,
  arbeitsunfaehig boolean not null default false,
  rezeptgebuehrenbefreit boolean not null default false,
  document_id uuid references public.patient_documents(id) on delete set null,
  created_by text,
  created_at timestamptz not null default now()
);
create index patient_ueberweisungen_patient_id_idx on public.patient_ueberweisungen(patient_id, datum desc);

alter table public.patient_ueberweisungen enable row level security;
drop trigger if exists trg_set_practice_id on public.patient_ueberweisungen;
create trigger trg_set_practice_id before insert on public.patient_ueberweisungen
  for each row execute function public.set_practice_id_from_staff();
create policy "staff access scoped to own practice" on public.patient_ueberweisungen
  for all to authenticated using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());
