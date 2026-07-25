-- ══ Automatic appointment reminders (chat message, ~24h before) ══
--
-- Every existing appointment notification (confirm/cancel/move) only ever
-- fires when a secretary/doctor clicks a button -- nothing reminds a
-- patient on its own before the appointment gets close. This adds a
-- scheduled job (pg_cron) that checks, every 15 minutes, for confirmed
-- appointments happening in roughly 24 hours and sends a one-time
-- reminder as a normal chat message (patient_messages) -- same table/
-- shape the existing confirm/cancel messages already use (sendMessage
-- ToPatient() in vendor/patient-data.js never sets sent_by either, so a
-- reminder with no sent_by fits the established pattern, not a special
-- case), just server-initiated on a timer instead of button-initiated.
-- Every existing UI (doctor.html/secretary.html's realtime chat sync,
-- patient.html's ~25s poll) already reads patient_messages as-is, so this
-- needs zero app-code changes -- the message just shows up like any other.
--
-- Deliberately chat-only for now, not email/SMS: an in-chat message is
-- part of the same patient-practice communication channel every other
-- appointment notification already uses, so it needs no additional DSGVO
-- consent. Email/SMS reminders are a real, separate feature (need an
-- explicit opt-in captured from the patient first, plus -- for SMS -- a
-- new paid provider account) -- left for a later phase, see TODO.md.
--
-- Run this in the Supabase SQL editor. Enables the pg_cron extension if
-- it isn't already on for this project (Database > Extensions also works,
-- if this fails for permission reasons).

create extension if not exists pg_cron;

-- Tracks which appointments already got their one-time reminder, so the
-- job (running every 15 minutes) never sends the same one twice.
alter table public.termine add column if not exists reminder_sent_at timestamptz;

create or replace function public.send_termine_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  for r in
    select t.id, t.patient_id, t.time, t.art, t.practice_id
    from termine t
    where t.status = 'bestaetigt'
      and t.reminder_sent_at is null
      and t.patient_id is not null
      -- The appointment's real local timestamp (date+time are stored as
      -- Europe/Vienna wall-clock, not UTC) falls in the next ~24h-24h15m
      -- from now -- a window exactly as wide as this job's own 15-minute
      -- cadence, so every confirmed appointment gets exactly one
      -- reminder: no gap, no duplicate.
      and ((t.date + t.time::time) at time zone 'Europe/Vienna')
          between (now() + interval '24 hours') and (now() + interval '24 hours 15 minutes')
  loop
    insert into patient_messages(patient_id, dir, type, text, practice_id)
    values (
      r.patient_id, 'out', 'text',
      'Erinnerung: Sie haben morgen um ' || r.time || ' Uhr einen Termin (' || coalesce(r.art, 'Ordination') || ') bei uns. Bei Verhinderung bitte rechtzeitig absagen.',
      r.practice_id
    );
    update termine set reminder_sent_at = now() where id = r.id;
  end loop;
end;
$$;
-- Internal scheduled job only -- never callable by anon/authenticated.
revoke all on function public.send_termine_reminders() from public, anon, authenticated;

-- Idempotent: drops any previous schedule under this name first, so
-- re-running this file after an edit (e.g. changing the cadence) replaces
-- it cleanly instead of erroring or double-scheduling.
select cron.unschedule(jobid) from cron.job where jobname = 'send-termine-reminders';
select cron.schedule('send-termine-reminders', '*/15 * * * *', 'select public.send_termine_reminders();');
