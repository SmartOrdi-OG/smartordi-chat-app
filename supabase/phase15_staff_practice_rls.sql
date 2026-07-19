-- ══ Multi-tenant phase 3 / security audit follow-up: staff_profiles +
-- staff_invites practice isolation ══
--
-- Closes part of the gap flagged when phase12/phase13 deliberately left
-- staff_profiles/staff_invites/practice_settings/patient_join_requests
-- unscoped: those tables' insert paths went through RPCs
-- (consume_staff_invite, validate_staff_invite, check_join_request_status)
-- that predated this project's SQL version control. The user pasted their
-- current definitions from the Supabase dashboard, so this phase can now
-- safely cover staff_profiles and staff_invites.
--
-- practice_settings and patient_join_requests are DELIBERATELY still left
-- out of scope here:
-- - practice_settings' primary key is a fixed boolean (id=true) -- it can
--   only ever hold ONE row, period, regardless of RLS. It needs to be
--   migrated onto the real `practices` table (and retired) before scoping
--   it means anything; that's a bigger, separate migration.
-- - patient_join_requests is inserted by a completely anonymous visitor
--   (patient-login.html's self-registration form, before they have any
--   account or session at all) -- there's no "which practice does this
--   visitor mean" signal to derive practice_id from yet, since there's no
--   "choose your practice" screen in the product at all today (the same
--   single-practice limitation already noted elsewhere in this file).
--
-- Two different insert paths create a staff_profiles row, and they need
-- different treatment:
-- 1. register.html: a brand-new practice's first admin signs up directly
--    (sb.from('staff_profiles').insert(...)) -- there is no existing
--    practice_id to inherit here, since this IS the moment a new practice
--    comes into existence. register.html now creates the practices row
--    itself first and passes its id along explicitly.
-- 2. consume_staff_invite(): an invited colleague joining an EXISTING
--    practice -- practice_id comes from the invite itself (staff_invites
--    already carries it, via the same trigger used for other tables).
--
-- Run this in the Supabase SQL editor, after phase11/phase12/phase13/phase14.

-- ── practices: split the single "for all" policy from phase12 so a
-- brand-new user (no practice_id of their own yet) can still create their
-- OWN new practice row, while reading/editing an existing one stays scoped
-- to that practice's own staff only. ──
drop policy if exists "staff access scoped to own practice" on public.practices;
create policy "insert new practice" on public.practices
  for insert to authenticated with check (true);
create policy "view own practice" on public.practices
  for select to authenticated using (id = public.current_practice_id());
create policy "update own practice" on public.practices
  for update to authenticated using (id = public.current_practice_id())
  with check (id = public.current_practice_id());

-- ── staff_profiles: same bootstrap problem -- a just-signed-up user has no
-- practice_id yet (this insert creates their very first, and only, row),
-- so current_practice_id() would resolve to null for them at this exact
-- moment. Allow inserting only YOUR OWN row (id = auth.uid(), unforgeable),
-- then scope every other access to your own practice. ──
do $$
declare pol record;
begin
  for pol in select policyname from pg_policies where schemaname='public' and tablename='staff_profiles' loop
    execute format('drop policy %I on public.staff_profiles', pol.policyname);
  end loop;
end $$;
create policy "insert own profile" on public.staff_profiles
  for insert to authenticated with check (id = auth.uid());
create policy "view within own practice" on public.staff_profiles
  for select to authenticated using (practice_id = public.current_practice_id());
create policy "update within own practice" on public.staff_profiles
  for update to authenticated using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());

-- ── staff_invites: created only by an ALREADY-authenticated staff member
-- (doctor.html's "invite a colleague" flow) who already has a practice_id
-- of their own -- no bootstrap problem here, the standard auto-stamp
-- trigger from phase12 applies directly. ──
alter table public.staff_invites add column if not exists practice_id uuid references public.practices(id);
update public.staff_invites set practice_id = (select id from public.practices order by created_at asc limit 1) where practice_id is null;

drop trigger if exists trg_set_practice_id on public.staff_invites;
create trigger trg_set_practice_id before insert on public.staff_invites
  for each row execute function public.set_practice_id_from_staff();

do $$
declare pol record;
begin
  for pol in select policyname from pg_policies where schemaname='public' and tablename='staff_invites' loop
    execute format('drop policy %I on public.staff_invites', pol.policyname);
  end loop;
end $$;
create policy "staff access scoped to own practice" on public.staff_invites
  for all to authenticated using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());

-- ── consume_staff_invite: carry the invite's own practice_id onto the new
-- staff_profiles row it creates. Otherwise identical to the definition the
-- user pasted from their live database. ──
create or replace function public.consume_staff_invite(p_token text, p_user_id uuid, p_vorname text, p_nachname text)
returns boolean
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_role text;
  v_fach text;
  v_email text;
  v_practice_id uuid;
begin
  select role, fach, practice_id into v_role, v_fach, v_practice_id
  from public.staff_invites
  where token = p_token and used = false
  for update;

  if not found then
    return false;
  end if;

  update public.staff_invites
    set used = true, used_by = p_user_id
    where token = p_token;

  select email into v_email from auth.users where id = p_user_id;

  insert into public.staff_profiles (id, vorname, nachname, role, fach, is_admin, email, practice_id)
  values (p_user_id, p_vorname, p_nachname, v_role, v_fach, false, v_email, v_practice_id)
  on conflict (id) do nothing;

  return true;
end;
$function$;
