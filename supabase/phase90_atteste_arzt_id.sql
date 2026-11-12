-- ══════════════════════════════════════════════════════════════
-- Phase 90: patient_pflegefreistellung / patient_arbeitsunfaehigkeit
-- gain an issuing-doctor reference
--
-- Phase 21 of the secretary.html -> React port (secretary-app) adds a
-- doctor-picker for issuing these two Atteste when a practice has more
-- than one `arzt` account -- previously resolveAttestArztInfo() (both the
-- original vendor/kartei-atteste.js and its secretary-app port) just
-- picked "the first arzt found" with no way for the secretary to choose,
-- a limitation the original explicitly documented as unsupported.
--
-- Nullable: a practice with exactly one doctor never shows the picker
-- (nothing to choose), so every existing row and every single-doctor
-- practice's future rows stay null here -- this only gets populated when
-- the picker actually had a real choice to record.
--
-- Run this in the Supabase SQL editor, after phase51_atteste.sql.
-- ══════════════════════════════════════════════════════════════

alter table public.patient_pflegefreistellung add column if not exists arzt_id uuid references public.staff_profiles(id);
alter table public.patient_arbeitsunfaehigkeit add column if not exists arzt_id uuid references public.staff_profiles(id);
