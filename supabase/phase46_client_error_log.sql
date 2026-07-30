-- ══ Central, cross-practice client-error log ══
--
-- The app already has a "critical data failed to load" mechanism
-- (reportCriticalDataError()/setCriticalDataErrorHandler(), vendor/staff-
-- accounts.js) that shows a red banner in doctor.html/secretary.html when a
-- refresh*() call fails. The user asked a real question after seeing that
-- explained: "where would I see this if I wasn't at the practice?" -- and
-- the honest answer was nowhere. That banner is 100% local to whichever
-- browser tab happened to be open the moment the failure occurred; nothing
-- about it reaches the platform owner (this app's operator, not any one
-- practice's own staff) once real, unattended practices are running this
-- day-to-day.
--
-- This migration adds a table for the SAME failures to also land in,
-- centrally, across every practice -- readable by the owner directly via
-- the Supabase dashboard/SQL editor at any time, regardless of which
-- practice's device the error actually happened on. It is deliberately NOT
-- a new in-app "view other practices' errors" screen (that would need an
-- entirely new platform-admin role/auth path this project doesn't have),
-- just a queryable log the owner already has full access to as the
-- Supabase project's own owner.
--
-- Run this in the Supabase SQL editor, after phase12_multi_tenant_rls.sql
-- (reuses its set_practice_id_from_staff() trigger function).

create table if not exists public.client_error_log (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid references public.practices(id),
  staff_id uuid references public.staff_profiles(id) default auth.uid(),
  page text,
  context text not null,
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.client_error_log enable row level security;

drop trigger if exists trg_set_practice_id on public.client_error_log;
create trigger trg_set_practice_id before insert on public.client_error_log
  for each row execute function public.set_practice_id_from_staff();

-- INSERT-only, and deliberately no SELECT/UPDATE/DELETE policy for
-- `authenticated` at all -- an individual practice's own staff have no
-- business reading (or worse, deleting) this cross-practice diagnostic log;
-- only the project owner's own Supabase login (which bypasses RLS
-- entirely, being the project owner) can read it.
drop policy if exists "staff can log a client-side error" on public.client_error_log;
create policy "staff can log a client-side error" on public.client_error_log
  for insert to authenticated with check (true);
