-- ══════════════════════════════════════════════════════════════
-- Phase 69: expose Mutter-Kind-Pass (MKP) exams to the child's own
-- patient.html, read-only
--
-- Real user feedback (2026-08-12): phase4_mkp_untersuchungen.sql
-- deliberately made this table staff-only, on the assumption the parents
-- already carry the physical official booklet so there was no need to
-- duplicate it in the app. Reversed on explicit request -- what the
-- pediatrician fills in for a child should show up on the child's own
-- page too, without any ability to edit it. This does NOT touch
-- mkp_untersuchungen's own RLS (still zero anon/patient policies, staff
-- keeps sole write access) -- it only adds one new read-only, SECURITY
-- DEFINER RPC scoped to the CALLING patient's own current_patient_id(),
-- same trust boundary as every other patient_get_*() function.
--
-- Run this in the Supabase SQL editor, after phase4_mkp_untersuchungen.sql
-- and phase31_patient_auth.sql (current_patient_id()). Then run
-- schema_health_check.sql to confirm it applied cleanly.
-- ══════════════════════════════════════════════════════════════

create or replace function public.patient_get_mkp_exams()
returns table(exam_key text, data jsonb, completed_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_pid uuid;
begin
  v_pid := current_patient_id();
  if v_pid is null then return; end if;
  return query select m.exam_key, m.data, m.completed_at
    from mkp_untersuchungen m where m.patient_id = v_pid;
end;
$$;
grant execute on function public.patient_get_mkp_exams() to authenticated;
