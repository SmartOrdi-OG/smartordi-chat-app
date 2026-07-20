-- ══ Enforce the 30-day trial lock server-side, not just client-side ══
--
-- doctor.html's trialLockOverlay (TRIAL_DAYS=30, applyTrialStatus()) is
-- currently a pure client-side check: once the trial has run out with no
-- payment_method on file, the UI blocks further use, but nothing stops a
-- technically capable user from opening the browser console and calling
-- the underlying sb.from(...) queries directly -- the database itself
-- still serves every request. This phase makes the real data access
-- itself refuse to work once the trial has lapsed, so the UI lock is a
-- courtesy, not the actual security boundary.
--
-- Scope, deliberately: the 6 tables gated by the existing "staff access
-- scoped to own practice" RLS policy from phase12 (patients, termine,
-- patient_messages, patient_documents, mkp_untersuchungen,
-- patient_impfungen) -- exactly the clinical/business data the trial is
-- meant to gate access to. NOT gated:
-- - `practices`/`staff_profiles` -- staff must still be able to log in,
--   see their own trial status, and submit a payment method to lift the
--   lock; locking these would make it impossible to ever pay and recover.
-- - `staff_invites`/`patient_join_requests` -- unrelated to this pass,
--   left alone to keep the change tightly scoped.
-- - Patient-facing RPCs (patient_book_termin, patient_send_message, ...)
--   run SECURITY DEFINER and therefore bypass RLS entirely -- gating
--   patient self-service during a lapsed trial is a real, separate
--   consideration (should a patient still be able to message/book while
--   their practice hasn't paid?) deliberately left for a future pass
--   rather than folded in here unreviewed.
--
-- Run this in the Supabase SQL editor, after phase12_multi_tenant_rls.sql.

create or replace function public.practice_trial_active(p_practice_id uuid)
returns boolean
language sql
security definer
stable
set search_path to 'public'
as $function$
  select coalesce(
    (select p.trial_start is null
            or p.payment_method is not null
            or now() < p.trial_start + interval '30 days'
     from public.practices p
     where p.id = p_practice_id),
    false
  );
$function$;

drop policy if exists "staff access scoped to own practice" on public.patients;
create policy "staff access scoped to own practice" on public.patients
  for all to authenticated
  using (practice_id = public.current_practice_id() and public.practice_trial_active(practice_id))
  with check (practice_id = public.current_practice_id() and public.practice_trial_active(practice_id));

drop policy if exists "staff access scoped to own practice" on public.termine;
create policy "staff access scoped to own practice" on public.termine
  for all to authenticated
  using (practice_id = public.current_practice_id() and public.practice_trial_active(practice_id))
  with check (practice_id = public.current_practice_id() and public.practice_trial_active(practice_id));

drop policy if exists "staff access scoped to own practice" on public.patient_messages;
create policy "staff access scoped to own practice" on public.patient_messages
  for all to authenticated
  using (practice_id = public.current_practice_id() and public.practice_trial_active(practice_id))
  with check (practice_id = public.current_practice_id() and public.practice_trial_active(practice_id));

drop policy if exists "staff access scoped to own practice" on public.patient_documents;
create policy "staff access scoped to own practice" on public.patient_documents
  for all to authenticated
  using (practice_id = public.current_practice_id() and public.practice_trial_active(practice_id))
  with check (practice_id = public.current_practice_id() and public.practice_trial_active(practice_id));

drop policy if exists "staff access scoped to own practice" on public.mkp_untersuchungen;
create policy "staff access scoped to own practice" on public.mkp_untersuchungen
  for all to authenticated
  using (practice_id = public.current_practice_id() and public.practice_trial_active(practice_id))
  with check (practice_id = public.current_practice_id() and public.practice_trial_active(practice_id));

drop policy if exists "staff access scoped to own practice" on public.patient_impfungen;
create policy "staff access scoped to own practice" on public.patient_impfungen
  for all to authenticated
  using (practice_id = public.current_practice_id() and public.practice_trial_active(practice_id))
  with check (practice_id = public.current_practice_id() and public.practice_trial_active(practice_id));
