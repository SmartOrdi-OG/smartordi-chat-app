-- Real gap found during a feature request: register.html's DSGVO/AGB
-- checkbox and patient-login.html's own AGB/Datenschutz checkbox (join-
-- request flow) both only ever gated their submit button client-side --
-- neither box's checked state was ever written anywhere. "DSGVO-
-- Einwilligung ✓ Erteilt" on patient.html's own Profil screen is (still)
-- just a hardcoded label, not backed by any real record.
--
-- consent_records is the real, timestamped, append-only evidence trail:
-- who agreed, to which exact privacy-policy version (datenschutz.html's
-- own "Version 2.1" string -- keep POLICY_VERSION in register.html/
-- patient-login.html in sync with that page whenever it's revised), and
-- when. Same "nobody -- staff included -- can edit or delete a row"
-- principle as audit_log (phase16): no insert/update/delete policy exists
-- for any role, so the only way in is record_consent() below, which runs
-- as security definer.
create table if not exists public.consent_records (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid references public.practices(id),
  consent_type text not null check (consent_type in ('doctor_registration','patient_join_request')),
  full_name text not null,
  email text,
  policy_version text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists consent_records_practice_id_idx on public.consent_records(practice_id, created_at desc);

alter table public.consent_records enable row level security;

-- Staff can review their own practice's consent history -- e.g. to answer
-- a real DSGVO audit request ("show me proof this patient agreed").
create policy consent_records_select_own_practice on public.consent_records
  for select to authenticated
  using (practice_id = current_practice_id());

-- Callable by BOTH an already-authenticated doctor (register.html, right
-- after sb.auth.signUp()) and a fully anonymous patient (patient-login.
-- html's "Anmeldung beantragen" join-request flow runs pre-auth, same as
-- the patient_join_requests insert it happens alongside) -- security
-- definer so it can write despite RLS blocking every direct insert, same
-- trust-boundary reasoning already used by patient_login_precheck() and
-- every other anon-callable RPC in this codebase: this one only ever
-- writes a row, never returns or exposes anything sensitive.
create or replace function public.record_consent(
  p_practice_id uuid, p_consent_type text, p_full_name text,
  p_email text, p_policy_version text, p_user_agent text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.consent_records(practice_id, consent_type, full_name, email, policy_version, user_agent)
  values (p_practice_id, p_consent_type, p_full_name, p_email, p_policy_version, p_user_agent)
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.record_consent(uuid,text,text,text,text,text) to anon, authenticated;
