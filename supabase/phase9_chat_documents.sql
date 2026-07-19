-- ══ Phase 9: real document attachments in chat (fixes a critical bug) ══
--
-- Sending an Überweisung (referral) "via chat" was purely cosmetic: it just
-- appended a fake chat bubble directly to the sending doctor's own browser
-- DOM via setTimeout(), with no database write at all. The message appeared
-- once for whoever sent it, then vanished on the next refresh/reopen, and
-- never reached the secretary, the patient, or any other doctor who opened
-- that same patient's chat -- because nothing was ever actually saved or
-- transmitted anywhere. A patient could be told "you'll get a referral" and
-- never actually receive one.
--
-- patient_messages already had a 'doc'/'uw' type in its check constraint
-- (kept only for shape-compat with the old local-only demo, per that
-- column's original comment) but no columns to actually reference a real
-- uploaded file -- these three columns are what was missing to make a
-- document-attachment chat message real instead of decorative.
--
-- Run this in the Supabase SQL editor.

alter table public.patient_messages add column if not exists doc_id uuid references public.patient_documents(id) on delete set null;
alter table public.patient_messages add column if not exists filename text;
alter table public.patient_messages add column if not exists doc_sub text;
