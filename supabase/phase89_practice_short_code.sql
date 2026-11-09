-- ══════════════════════════════════════════════════════════════
-- Phase 89: short, typeable practice codes for the registration link
--
-- Real user feedback (2026-11-09): the React portal's new
-- /patient-register/<practiceId> deep link turned out LONGER than the old
-- ?practice=<uuid> query form it replaced -- the raw UUID dominates either
-- way, so swapping query-string noise for a clean path alone never
-- actually shortened anything. A short, random, human-typeable code
-- (6 chars, excluding visually ambiguous glyphs like 0/O/1/I/L) replacing
-- the UUID in the link is what actually shortens it.
--
-- Same SECURITY DEFINER + anon-callable pattern as the existing
-- public_get_practice_join_info() (phase.. self-registration RPCs) --
-- resolving a short code to a practice id is exactly as public as
-- resolving a practice id to its name/address already is.
-- ══════════════════════════════════════════════════════════════

alter table public.practices add column if not exists short_code text;

create unique index if not exists practices_short_code_key on public.practices (short_code);

create or replace function public.generate_practice_short_code()
returns text
language plpgsql
as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
  tries int := 0;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, floor(random() * length(alphabet) + 1)::int, 1);
    end loop;
    exit when not exists (select 1 from public.practices where short_code = code);
    tries := tries + 1;
    if tries > 50 then
      raise exception 'could not generate a unique practice short_code after % tries', tries;
    end if;
  end loop;
  return code;
end;
$$;

create or replace function public.set_practice_short_code()
returns trigger
language plpgsql
as $$
begin
  if new.short_code is null then
    new.short_code := public.generate_practice_short_code();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_practice_short_code on public.practices;
create trigger trg_practice_short_code
  before insert on public.practices
  for each row execute function public.set_practice_short_code();

-- Backfill every existing practice with a code of its own.
update public.practices set short_code = public.generate_practice_short_code() where short_code is null;

alter table public.practices alter column short_code set not null;

create or replace function public.public_resolve_practice_short_code(p_code text)
returns uuid
language sql
stable security definer
set search_path to 'public'
as $$
  select id from public.practices where short_code = upper(trim(p_code)) limit 1;
$$;
