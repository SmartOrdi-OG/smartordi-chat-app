-- ══════════════════════════════════════════════════════════════
-- Phase 2: patient_documents
--
-- Lets a doctor upload a PDF they received about a patient (lab results,
-- referral letters, prescriptions) so the patient can see/download it from
-- their own account, on any device. Same architecture as Phase 1: staff
-- (authenticated) get full direct table access, patients (anon, no real
-- Supabase Auth yet) go through SECURITY DEFINER RPCs that resolve
-- patient_id from their existing opaque session token via
-- patient_id_from_token(), already created in
-- phase1_patients_termine_messages.sql -- run that file first if this
-- project hasn't yet.
--
-- Files are stored as base64 text directly in the row (file_data), not in
-- Supabase Storage: patients have no real Supabase Auth, so there is no
-- straightforward way to scope a signed Storage URL to "only this
-- patient's own files" without a server-side function anyway. Reusing the
-- same SECURITY DEFINER RPC pattern already proven for every other
-- patient-facing feature keeps this consistent and needs no new moving
-- parts (no Storage bucket policies, no signed URLs). Lab-result PDFs are
-- small (typically well under 1MB), so this comfortably fits Postgres'
-- TOAST storage. The app enforces an 8MB upload cap client-side.
--
-- Run this in the Supabase SQL editor for this project
-- (https://ewilgwndhpxibkogxqbk.supabase.co), after phase1.
-- ══════════════════════════════════════════════════════════════

create table public.patient_documents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  category text not null default 'sonstiges' check (category in ('befund','ueberweisung','rezept','sonstiges')),
  title text not null,
  filename text not null,
  mime_type text not null default 'application/pdf',
  size_bytes int not null,
  file_data text not null,         -- base64-encoded file bytes
  uploaded_by uuid references public.staff_profiles(id),
  created_at timestamptz not null default now()
);
create index patient_documents_patient_id_idx on public.patient_documents(patient_id, created_at);

alter table public.patient_documents enable row level security;
create policy "staff full access to patient_documents" on public.patient_documents
  for all to authenticated using (true) with check (true);
-- no anon policy => anon gets zero direct access, same as patients/termine/patient_messages;
-- patients read their own documents only through the RPCs below.

create or replace function public.patient_get_documents(p_token uuid)
returns table(id uuid, category text, title text, filename text, mime_type text,
              size_bytes int, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_pid uuid;
begin
  v_pid := patient_id_from_token(p_token);
  if v_pid is null then return; end if;
  return query select pd.id, pd.category, pd.title, pd.filename, pd.mime_type, pd.size_bytes, pd.created_at
    from patient_documents pd where pd.patient_id = v_pid order by pd.created_at desc;
end;
$$;
grant execute on function public.patient_get_documents(uuid) to anon, authenticated;

-- Separate from patient_get_documents on purpose: the list view has no
-- reason to pull every file's full base64 body over the wire, only the
-- one document the patient actually opens.
create or replace function public.patient_get_document_file(p_token uuid, p_doc_id uuid)
returns table(filename text, mime_type text, file_data text)
language plpgsql security definer set search_path = public as $$
declare v_pid uuid;
begin
  v_pid := patient_id_from_token(p_token);
  if v_pid is null then return; end if;
  return query select pd.filename, pd.mime_type, pd.file_data
    from patient_documents pd where pd.id = p_doc_id and pd.patient_id = v_pid;
end;
$$;
grant execute on function public.patient_get_document_file(uuid,uuid) to anon, authenticated;
