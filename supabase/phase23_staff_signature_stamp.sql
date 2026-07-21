-- ══ Persists a doctor's drawn/uploaded signature + practice stamp ══
--
-- saveSig()/the stamp upload handlers in doctor.html only ever set the
-- in-memory stempelDataUrl/sigDataUrl variables -- nothing wrote them
-- anywhere durable, so a "✓ gespeichert" signature vanished on the next
-- page reload or on any other device, despite the toast implying it had
-- actually been saved.
--
-- Lives on staff_profiles (NOT practices) -- a signature is a specific
-- DOCTOR'S own, not shared practice-wide, and a practice can have several
-- doctors (each with their own staff_profiles row already, e.g. fach).
-- Storing it on practices would make every doctor in a multi-doctor
-- practice silently overwrite each other's signature.
--
-- No RLS change needed: staff_profiles' existing "update within own
-- practice" policy (phase15) already covers this (same broad "any staff
-- at this practice can edit any staff row" model already used for every
-- other staff_profiles column) -- the app itself only ever updates a
-- doctor's own row via their own session id.
--
-- Run this in the Supabase SQL editor, after phase15_staff_practice_rls.sql.

alter table public.staff_profiles add column if not exists stempel_data_url text;
alter table public.staff_profiles add column if not exists sig_data_url text;
