-- ══════════════════════════════════════════════════════════════
-- Phase 25: server-side validation for patient_documents uploads
--
-- uploadKarteiDocument()/uploadKarteiLaborDoc() in doctor.html only ever
-- checked file.type==='application/pdf' and file.size<=8MB in client-side
-- JavaScript before calling uploadPatientDocument() -- nothing on the
-- server enforced either limit. Since patient_documents grants any
-- authenticated staff member full direct insert access (see phase2's
-- "staff full access to patient_documents" policy), a modified/compromised
-- staff client -- or anyone with a valid session simply calling the
-- Supabase REST API directly, bypassing the app's own JS entirely -- could
-- insert a row with any MIME type or an arbitrarily large file_data blob.
--
-- Run this in the Supabase SQL editor for this project
-- (https://ewilgwndhpxibkogxqbk.supabase.co), after phase3.
--
-- Note: ADD CONSTRAINT validates every existing row immediately (not
-- deferred), so this will fail to apply if a row already violates it --
-- given the app itself never sent anything else, that shouldn't happen,
-- but check `select id, mime_type, length(file_data) from patient_documents
-- where file_data is not null and (mime_type <> 'application/pdf' or
-- length(file_data) > 11200000);` first if it does.
-- ══════════════════════════════════════════════════════════════

-- Every real upload the app has ever sent uses this exact MIME type
-- (mime_type defaults to 'application/pdf' even before the client-side
-- check runs) -- there is no legitimate other value to allow. Skipped
-- entirely for text-only quick notes (file_data is null there).
alter table public.patient_documents add constraint patient_documents_mime_type_pdf
  check (file_data is null or mime_type = 'application/pdf');

-- Bounds the ACTUAL stored payload's length, not the client-supplied
-- size_bytes column (which a direct API call could set to anything
-- regardless of what file_data actually contains). Base64 inflates raw
-- bytes by ~4/3, so an 8MB (8,388,608-byte) file is ~11,184,811 base64
-- characters; rounded up slightly for padding-character safety.
alter table public.patient_documents add constraint patient_documents_file_size_limit
  check (file_data is null or length(file_data) <= 11200000);
