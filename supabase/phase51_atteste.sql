-- ══════════════════════════════════════════════════════════════
-- Phase 51: patient_pflegefreistellung + patient_arbeitsunfaehigkeit
--
-- Two new official document types a doctor/secretary can generate for a
-- patient, alongside Rezept/Überweisung: "Antrag auf Pflegefreistellung"
-- (§ 16 UrlG -- care leave for a sick relative) and
-- "Arbeitsunfähigkeitsmeldung" (sick note). Same structured-storage
-- pattern as phase38_rezepte_ueberweisungen.sql: practice_id +
-- trg_set_practice_id trigger, staff-only RLS, created_by stored as plain
-- text (session.username), not a staff_profiles(id) FK -- same deliberate
-- deviation phase38 already documents.
--
-- patient_id on both tables is the person the DOCTOR is actually
-- certifying as sick/unable to work -- for Pflegefreistellung that's the
-- Angehörige (relative) named on the certificate, NOT the Antragsteller
-- (the working person requesting leave, who applies for it at their own
-- employer and may not be a patient of this practice at all -- stored as
-- free text instead of a patient/staff reference).
--
-- Run this in the Supabase SQL editor, after phase12 (needs
-- public.current_practice_id() and public.set_practice_id_from_staff()).
-- ══════════════════════════════════════════════════════════════

create table public.patient_pflegefreistellung (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid references public.practices(id),
  patient_id uuid not null references public.patients(id) on delete cascade,
  antragsteller_name text not null,
  verwandtschaftsverhaeltnis text not null,
  von date not null,
  bis date not null,
  ort text,
  ausstellungsdatum date not null default current_date,
  document_id uuid references public.patient_documents(id) on delete set null,
  created_by text,
  created_at timestamptz not null default now()
);
create index patient_pflegefreistellung_patient_id_idx on public.patient_pflegefreistellung(patient_id, ausstellungsdatum desc);

alter table public.patient_pflegefreistellung enable row level security;
drop trigger if exists trg_set_practice_id on public.patient_pflegefreistellung;
create trigger trg_set_practice_id before insert on public.patient_pflegefreistellung
  for each row execute function public.set_practice_id_from_staff();
create policy "staff access scoped to own practice" on public.patient_pflegefreistellung
  for all to authenticated using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());

create table public.patient_arbeitsunfaehigkeit (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid references public.practices(id),
  patient_id uuid not null references public.patients(id) on delete cascade,
  krankenstandsadresse text,
  von date not null,
  bis date not null,
  ausgehzeit_von text,
  ausgehzeit_bis text,
  bettruhe boolean not null default false,
  grund text not null default 'Krankheit',
  versicherungstraeger text,
  versicherungsnummer text,
  ausstellungsdatum date not null default current_date,
  document_id uuid references public.patient_documents(id) on delete set null,
  created_by text,
  created_at timestamptz not null default now()
);
create index patient_arbeitsunfaehigkeit_patient_id_idx on public.patient_arbeitsunfaehigkeit(patient_id, ausstellungsdatum desc);

alter table public.patient_arbeitsunfaehigkeit enable row level security;
drop trigger if exists trg_set_practice_id on public.patient_arbeitsunfaehigkeit;
create trigger trg_set_practice_id before insert on public.patient_arbeitsunfaehigkeit
  for each row execute function public.set_practice_id_from_staff();
create policy "staff access scoped to own practice" on public.patient_arbeitsunfaehigkeit
  for all to authenticated using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());
