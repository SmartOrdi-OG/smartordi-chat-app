-- ══ Practice-wide chat on/off switch + per-doctor "hide this patient's
-- chat from me" toggle ══
--
-- The whole feature came out of a user question: "what do we do if a
-- doctor doesn't want to use the chat at all?" Since the Praxis-Chat is one
-- shared conversation per patient (doctor + secretary both see the same
-- thread, not a separate one each -- see patient_messages, no per-staff
-- column), disabling it can only meaningfully be a PRACTICE-wide setting,
-- not a per-doctor one: if it only hid the tab for one doctor, the
-- practice's other staff and the patient would still be messaging into a
-- conversation that doctor never sees, which is worse than not having the
-- toggle at all. A practice with only one doctor is the common case this
-- was actually asked for, and there it's the same thing either way.
--
-- On top of that (and only meaningful while chat is enabled), a doctor can
-- separately hide/show individual patients' chats from their OWN view --
-- this one really is personal per-doctor preference (a colleague or the
-- secretary still sees/uses that same conversation normally), so it's a
-- genuinely different mechanism from the practice-wide switch above, not
-- a smaller version of it.
--
-- Run this in the Supabase SQL editor, after phase12 (current_practice_id(),
-- set_practice_id_from_staff()), phase15 (staff_profiles.id = auth.uid()),
-- and phase31/33 (current_patient_id()).

-- ══════════════════════════════════════════════════════════════
-- 1) Practice-wide switch
-- ══════════════════════════════════════════════════════════════

alter table public.practices add column if not exists chat_enabled boolean not null default true;

-- ══════════════════════════════════════════════════════════════
-- 2) Per-doctor hidden chats -- a hidden row means "this doctor doesn't
-- want to see this patient's chat"; deleting the row shows it again. RLS
-- is scoped strictly to the owning doctor (arzt_id = auth.uid()), unlike
-- practice_vertretung's deliberately broad "any staff at this practice"
-- policy -- a colleague must never be able to see or clear another
-- doctor's hidden-chat list.
-- ══════════════════════════════════════════════════════════════

create table if not exists public.doctor_hidden_chats (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid references public.practices(id),
  arzt_id uuid not null references public.staff_profiles(id),
  patient_id uuid not null references public.patients(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(arzt_id, patient_id)
);

alter table public.doctor_hidden_chats enable row level security;

drop trigger if exists trg_set_practice_id on public.doctor_hidden_chats;
create trigger trg_set_practice_id before insert on public.doctor_hidden_chats
  for each row execute function public.set_practice_id_from_staff();

drop policy if exists "doctor manages own hidden chats" on public.doctor_hidden_chats;
create policy "doctor manages own hidden chats" on public.doctor_hidden_chats
  for all to authenticated using (arzt_id = auth.uid())
  with check (arzt_id = auth.uid());

-- ══════════════════════════════════════════════════════════════
-- 3) Patient-facing read of the practice-wide switch -- patients have no
-- direct table access to `practices` under RLS, same reason
-- patient_get_working_hours() exists instead of a raw select.
-- ══════════════════════════════════════════════════════════════

create or replace function public.patient_get_chat_enabled()
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_patient_id uuid; v_practice_id uuid; v_enabled boolean;
begin
  v_patient_id := current_patient_id();
  if v_patient_id is null then return true; end if;
  select practice_id into v_practice_id from patients where id = v_patient_id;
  select chat_enabled into v_enabled from practices where id = v_practice_id;
  return coalesce(v_enabled, true);
end;
$$;
grant execute on function public.patient_get_chat_enabled() to authenticated;
