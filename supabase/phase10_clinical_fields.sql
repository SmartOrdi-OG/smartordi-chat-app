-- ══ Phase 10: real cross-device sync for core clinical fields ══
--
-- Diagnosen (diagnoses), Allergien (allergies), Blutgruppe (blood type) and
-- Krankengeschichte/Notizen (legacy history/notes) have been local-only
-- (browser localStorage) since the very first patients/termine/messages
-- migration in this project -- set once when a patient account is created
-- (manually or via CSV import) and never synced anywhere else. A diagnosis
-- entered/imported on one staff device was invisible on any other device
-- viewing the same patient's Kartei, including the doctor's own phone vs.
-- desktop.
--
-- Run this in the Supabase SQL editor.

alter table public.patients add column if not exists diagnosen text;
alter table public.patients add column if not exists allergie text;
alter table public.patients add column if not exists blutgruppe text;
alter table public.patients add column if not exists legacy_history text;
