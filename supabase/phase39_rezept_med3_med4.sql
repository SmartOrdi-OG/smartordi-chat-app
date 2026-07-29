-- ══════════════════════════════════════════════════════════════
-- Phase 39: patient_rezepte -- add Medikament 3 + 4 columns
--
-- patient_rezepte (phase38_rezepte_ueberweisungen.sql) only ever stored 2
-- medications (med1/med2 + their Packungen/Dosierung) -- doctor.html's
-- Rezept tab only had 2 fixed Medikament blocks. This adds a "+ Medikament
-- hinzufügen" button revealing up to 2 more (Medikament 3/4), so the table
-- needs matching columns to persist them structured, same pattern as
-- med1/med2.
--
-- Purely additive: new nullable columns, nothing backfilled, nothing else
-- changes. Existing rows (med3/med4 never set) just read NULL.
--
-- Run this in the Supabase SQL editor, after phase38_rezepte_ueberweisungen.sql.
-- ══════════════════════════════════════════════════════════════

alter table public.patient_rezepte
  add column if not exists med3 text,
  add column if not exists packungen3 text,
  add column if not exists dosierung3 text,
  add column if not exists med4 text,
  add column if not exists packungen4 text,
  add column if not exists dosierung4 text;
