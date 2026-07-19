-- ══ GDPR/DSGVO item 4 (part 1): audit log ══
--
-- datenschutz.html section 8 already promises "eine vollständige
-- Dokumentation des Vorfalls" for any data breach, and Art. 5(2) DSGVO
-- ("Rechenschaftspflicht") requires being able to demonstrate who accessed
-- or changed a patient's data and when. Until now there was no such
-- record anywhere -- a row could be read, edited, or deleted by any staff
-- member with zero trace.
--
-- This covers WRITES only (insert/update/delete), via standard AFTER
-- triggers -- Postgres has no SELECT trigger, so read-access logging isn't
-- possible at this layer; that would need an app-level RPC wrapper and is
-- deliberately left for a later pass if the practice ever needs it (not
-- required by DSGVO itself, which is about accountability for changes,
-- not surveillance of every read).
--
-- Run this in the Supabase SQL editor, after phase11 (needs practices/
-- current_practice_id()).

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid references public.practices(id),
  table_name text not null,
  action text not null check (action in ('insert','update','delete')),
  row_id uuid,
  patient_id uuid,
  actor_id uuid,                 -- auth.uid() of the staff member; null when the write came from a patient-facing SECURITY DEFINER RPC (patients have no real Supabase Auth session)
  actor_role text not null,
  data jsonb,                    -- {"old":...} / {"new":...} / {"old":...,"new":...} snapshot, with write-only/bulky columns stripped (pw_hash, temp_password, file_data)
  created_at timestamptz not null default now()
);
create index audit_log_practice_created_idx on public.audit_log(practice_id, created_at desc);
create index audit_log_patient_idx on public.audit_log(patient_id, created_at desc);

alter table public.audit_log enable row level security;
create policy "staff read own practice audit log" on public.audit_log
  for select to authenticated using (practice_id = public.current_practice_id());
-- deliberately no insert/update/delete policy for anyone: the only writer
-- is the SECURITY DEFINER trigger function below, which bypasses RLS as
-- its owner -- nobody, staff included, can edit or delete an entry.

create or replace function public.audit_log_row()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row_id uuid;
  v_patient_id uuid;
  v_practice_id uuid;
  v_actor uuid := auth.uid();
  v_old jsonb;
  v_new jsonb;
  v_data jsonb;
begin
  if tg_op = 'DELETE' then
    v_row_id := old.id;
    v_practice_id := old.practice_id;
  else
    v_row_id := new.id;
    v_practice_id := new.practice_id;
  end if;

  if tg_table_name = 'patients' then
    v_patient_id := v_row_id;
  elsif tg_op = 'DELETE' then
    v_patient_id := old.patient_id;
  else
    v_patient_id := new.patient_id;
  end if;

  if tg_op in ('UPDATE','DELETE') then
    v_old := to_jsonb(old) - 'pw_hash' - 'temp_password' - 'file_data';
  end if;
  if tg_op in ('UPDATE','INSERT') then
    v_new := to_jsonb(new) - 'pw_hash' - 'temp_password' - 'file_data';
  end if;

  v_data := case tg_op
    when 'INSERT' then jsonb_build_object('new', v_new)
    when 'DELETE' then jsonb_build_object('old', v_old)
    else jsonb_build_object('old', v_old, 'new', v_new)
  end;

  insert into public.audit_log(practice_id, table_name, action, row_id, patient_id, actor_id, actor_role, data)
  values (
    v_practice_id, tg_table_name, lower(tg_op), v_row_id, v_patient_id, v_actor,
    case when v_actor is null then 'patient_or_system' else 'staff' end,
    v_data
  );

  return coalesce(new, old);
end;
$function$;

do $$
declare t text;
begin
  for t in select unnest(array['patients','termine','patient_messages','patient_documents','mkp_untersuchungen','patient_impfungen']) loop
    execute format('drop trigger if exists trg_audit_log on public.%I', t);
    execute format('create trigger trg_audit_log after insert or update or delete on public.%I for each row execute function public.audit_log_row()', t);
  end loop;
end $$;
