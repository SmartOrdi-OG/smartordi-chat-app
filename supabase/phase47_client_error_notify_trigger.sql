-- ══ Fallback: call notify-client-error directly via pg_net, bypassing
-- Supabase's own "Database Webhooks" UI feature ══
--
-- The intended setup (documented in supabase/functions/notify-client-error/
-- index.ts) was a Database Webhook created via Dashboard -> Database ->
-- Webhooks. On this project, creating one fails with:
--   "Failed to create webhook: Failed to run sql query: ERROR: 3F000:
--    schema 'supabase_functions' does not exist"
-- supabase_functions is an internal schema Supabase normally provisions
-- automatically on every project specifically to support that UI feature --
-- this project appears to be missing it. That's a Supabase-side project
-- issue, not something in this app's own code; worth reporting to Supabase
-- support separately, but this migration works around it entirely so the
-- email alert doesn't have to wait on that ticket.
--
-- This calls the SAME Edge Function directly from a plain AFTER INSERT
-- trigger using the pg_net extension (enable it first: Database ->
-- Extensions -> pg_net) -- no supabase_functions schema involved at all.
--
-- Security note: the request below authenticates with the project's
-- PUBLIC anon key (the same one already embedded in every page's own
-- client-side <script> tag, e.g. vendor/staff-accounts.js's
-- SUPABASE_ANON_KEY -- not a secret, safe to commit) rather than the
-- service_role key a real Database Webhook would have used, since the
-- service_role key must never be committed to a file tracked in git,
-- unlike this migration. Accepted trade-off: anyone who already has this
-- (public) anon key could directly POST to notify-client-error and trigger
-- a fake alert email -- an annoyance (inbox spam), not a data-exposure
-- risk, since the function only ever forwards whatever body it's given
-- into an email, never reads or exposes real data. Revisit with a proper
-- shared-secret scheme if that ever becomes a real problem in practice.
--
-- Run this in the Supabase SQL editor, after phase46_client_error_log.sql
-- and after enabling pg_net (Database -> Extensions).

create or replace function public.notify_client_error()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://ewilgwndhpxibkogxqbk.supabase.co/functions/v1/notify-client-error',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3aWxnd25kaHB4aWJrb2d4cWJrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5NjEyMjUsImV4cCI6MjA5OTUzNzIyNX0.hZeILrp_GmOzZUImEtWhdbURLqDcvr5kB8KbhLPZvVM'
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'client_error_log',
      'schema', 'public',
      'record', jsonb_build_object(
        'context', new.context,
        'error_message', new.error_message,
        'page', new.page,
        'practice_id', new.practice_id,
        'staff_id', new.staff_id,
        'created_at', new.created_at
      )
    )
  );
  return new;
end;
$$;

drop trigger if exists trg_notify_client_error on public.client_error_log;
create trigger trg_notify_client_error after insert on public.client_error_log
  for each row execute function public.notify_client_error();
