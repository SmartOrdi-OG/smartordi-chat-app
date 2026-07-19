-- ══ Phase 7: real visit-progress tracking on Termine ══
--
-- The Kalender's "now/next" highlighting previously guessed a visit's state
-- purely from the clock (current time vs. scheduled time/endTime). The
-- doctor pointed out this is unreliable in practice: they don't strictly
-- follow the scheduled order or duration, so a patient's slot showing as
-- "past" or "next" based on the clock alone can be flat wrong the moment
-- the day runs behind or a patient is seen out of order.
--
-- These two columns replace that guesswork with an explicit, doctor-driven
-- state: null/null = not started yet, started_at set = in progress right
-- now, completed_at set = done. Nothing here is inferred from the time of
-- day anymore. Run this in the Supabase SQL editor.

alter table public.termine add column if not exists started_at timestamptz;
alter table public.termine add column if not exists completed_at timestamptz;
