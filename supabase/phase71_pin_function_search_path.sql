-- ══════════════════════════════════════════════════════════════
-- Phase 71: pin search_path on 3 trigger functions missing it
--
-- Found via Supabase's own security advisor (get_advisors, run directly
-- against the live project) -- not a user report. 3 trigger functions
-- (hash_patient_password, normalize_patient_svnr, set_patients_updated_at)
-- were created without `set search_path`, which the linter flags as
-- "function_search_path_mutable": a caller with CREATE privilege on some
-- schema earlier in the session's search_path could in theory shadow an
-- unqualified identifier the function relies on (e.g. a same-named
-- function/type) and change its behavior. All 3 are plain triggers (not
-- SECURITY DEFINER, no elevated privilege), so the real-world blast radius
-- here was already small -- but pinning search_path costs nothing and is
-- the same fix every other function in this project already has (see
-- e.g. phase12/phase13/phase14), so there's no reason for these 3 to be
-- the exception.
--
-- Logic is byte-for-byte identical to what's already deployed (verified by
-- reading pg_get_functiondef before writing this file) -- this migration
-- only adds `set search_path = public`, nothing else changes.
--
-- Run this in the Supabase SQL editor, then run schema_health_check.sql to
-- confirm it applied cleanly (though this migration touches no
-- table/column the health check tracks -- it's a same-signature function
-- redefinition, verifiable via the advisor re-run instead).
-- ══════════════════════════════════════════════════════════════

create or replace function public.hash_patient_password()
returns trigger
language plpgsql set search_path = public as $$
begin
  if new.temp_password is not null then
    new.pw_hash := crypt(new.temp_password, gen_salt('bf'));
    new.temp_password := null;
  end if;
  return new;
end;
$$;

create or replace function public.normalize_patient_svnr()
returns trigger
language plpgsql set search_path = public as $$
begin
  if new.svnr is not null then
    new.svnr := regexp_replace(new.svnr, '\s+', '', 'g');
  end if;
  return new;
end;
$$;

create or replace function public.set_patients_updated_at()
returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
