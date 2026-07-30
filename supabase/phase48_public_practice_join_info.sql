-- ══ Fixes the "Ordination —" / "— · —" placeholder on patient-login.html's
-- "Anmeldung beantragen" (join-request) screen ══
--
-- Found during the practice_id-misrouting audit (2026-07-30, phase46/47's
-- sibling fix): this screen used to fill the clinic-name/address notice via
-- staffRosterReady/practiceSettingsReady (vendor/staff-accounts.js), both of
-- which do a direct sb.from('staff_profiles'/'practices').select(...) gated
-- by RLS policies scoped to `current_practice_id()` -- which itself resolves
-- to NULL for this screen's caller, since a self-registering visitor here is
-- always anonymous (no staff_profiles row, sometimes no session at all).
-- Same exact root cause as the staff-roster bug fixed in phase45
-- (patient_get_staff_roster()), just a cosmetic "—" placeholder here instead
-- of an empty dropdown -- the join request itself still submits and works
-- fine either way, this only ever affected what the visitor SEES before
-- submitting.
--
-- Callable by anon (this screen's caller is never authenticated at all), and
-- scoped by an EXPLICIT practice id -- the one secretary.html's QR code now
-- embeds in the /patient-register/<practiceId> deep link (see
-- phase19_patient_join_requests_rls.sql's own comment + the practice_id-
-- misrouting fix) -- rather than any session-derived id, since there is no
-- session to derive one from. An old QR code/link with no id still can't
-- know which practice to show info for; the client keeps showing "—" for
-- that case exactly as before, not a regression.
--
-- Deliberately returns ONLY what this screen already displays (practice
-- name/address, the admin doctor's name/Fachrichtung) -- nothing else about
-- the practice, patients, or staff.
--
-- Run this in the Supabase SQL editor, after phase11_multi_tenant_schema.sql
-- and phase15_staff_practice_rls.sql.

create or replace function public.public_get_practice_join_info(p_practice_id uuid)
returns table(practice_name text, adresse text, admin_full_name text, admin_fach text)
language sql
stable
security definer
set search_path = public
as $$
  select
    pr.name as practice_name,
    pr.adresse,
    sp.full_name as admin_full_name,
    sp.fach as admin_fach
  from public.practices pr
  left join public.staff_profiles sp
    on sp.practice_id = pr.id and sp.role = 'arzt' and sp.is_admin = true
  where pr.id = p_practice_id
  limit 1;
$$;

grant execute on function public.public_get_practice_join_info(uuid) to anon, authenticated;
