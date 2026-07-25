-- ══ Let the secretary configure real practice opening days/hours ══
--
-- Every booking flow (secretary's two "new termin" forms, the patient's own
-- self-booking calendar) has always assumed a single hardcoded schedule --
-- Mon-Fri, 08:00-11:30 and 14:00-16:00 (PRACTICE_TIME_SLOTS in
-- vendor/staff-accounts.js) -- with no way for a practice with different
-- hours to change it. This adds one jsonb column on `practices` so the
-- secretary can set it per-day from the UI, instead of it being fixed in
-- the app's own code.
--
-- Shape: {"mon":{"open":true,"blocks":[["08:00","11:30"],["14:00","16:00"]]},
--          "tue":{...}, ..., "sun":{"open":false,"blocks":[]}}
-- A practice that never opens the new Öffnungszeiten settings has
-- working_hours = null -- the app falls back to the same fixed schedule
-- every practice used before this existed (DEFAULT_WORKING_HOURS in
-- vendor/staff-accounts.js), so nothing changes for anyone until they
-- actually configure it.
--
-- Run this in the Supabase SQL editor.

alter table public.practices add column if not exists working_hours jsonb;

-- Patients have no direct table access to `practices` at all (RLS grants
-- none to anon) -- same reasoning as every other patient-facing RPC in
-- vendor/patient-portal-data.js. Resolves the patient's own practice via
-- their token, so a patient only ever sees their own practice's hours.
create or replace function public.patient_get_working_hours(p_token uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_patient_id uuid; v_practice_id uuid; v_hours jsonb;
begin
  v_patient_id := patient_id_from_token(p_token);
  if v_patient_id is null then return null; end if;
  select practice_id into v_practice_id from patients where id = v_patient_id;
  select working_hours into v_hours from practices where id = v_practice_id;
  return v_hours;
end;
$$;
grant execute on function public.patient_get_working_hours(uuid) to anon, authenticated;
