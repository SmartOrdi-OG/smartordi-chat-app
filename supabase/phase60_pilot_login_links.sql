-- ══════════════════════════════════════════════════════════════
-- Passwortloser Login-Link für Pilot-Konten (Arzt/Sekretär*in aus
-- phase53_pilot_account_setup.sql) -- statt Benutzername+Passwort tippen
-- zu müssen, bekommt die Pilot-Person einen Button per E-Mail, der sie
-- direkt einloggt.
--
-- Diese Tabelle speichert NUR unsere eigenen Einmal-Tokens (wer, welcher
-- Token-String, wie lange gültig, schon benutzt oder nicht) -- sie hat
-- nichts mit Supabase's eigenem kurzlebigen Magic-Link-Mechanismus zu tun.
-- Der Grund für diese Zwischenschicht: Supabase's eingebauter Magic-Link
-- (OTP) hat eine von der Projekt-Konfiguration vorgegebene, kurze
-- Standard-Gültigkeit -- für einen Button, der 10-14 Tage im Postfach
-- gültig bleiben soll (Wunsch aus dem Chat), reicht das nicht. Stattdessen
-- kontrollieren WIR die lange Gültigkeit selbst über diese Tabelle, und
-- erst im Moment des tatsächlichen Klicks (supabase/functions/pilot-login)
-- wird -- serverseitig, mit dem Service-Role-Key -- ein frischer, echter
-- Supabase-Magic-Link erzeugt und sofort weitergeleitet. Das eigentliche
-- Supabase-OTP lebt dadurch nur Sekunden und wird der Pilot-Person nie
-- direkt gezeigt; nur unser eigener Token (dieser hier) muss lange leben.
--
-- Absichtlich KEINE RLS-Policy (siehe Abschnitt unten) -- diese Tabelle
-- wird ausschließlich von den beiden Edge Functions mit dem Service-Role-
-- Key gelesen/geschrieben, der RLS ohnehin umgeht. Kein Konto (Arzt,
-- Sekretär*in, Patient) soll hierauf jemals direkten Zugriff haben.
--
-- Run this in the Supabase SQL editor, after phase53_pilot_account_setup.sql.
-- ══════════════════════════════════════════════════════════════

create table if not exists public.staff_pilot_login_links (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff_profiles(id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists staff_pilot_login_links_token_idx on public.staff_pilot_login_links(token);
create index if not exists staff_pilot_login_links_staff_id_idx on public.staff_pilot_login_links(staff_id);

alter table public.staff_pilot_login_links enable row level security;
-- Deliberately zero policies -- see header comment above. Same documented
-- pattern as guardian_active_child (phase31_patient_auth.sql): RLS enabled
-- with no policies means Postgres denies every row to every non-superuser
-- caller, which is exactly the point here (service-role-only access).
