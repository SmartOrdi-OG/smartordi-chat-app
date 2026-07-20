-- ══ Multi-tenant phase 5 (item #2 on the launch-readiness roadmap,
-- final piece): isolate patient_join_requests between practices ══
--
-- The user pasted this table's current RLS policies from the Supabase
-- dashboard (pg_policies), so this can now be done safely -- same
-- precondition as phase15 needed for staff_profiles/staff_invites:
--
--   policyname                          | cmd    | roles                  | qual | with_check
--   Anyone can submit a join request    | INSERT | {anon,authenticated}   | null | true
--   Staff can view join requests        | SELECT | {authenticated}        | true | null
--   Staff can update join request status| UPDATE | {authenticated}        | true | null
--
-- The SELECT/UPDATE policies are unscoped ("true" = every row, from every
-- practice, visible/editable by any logged-in staff member anywhere) --
-- that's the gap this phase closes. The INSERT policy is left exactly as
-- it is: a patient submitting a join request has no Supabase Auth session
-- at all (not even current_practice_id() has anything to resolve), so it
-- has to stay open to anon, same as today.
--
-- practice_id on this table is not new -- phase11 already added the
-- column and backfilled every existing row to the one practice that
-- existed at the time. What's missing is (a) new INSERT rows getting a
-- practice_id stamped at all, since patients have no auth.uid() for the
-- normal set_practice_id_from_staff() trigger to key off, and (b) the
-- RLS policies actually scoping by it.
--
-- Known, deliberate limitation carried forward from phase11/phase15: this
-- product has no "choose your practice" screen anywhere yet (patient-
-- login.html's join form doesn't ask which practice), and only one real
-- practice is live in production today. So the new insert trigger below
-- defaults practice_id to "the first/oldest practice" -- correct for
-- today's actual single-practice reality, but NOT a substitute for a real
-- practice-selection screen once a second practice actually goes live and
-- accepts patient self-registration. Revisit this the moment that happens.
--
-- Run this in the Supabase SQL editor, after phase11_multi_tenant_schema.sql.

alter table public.patient_join_requests add column if not exists practice_id uuid references public.practices(id);
update public.patient_join_requests set practice_id = (select id from public.practices order by created_at asc limit 1) where practice_id is null;

create or replace function public.set_join_request_practice_id()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.practice_id is null then
    new.practice_id := (select id from public.practices order by created_at asc limit 1);
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_set_join_request_practice_id on public.patient_join_requests;
create trigger trg_set_join_request_practice_id before insert on public.patient_join_requests
  for each row execute function public.set_join_request_practice_id();

drop policy if exists "Staff can view join requests" on public.patient_join_requests;
create policy "staff view own practice join requests" on public.patient_join_requests
  for select to authenticated using (practice_id = public.current_practice_id());

drop policy if exists "Staff can update join request status" on public.patient_join_requests;
create policy "staff update own practice join requests" on public.patient_join_requests
  for update to authenticated using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());

-- "Anyone can submit a join request" (INSERT, anon+authenticated, with
-- check true) is left untouched -- no code change needed, the trigger
-- above fills practice_id regardless of what RLS allows the inserter to
-- see.
