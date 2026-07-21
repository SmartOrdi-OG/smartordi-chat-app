-- ══ Lab result inbox: lets a practice give its labs a dedicated inbound
-- e-mail address instead of a doctor's personal one ══
--
-- Real labs already push results automatically from their own LIS to
-- whatever e-mail address the ordering doctor gave them -- nothing to
-- build or change on the lab's side. Each practice instead gets its own
-- address (lab-<token>@<inbound domain>, see vendor/staff-accounts.js's
-- labInboundEmailAddress()); the doctor gives THAT address to the lab
-- once (or forwards to it), and the supabase/functions/receive-lab-email
-- Edge Function -- invoked by the inbound-email provider's webhook, not
-- by the browser -- drops one row per e-mail attachment in here for a
-- doctor to review and attach to the right patient's file.
--
-- lab_email_token lives on practices (not a separate table) -- one
-- inbound address per practice is enough for now, same one-row-per-
-- practice shape as every other practice-wide setting.
--
-- Run this in the Supabase SQL editor, after phase18_practices_consolidation.sql.

alter table public.practices add column if not exists lab_email_token text unique;

create table if not exists public.lab_result_uploads (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),
  patient_name text,
  sender_email text,
  subject text,
  filename text,
  mime_type text,
  file_data text,
  status text not null default 'pending',
  matched_patient_id uuid references public.patients(id),
  created_at timestamptz not null default now()
);

alter table public.lab_result_uploads enable row level security;

-- No insert policy for authenticated/anon: every row is created by the
-- receive-lab-email Edge Function using the service-role key (bypasses
-- RLS entirely), since the inbound-email webhook has no Supabase user
-- session/JWT to satisfy a normal insert policy with.
create policy "view within own practice" on public.lab_result_uploads
  for select to authenticated using (practice_id = public.current_practice_id());
create policy "update within own practice" on public.lab_result_uploads
  for update to authenticated using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());
create policy "delete within own practice" on public.lab_result_uploads
  for delete to authenticated using (practice_id = public.current_practice_id());
