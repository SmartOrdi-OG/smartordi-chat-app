-- ══ Multi-tenant phase 4 (item #2 on the launch-readiness roadmap,
-- continued): retire the single-row practice_settings table ══
--
-- practice_settings has a fixed primary key (id = true) -- it can only
-- ever hold ONE row, full stop, no matter what RLS says. phase11 already
-- copied that one row's data into the new `practices` table so every
-- other table would have something real to backfill onto, but the app
-- itself never switched over: vendor/staff-accounts.js's
-- refreshPracticeSettings()/savePracticeSettings() still read/write the
-- practice_settings singleton directly, and register.html still called
-- savePracticeSettings() for every brand-new practice's plan/trial/contact
-- info.
--
-- That is an active bug, not just future-proofing: every practice that
-- has registered since phase15 shipped has been upserting ITS OWN
-- adresse/tel/plan/trial_start into that SAME single row -- each new
-- practice silently overwrites every other practice's contact info and
-- plan, and every doctor's Einstellungen tab reads whichever practice
-- happened to save last, regardless of which practice they actually
-- belong to.
--
-- This phase adds the two columns `practices` was still missing
-- (trial_start, payment_method -- name/adresse/tel/plan already exist
-- since phase11) and backfills them for the one practice that existed
-- before this migration. The paired app-code change (same PR) rewires
-- refreshPracticeSettings()/savePracticeSettings() onto `practices`
-- (scoped correctly per-practice via the existing "view own
-- practice"/"update own practice" RLS policies from phase15 -- no new
-- policy needed here) and register.html now writes every field directly
-- into the practices row it creates, instead of a separate
-- practice_settings upsert.
--
-- The old practice_settings table is deliberately left in place (not
-- dropped) -- it's simply unused by the app after this ships. Safe to
-- drop it yourself later once you've confirmed everything still works.
--
-- Run this in the Supabase SQL editor, after phase15_staff_practice_rls.sql.

alter table public.practices add column if not exists trial_start timestamptz;
alter table public.practices add column if not exists payment_method text;

do $$
declare v_practice_id uuid;
begin
  select id into v_practice_id from public.practices order by created_at asc limit 1;
  if v_practice_id is not null then
    update public.practices p set
      trial_start = coalesce(p.trial_start, ps.trial_start),
      payment_method = coalesce(p.payment_method, ps.payment_method)
    from public.practice_settings ps
    where p.id = v_practice_id and ps.id = true;
  end if;
end $$;
