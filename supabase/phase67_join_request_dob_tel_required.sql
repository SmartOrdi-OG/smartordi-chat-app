-- ══════════════════════════════════════════════════════════════
-- Phase 67: capture dob + tel on self-registration too
--
-- Real user feedback (2026-08-12, after a full walkthrough test): a
-- patient's Geburtsdatum/Telefon/Adresse were showing up empty ("—") on
-- real accounts. secretary.html's "+ Neuer Patient" modal already HAS
-- Geburtsdatum/Telefon fields (patients.dob/tel already exist, phase1) --
-- they were just optional, easy to skip past. patient-login.html's own
-- self-registration form (patient_join_requests) never asked for
-- Geburtsdatum/Telefon at all -- there was nowhere for the value to even
-- go. This adds the two missing columns; the app-side change (making all
-- three fields mandatory on both entry points, and adding the two new
-- inputs to the self-registration form) ships alongside this file.
--
-- Run this in the Supabase SQL editor, after phase1_patients_termine_
-- messages.sql. Then run schema_health_check.sql to confirm it applied
-- cleanly.
-- ══════════════════════════════════════════════════════════════

alter table public.patient_join_requests add column if not exists dob date;
alter table public.patient_join_requests add column if not exists tel text;
