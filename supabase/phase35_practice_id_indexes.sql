-- ══════════════════════════════════════════════════════════════
-- Phase 35: indexes on practice_id
--
-- Fresh performance audit finding: every RLS policy added since
-- phase12_multi_tenant_rls.sql filters on `practice_id = current_practice_id()`
-- (patients, termine, patient_messages, patient_documents,
-- mkp_untersuchungen, patient_impfungen, staff_profiles, staff_invites,
-- patient_join_requests, patient_visits, patient_guardians,
-- doctor_hidden_chats) -- but NONE of these tables ever got an index on
-- practice_id itself (only audit_log did, in phase16_audit_log.sql).
--
-- Harmless for a single practice with a few thousand rows -- Postgres just
-- scans the whole (small) table. Becomes a real, worsening cost once many
-- practices share these same tables on one deployment: with no index,
-- every query has to sequentially scan the ENTIRE table across ALL
-- practices combined to find just this practice's rows, so every
-- practice's page load/search gets slower as OTHER practices' data grows,
-- not just its own. Plain single-column indexes (not composite) are enough
-- to fix the specific "full table scan across every practice" cost found;
-- no evidence of a more specific composite-index need was found.
--
-- Run this in the Supabase SQL editor.
-- ══════════════════════════════════════════════════════════════

create index if not exists patients_practice_id_idx on public.patients(practice_id);
create index if not exists termine_practice_id_idx on public.termine(practice_id);
create index if not exists patient_messages_practice_id_idx on public.patient_messages(practice_id);
create index if not exists patient_documents_practice_id_idx on public.patient_documents(practice_id);
create index if not exists mkp_untersuchungen_practice_id_idx on public.mkp_untersuchungen(practice_id);
create index if not exists patient_impfungen_practice_id_idx on public.patient_impfungen(practice_id);
create index if not exists staff_profiles_practice_id_idx on public.staff_profiles(practice_id);
create index if not exists staff_invites_practice_id_idx on public.staff_invites(practice_id);
create index if not exists patient_join_requests_practice_id_idx on public.patient_join_requests(practice_id);
create index if not exists patient_visits_practice_id_idx on public.patient_visits(practice_id);
create index if not exists patient_guardians_practice_id_idx on public.patient_guardians(practice_id);
create index if not exists doctor_hidden_chats_practice_id_idx on public.doctor_hidden_chats(practice_id);
