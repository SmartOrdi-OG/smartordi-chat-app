-- ══════════════════════════════════════════════════════════════
-- Phase 52: patient_ueberweisungen.an_adresse / an_tel
--
-- Adds the RECEIVING doctor/Krankenhaus's own Anschrift/Telefon to the
-- existing structured Überweisung record (phase38_rezepte_ueberweisungen.sql)
-- -- previously only their bare name ("an") was captured anywhere, so the
-- printed/downloaded referral letter had no way for the receiving office to
-- be reached back at, and nothing was persisted about it either. Both
-- columns are nullable free text, same as "an"/"von" already are -- a
-- doctor filling in this address/phone is optional, not every referral
-- needs it on hand.
--
-- Run this in the Supabase SQL editor, after phase38.
-- ══════════════════════════════════════════════════════════════

alter table public.patient_ueberweisungen add column if not exists an_adresse text;
alter table public.patient_ueberweisungen add column if not exists an_tel text;
