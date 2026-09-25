-- ══════════════════════════════════════════════════════════════
-- Phase 85: audit log for "Bericht senden" e-mail sends
--
-- Real security gap flagged by the user (2026-09-25): sendKarteiReport()
-- (doctor.html) can e-mail a full medical report PDF (SVNR, Diagnosen,
-- Anamnese, Impfungen, Labor-Befunde...) either to the patient's own
-- on-file address, or to a free-typed EXTERNAL doctor's e-mail address
-- with zero verification -- a single typo could send sensitive health
-- data to the wrong inbox. This migration is the third and last part of
-- the fix (alongside the double-entry confirmation field and the
-- pre-send confirmation dialog, both pure front-end): a durable record of
-- every actual e-mail send, so a later inquiry ("who did we send this
-- patient's data to, and when?") has a real answer instead of nothing.
--
-- Deliberately client-inserted (doctor.html calls sb.from(...).insert()
-- itself, right after a successful send-report-email invoke), not written
-- from inside the send-report-email Edge Function -- same reasoning
-- patient_rezepte/patient_ueberweisungen (phase38) already established:
-- Edge Function (Deno) logic has no Playwright coverage in this project,
-- so a server-side-only log would make the "log itself is created
-- correctly" test requirement unverifiable. Client-side isn't a new trust
-- boundary either -- every other clinical record in this app (Rezept,
-- Überweisung, Atteste, Anamnese...) already gets its structured row
-- written this same way, by the same staff session that just used the
-- browser to do the real thing (send the e-mail).
--
-- Deliberately NOT append-and-editable like patient_rezepte/patient_
-- ueberweisungen ("for all" policy) -- an audit trail loses its whole
-- point if the account that made the entry can also quietly edit or
-- delete it later. Only SELECT and INSERT policies exist below; no
-- UPDATE/DELETE policy for anyone (RLS enabled + no matching policy for a
-- command denies it outright, even to the row's own inserting staff
-- member) -- same "nobody can edit an entry once written" guarantee
-- audit_log (phase16) already gives its own trigger-written rows, just
-- reached from the client-insert side instead of a trigger.
--
-- Run this in the Supabase SQL editor, after phase12 (needs
-- public.current_practice_id() and public.set_practice_id_from_staff()).
-- ══════════════════════════════════════════════════════════════

create table public.patient_report_sends (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid references public.practices(id),
  patient_id uuid not null references public.patients(id) on delete cascade,
  sent_by text,
  sent_to_email text not null,
  destination_type text not null check (destination_type in ('patient','doctor')),
  sections jsonb not null,
  created_at timestamptz not null default now()
);
create index patient_report_sends_patient_id_idx on public.patient_report_sends(patient_id, created_at desc);

alter table public.patient_report_sends enable row level security;
drop trigger if exists trg_set_practice_id on public.patient_report_sends;
create trigger trg_set_practice_id before insert on public.patient_report_sends
  for each row execute function public.set_practice_id_from_staff();

create policy "staff read own practice report-send log" on public.patient_report_sends
  for select to authenticated using (practice_id = public.current_practice_id());
create policy "staff insert own practice report-send log" on public.patient_report_sends
  for insert to authenticated with check (practice_id = public.current_practice_id());
-- Deliberately no update/delete policy -- see header comment above.
