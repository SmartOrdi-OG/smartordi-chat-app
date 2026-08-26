-- ══════════════════════════════════════════════════════════════
-- Phase 82: "Nicht erschienen" (no-show) as a real Termin status
--
-- Real gap found via competitor research (see TODO.md): 'abgesagt' only
-- ever meant "the patient cancelled in advance" -- there was no way to
-- record the distinct, more disruptive case of a patient simply never
-- showing up with no cancellation at all. The KBV (German panel-doctor
-- association) puts the real no-show rate at 10-20% of appointments.
-- Digging into tomedo's own user forum (a much bigger competitor) found
-- doctors there don't have a clean way to do this either -- multiple
-- threads ask how to mark a no-show or set up an Ausfallhonorar, with one
-- practice resorting to paper forms and a manual daily report just to
-- track it.
--
-- Tracking only for now (secretary.html's new noShowTermin()) -- no
-- billing/Ausfallhonorar automation, which is a separate, much bigger
-- feature (real invoicing + a legal basis/consent captured from the
-- patient first) left for a later phase if ever wanted.
--
-- termine.status already has a check constraint from
-- phase1_patients_termine_messages.sql restricting it to
-- ('neu','bestaetigt','abgesagt') -- this widens it to also allow
-- 'nicht_erschienen'. Postgres auto-named that original constraint
-- termine_status_check; dropped and recreated here rather than altered in
-- place (Postgres has no ALTER CONSTRAINT for a check's condition).
--
-- Run this in the Supabase SQL editor. Then run schema_health_check.sql to
-- confirm it applied cleanly.
-- ══════════════════════════════════════════════════════════════

alter table public.termine drop constraint if exists termine_status_check;
alter table public.termine add constraint termine_status_check
  check (status in ('neu','bestaetigt','abgesagt','nicht_erschienen'));
