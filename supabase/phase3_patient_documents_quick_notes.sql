-- ══════════════════════════════════════════════════════════════
-- Phase 3: quick text notes on patient_documents
--
-- Not every finding comes as an external PDF -- a quick in-office test
-- (e.g. a pediatrician doing a urine dipstick test right there in the
-- practice) has no report to upload, just a couple of values the doctor
-- wants to jot down. Lets a patient_documents row carry either a PDF
-- (file_data, as before) or a short free-text note (body_text), instead
-- of always requiring a file.
--
-- Run this in the Supabase SQL editor for this project
-- (https://ewilgwndhpxibkogxqbk.supabase.co), after phase1 and phase2.
-- ══════════════════════════════════════════════════════════════

alter table public.patient_documents alter column file_data drop not null;
alter table public.patient_documents alter column filename drop not null;
alter table public.patient_documents alter column mime_type drop not null;
alter table public.patient_documents alter column size_bytes drop not null;
alter table public.patient_documents add column if not exists body_text text;
alter table public.patient_documents add constraint patient_documents_has_content
  check (file_data is not null or body_text is not null);

-- Recreated (not just replaced) because the output column list is
-- changing -- Postgres doesn't allow CREATE OR REPLACE FUNCTION to alter
-- a function's return columns, only its body.
drop function if exists public.patient_get_documents(uuid);
create or replace function public.patient_get_documents(p_token uuid)
returns table(id uuid, category text, title text, filename text, mime_type text,
              size_bytes int, body_text text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_pid uuid;
begin
  v_pid := patient_id_from_token(p_token);
  if v_pid is null then return; end if;
  return query select pd.id, pd.category, pd.title, pd.filename, pd.mime_type, pd.size_bytes, pd.body_text, pd.created_at
    from patient_documents pd where pd.patient_id = v_pid order by pd.created_at desc;
end;
$$;
grant execute on function public.patient_get_documents(uuid) to anon, authenticated;
-- patient_get_document_file (fetches the base64 body for one PDF) is unchanged --
-- a text-only note has no file to fetch, the UI just doesn't call it for those.
