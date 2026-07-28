-- Patient search-on-demand PR5 (see TODO.md): converting the CSV-import
-- patient-matching logic (secretary.html's findExistingPatientForImportRow)
-- to a live per-row server query instead of scanning the full in-memory
-- patient list requires an exact `svnr = <value>` match to actually be
-- correct. Today it isn't guaranteed to be: svnr is stored exactly as typed
-- (see secretary.html's own normalizeSvnr() comment -- "whitespace varies a
-- lot between legacy systems' exports", e.g. "1234 010190" vs "1234010190"),
-- so two rows that are really the same SVNr can differ as raw strings. This
-- normalizes svnr going forward (a write-time trigger) and backfills every
-- existing row once, so a plain equality match against the same
-- whitespace-stripped value is always correct from here on.

update public.patients
  set svnr = regexp_replace(svnr, '\s+', '', 'g')
  where svnr is not null and svnr ~ '\s';

create or replace function public.normalize_patient_svnr()
returns trigger language plpgsql as $$
begin
  if new.svnr is not null then
    new.svnr := regexp_replace(new.svnr, '\s+', '', 'g');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_normalize_patient_svnr on public.patients;
create trigger trg_normalize_patient_svnr
  before insert or update on public.patients
  for each row execute function public.normalize_patient_svnr();
