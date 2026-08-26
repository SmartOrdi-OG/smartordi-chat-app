-- Phase 84: closes 2 real gaps found right after phase83 shipped (real user
-- report, 2026-08-26: "الرسايل لسة بتوصل الماني حتى لما بغير اللغة" -- the
-- messages still arrive in German even after changing the language).
--
-- phase83_patient_message_translations.sql only ever covered the 6 fixed
-- chat messages sent by a doctor/secretary BUTTON click (Termin confirm/
-- move/cancel, Vertretung/address-change broadcasts, doctor transfer).
-- Re-auditing every `insert into patient_messages` in the whole codebase
-- (not just the JS senders originally found) turned up 3 more fixed/system
-- messages that were missed entirely:
--
--   1. send_termine_reminders() (this file) -- a pg_cron job (phase30) that
--      runs server-side, in Postgres, with no JS/app code involved at all --
--      so it was invisible to the original "grep the *.html/vendor/*.js
--      files for chat-message senders" sweep. This is almost certainly what
--      the user was actually looking at when they reported the bug: it's
--      the only one of the 3 missed messages the app sends completely on
--      its own, on a timer, so it's the one most likely to have actually
--      fired again since phase83 shipped.
--   2. notifyNextWaitingPatient() (vendor/patient-data.js) -- the "your turn
--      is approaching" waiting-room ping. Fixed in that same file, no SQL
--      needed for this one.
--   3. sendRecallReminder() (secretary.html) -- the "🔔 Erinnern" button on
--      the Kontrollpatienten-fällig list. Fixed in that file, no SQL needed
--      for this one either.
--
-- This migration only needs to touch #1 -- redefines send_termine_
-- reminders() to also write msg_key/msg_params (the two columns phase83
-- already added to patient_messages) alongside the unchanged German `text`
-- fallback, same pattern as every other sender. #2/#3 are pure client-code
-- fixes shipped alongside this file.

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
      and ((t.date + t.time::time) at time zone 'Europe/Vienna')
          between (now() + interval '24 hours') and (now() + interval '24 hours 15 minutes')
  loop
    insert into patient_messages(patient_id, dir, type, text, practice_id, msg_key, msg_params)
    values (
      r.patient_id, 'out', 'text',
      'Erinnerung: Sie haben morgen um ' || r.time || ' Uhr einen Termin (' || coalesce(r.art, 'Ordination') || ') bei uns. Bei Verhinderung bitte rechtzeitig absagen.',
      r.practice_id,
      'chat.system.terminReminder',
      jsonb_build_object('time', r.time, 'art', coalesce(r.art, 'Ordination'))
    );
    update termine set reminder_sent_at = now() where id = r.id;
  end loop;
end;
$$;
revoke all on function public.send_termine_reminders() from public, anon, authenticated;
