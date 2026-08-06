-- ══════════════════════════════════════════════════════════════
-- Pilot-Konto-Setup: Praxis + Arzt/Ärztin + Sekretär/in OHNE dass die
-- Pilot-Person selbst irgendetwas über register.html/den Einladungslink
-- eintragen muss.
--
-- Normalerweise entsteht eine neue Praxis nur, wenn sich jemand selbst
-- über register.html registriert (echte E-Mail, Praxisname, DSGVO/AGB-
-- Häkchen...). Für einen Piloten, wo die Person selbst keine eigenen
-- Daten eintragen möchte, geht's stattdessen so:
--
--   1. Im Supabase Dashboard: Authentication → Users → "Add user" --
--      ZWEI Logins direkt anlegen (E-Mail + Passwort deiner Wahl, nicht
--      die der Pilot-Person -- z.B. pilot-arzt@deine-domain.at /
--      pilot-sek@deine-domain.at mit einem Passwort, das du dann einfach
--      weitergibst). "Auto Confirm User" anhaken, damit kein
--      Bestätigungs-E-Mail nötig ist.
--   2. Die beiden dabei erzeugten User-IDs (UUIDs) von dort kopieren.
--   3. Unten alle mit <-- markierten Zeilen ausfüllen (Praxisname, beide
--      UUIDs, Namen/Fachrichtung).
--   4. Dieses Script einmal im Supabase SQL Editor ausführen.
--   5. Direkt danach phase54_pilot_demo_seed.sql ausführen (nutzt
--      denselben Praxisnamen, um die fiktiven Patienten anzulegen).
--
-- Login danach: ganz normal über login.html mit der jeweiligen E-Mail
-- und dem Passwort, das beim "Add user" vergeben wurde -- kein Invite-
-- Link, kein Registrierungsformular.
--
-- NICHT ausführen, bis wir das zusammen besprochen und entschieden haben.
-- ══════════════════════════════════════════════════════════════

do $$
declare
  -- Praxis
  v_practice_name text := 'PILOT_PRAXISNAME_HIER_EINTRAGEN';        -- <-- frei wählbar, z.B. 'Pilot-Praxis Dr. X'
  v_practice_adresse text := 'Musterstraße 1, 1010 Wien';           -- <-- optional anpassen
  v_practice_tel text := '+43 660 0000000';                        -- <-- optional anpassen

  -- Arzt/Ärztin (Admin) -- UUID kommt aus Supabase Dashboard → Authentication → Users
  v_arzt_user_id uuid := '00000000-0000-0000-0000-000000000000';   -- <-- ersetzen
  v_arzt_vorname text := 'Vorname';                                 -- <-- ersetzen
  v_arzt_nachname text := 'Nachname';                               -- <-- ersetzen
  v_arzt_fach text := 'Allgemeinmedizin';                           -- <-- optional anpassen
  v_arzt_email text := 'pilot-arzt@example.at';                     -- <-- muss zur Dashboard-E-Mail passen

  -- Sekretär/in -- UUID kommt aus demselben Dashboard-Schritt
  v_sek_user_id uuid := '00000000-0000-0000-0000-000000000000';    -- <-- ersetzen
  v_sek_vorname text := 'Vorname';                                  -- <-- ersetzen
  v_sek_nachname text := 'Nachname';                                -- <-- ersetzen
  v_sek_email text := 'pilot-sek@example.at';                       -- <-- muss zur Dashboard-E-Mail passen

  v_practice_id uuid;
begin
  if v_arzt_user_id = '00000000-0000-0000-0000-000000000000'
     or v_sek_user_id = '00000000-0000-0000-0000-000000000000' then
    raise exception 'Bitte zuerst v_arzt_user_id/v_sek_user_id oben durch die echten UUIDs aus Supabase Dashboard → Authentication → Users ersetzen.';
  end if;

  if exists (select 1 from practices where name = v_practice_name) then
    raise exception 'Es gibt schon eine Praxis mit dem Namen "%". Anderen Namen wählen oder Script nicht erneut ausführen.', v_practice_name;
  end if;

  insert into practices (name, adresse, tel, plan, trial_start)
  values (v_practice_name, v_practice_adresse, v_practice_tel, 'enterprise', now())
  returning id into v_practice_id;

  insert into staff_profiles (id, vorname, nachname, role, fach, is_admin, email, practice_id)
  values (v_arzt_user_id, v_arzt_vorname, v_arzt_nachname, 'arzt', v_arzt_fach, true, v_arzt_email, v_practice_id);

  insert into staff_profiles (id, vorname, nachname, role, fach, is_admin, email, practice_id)
  values (v_sek_user_id, v_sek_vorname, v_sek_nachname, 'sekretaerin', null, false, v_sek_email, v_practice_id);

  raise notice 'Pilot-Praxis "%" (id=%) angelegt -- Arzt/Ärztin und Sekretär/in können sich jetzt direkt über login.html mit ihrer E-Mail+Passwort anmelden.', v_practice_name, v_practice_id;
end $$;
