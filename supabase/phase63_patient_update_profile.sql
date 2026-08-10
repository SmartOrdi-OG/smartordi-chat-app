-- ══════════════════════════════════════════════════════════════
-- Phase 63: patient_update_profile() -- lets a patient/guardian edit their
-- own contact details (address/phone/email) from patient.html's new
-- Settings area.
--
-- Previously the ONLY way to change these was staff editing the patient's
-- Stammdaten in doctor.html/secretary.html on their behalf -- there was no
-- patient-facing way at all, even though patient_get_profile() has always
-- returned them. Deliberately scoped to just contact info, not every
-- editable-looking Profil field: name/Geburtsdatum/Versicherung/SV-Nummer
-- stay staff-controlled (identity/legal/insurance fields a patient
-- shouldn't be able to silently change on their own record).
--
-- Same SECURITY DEFINER RPC pattern as every other patient_* function --
-- RLS on patients still grants zero direct access to anon/authenticated-as-
-- patient (unchanged since phase12_multi_tenant_rls.sql/phase31_patient_
-- auth.sql's own header comment), so this is the only door in.
--
-- Run this in the Supabase SQL editor.
-- ══════════════════════════════════════════════════════════════

create or replace function public.patient_update_profile(p_adresse text, p_tel text, p_email text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_pid uuid;
begin
  v_pid := current_patient_id();
  if v_pid is null then return false; end if;
  update patients set
    adresse = nullif(trim(p_adresse), ''),
    tel = nullif(trim(p_tel), ''),
    email = nullif(trim(p_email), ''),
    updated_at = now()
  where id = v_pid;
  return found;
end;
$$;
grant execute on function public.patient_update_profile(text,text,text) to authenticated;
