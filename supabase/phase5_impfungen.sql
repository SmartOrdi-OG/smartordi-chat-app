-- ══════════════════════════════════════════════════════════════
-- Phase 5: patient_impfungen (Impfkalender)
--
-- Replaces the local-only `impfungen` array that used to live on each
-- patient's localStorage account (see PR4's phase1 migration -- vaccination
-- records were deliberately left local back then, alongside anamnese/
-- diagnosen/allergie). Moving this to a real table now that the schedule
-- itself has been redone against the official Austrian Impfplan (33-page
-- PDF, version 2.1.0, 29/10/2025) rather than the old 7-vaccine/month-only
-- approximation.
--
-- One row per actually-administered dose (not one row per vaccine type),
-- matching how the doctor already records it: pick a vaccine, a dose label,
-- a date, an optional manual "next due" override, an optional batch number.
--
-- Unlike phase4 (MKP, staff-only -- parents keep the physical booklet as
-- the legally recognized document), vaccination status is exactly the kind
-- of thing parents actively want to see themselves (daycare/school proof),
-- so this table -- unusually for a clinical record in this app -- DOES get
-- a patient-facing RPC, same SECURITY DEFINER pattern as
-- patient_get_documents in phase2.
--
-- Run this in the Supabase SQL editor for this project
-- (https://ewilgwndhpxibkogxqbk.supabase.co), after phase1.
-- ══════════════════════════════════════════════════════════════

create table public.patient_impfungen (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  vaccine_key text,                -- matches a VACCINE_SCHEDULE key in doctor.html, null for free-text "Sonstige" entries
  vaccine_name text not null,      -- display name (kept even for known keys, so old rows survive schedule edits)
  dose_label text not null,        -- 'D1','D2','D3','A1','A2','Auffrischung','Einmaldosis', ...
  datum date not null,
  next_due date,                   -- optional manual override, used for adult-style boosters (Tetanus/FSME/Influenza)
  charge text,                     -- Chargennummer (batch number), optional
  uploaded_by uuid references public.staff_profiles(id),
  created_at timestamptz not null default now()
);
create index patient_impfungen_patient_id_idx on public.patient_impfungen(patient_id, datum desc);

alter table public.patient_impfungen enable row level security;
create policy "staff full access to patient_impfungen" on public.patient_impfungen
  for all to authenticated using (true) with check (true);
-- no anon policy => anon gets zero direct access, same as patient_documents;
-- patients read their own vaccination history only through the RPC below.

create or replace function public.patient_get_impfungen(p_token uuid)
returns table(id uuid, vaccine_key text, vaccine_name text, dose_label text,
              datum date, next_due date, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_pid uuid;
begin
  v_pid := patient_id_from_token(p_token);
  if v_pid is null then return; end if;
  return query select pi.id, pi.vaccine_key, pi.vaccine_name, pi.dose_label, pi.datum, pi.next_due, pi.created_at
    from patient_impfungen pi where pi.patient_id = v_pid order by pi.datum desc;
end;
$$;
grant execute on function public.patient_get_impfungen(uuid) to anon, authenticated;
