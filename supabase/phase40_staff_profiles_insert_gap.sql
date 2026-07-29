-- ══════════════════════════════════════════════════════════════
-- Phase 40: close a real cross-tenant privilege-escalation gap in
-- staff_profiles' own INSERT policy
--
-- phase15_staff_practice_rls.sql's "insert own profile" policy was:
--   for insert to authenticated with check (id = auth.uid());
-- That only proves the new row's id is your own -- it places NO constraint
-- on the row's practice_id at all. Any authenticated Supabase user (e.g.
-- someone who just self-registered their own free practice via
-- register.html, a trivial bar to clear) could instead call
--   sb.from('staff_profiles').insert({id: <own auth uid>,
--     practice_id: <ANY existing practice's id>, role:'arzt', is_admin:true, ...})
-- directly -- since current_practice_id() (phase12) resolves from this same
-- row, that single insert grants full staff access (patients, termine,
-- messages, documents, visits, rezepte/ueberweisungen, Vertretung, ...) to
-- any target practice whose UUID the attacker obtains. Found during a full
-- app-wide bug/security audit (2026-07-29), not previously caught by any
-- test since the test suite runs against a mocked Supabase client, never
-- real RLS.
--
-- Fix: only allow the self-insert when it's genuinely the FIRST staff
-- member for that practice_id -- i.e. the bootstrap moment register.html
-- relies on (it always creates a brand-new, empty practices row first, then
-- inserts this practice's very first staff_profiles row against that
-- brand-new id -- see register.html's own comment above that insert). Any
-- EXISTING, populated practice already has >=1 staff_profiles row, so an
-- attacker targeting one now fails this check. The app has no
-- staff-removal feature (confirmed: no DELETE against staff_profiles
-- anywhere in the client code), so a real practice can never drop back to
-- zero staff and reopen this window.
--
-- Run this in the Supabase SQL editor, after phase15_staff_practice_rls.sql.
-- ══════════════════════════════════════════════════════════════

drop policy if exists "insert own profile" on public.staff_profiles;
create policy "insert own profile" on public.staff_profiles
  for insert to authenticated with check (
    id = auth.uid()
    and not exists (
      select 1 from public.staff_profiles sp where sp.practice_id = staff_profiles.practice_id
    )
  );
