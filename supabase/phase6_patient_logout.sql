-- ══ Phase 6: patient_logout — actually revoke the session token server-side ══
--
-- Security review finding: "logging out" in patient.html only ever cleared
-- the token from sessionStorage on the client (see logout() in patient.html).
-- The corresponding patient_sessions row was never deleted, so it stayed
-- valid for its full expires_at (default now()+30 days, set at insert time
-- in patient_login()). A token captured once -- e.g. via a stored-XSS
-- payload, or a session left open on a shared/public device -- remained
-- fully usable for up to 30 days after the patient believed they'd logged
-- out, since every other patient_* RPC only checks patient_id_from_token
-- (existence + not expired), with no way to tell "revoked" apart from
-- "just hasn't expired yet".
--
-- This adds a logout RPC that deletes the row outright, so a revoked token
-- fails patient_id_from_token's "not found" check on the very next call,
-- same as an expired one. Run this in the Supabase SQL editor.

create or replace function public.patient_logout(p_token uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from patient_sessions where token = p_token;
end;
$$;
grant execute on function public.patient_logout(uuid) to anon, authenticated;
