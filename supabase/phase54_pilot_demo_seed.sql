-- ══════════════════════════════════════════════════════════════
-- Pilot-Demo-Seed: fiktive Patienten/Termine/Nachrichten für ein
-- Pilot-Konto (Testärzt:in + Sekretariat)
--
-- Grund: ein Pilot-Arzt/eine Pilot-Ärztin soll das Programm ausprobieren
-- können, ohne echte eigene Patientendaten eintragen zu müssen (manche
-- sind dabei zurückhaltend). Die Praxis ist bereits vollständig mandanten-
-- getrennt (jede Praxis hat ihre eigene practice_id, siehe phase11/12) --
-- diese fiktiven Patienten sind also NUR für diese eine Pilot-Praxis
-- sichtbar, nie für die echte Praxis.
--
-- Reihenfolge:
--   1. Der Pilot-Arzt registriert sich zuerst ganz normal selbst über
--      register.html (eigene E-Mail, eigenes Passwort, eigener
--      Praxisname -- die Praxis kann trotzdem ein Platzhaltername wie
--      "Pilot-Praxis" sein, das Feld ist frei wählbar).
--   2. Unten den echten Praxisnamen (v_practice_name) und die echte
--      E-Mail-Adresse des Pilot-Arztes (v_arzt_email) eintragen.
--   3. Dieses ganze Script einmal im Supabase SQL Editor ausführen.
--
-- Alle Namen/SV-Nummern/Adressen/Telefonnummern unten sind komplett
-- erfunden (keine echten Personen).
--
-- NICHT ausführen, bis wir das zusammen besprochen und entschieden haben.
-- ══════════════════════════════════════════════════════════════

do $$
declare
  v_practice_name text := 'PILOT_PRAXISNAME_HIER_EINTRAGEN';   -- <-- anpassen: exakter Praxisname aus der Registrierung
  v_arzt_email text := 'pilot-arzt@example.at';                -- <-- anpassen: echte Login-E-Mail des Pilot-Arztes
  v_practice_id uuid;
  v_arzt_id uuid;
  v_p_wagner uuid; v_p_berger uuid; v_p_steiner uuid; v_p_huber uuid; v_p_gruber uuid;
  v_p_winkler uuid; v_p_bauer uuid; v_p_fischer uuid; v_p_maier uuid; v_p_koenig uuid;
  v_bauer_dob date := current_date - interval '10 years';
begin
  select id into v_practice_id from practices where name = v_practice_name;
  if v_practice_id is null then
    raise exception 'Praxis "%" nicht gefunden -- zuerst über register.html registrieren und den echten Namen oben eintragen.', v_practice_name;
  end if;

  select id into v_arzt_id from staff_profiles where practice_id = v_practice_id and email = v_arzt_email and role = 'arzt';
  if v_arzt_id is null then
    raise exception 'Kein Arzt-Konto mit E-Mail "%" in dieser Praxis gefunden.', v_arzt_email;
  end if;

  -- ── Patienten ──────────────────────────────────────────────
  insert into patients (username, name, full_name, dob, adresse, tel, email, versicherung, svnr, practice_id)
  values ('lukas.wagner','Lukas','Lukas Wagner','1985-03-12','Hauptstraße 12, 1010 Wien','+43 660 1234501','lukas.wagner@example.at','ÖGK','1234 120385',v_practice_id)
  returning id into v_p_wagner;

  insert into patients (username, name, full_name, dob, adresse, tel, email, versicherung, svnr, practice_id)
  values ('anna.berger','Anna','Anna Berger','1990-07-22','Bahnhofgasse 4, 4020 Linz','+43 660 1234502','anna.berger@example.at','ÖGK','2234 220790',v_practice_id)
  returning id into v_p_berger;

  insert into patients (username, name, full_name, dob, adresse, tel, email, versicherung, svnr, practice_id)
  values ('felix.steiner','Felix','Felix Steiner','1978-11-05','Ringstraße 9, 8010 Graz','+43 660 1234503','felix.steiner@example.at','BVAEB','3234 051178',v_practice_id)
  returning id into v_p_steiner;

  insert into patients (username, name, full_name, dob, adresse, tel, email, versicherung, svnr, practice_id)
  values ('sophie.huber','Sophie','Sophie Huber','2001-02-14','Kirchplatz 2, 5020 Salzburg','+43 660 1234504','sophie.huber@example.at','SVS','4234 140201',v_practice_id)
  returning id into v_p_huber;

  insert into patients (username, name, full_name, dob, adresse, tel, email, versicherung, svnr, practice_id)
  values ('paul.gruber','Paul','Paul Gruber','1965-09-30','Marktgasse 15, 6020 Innsbruck','+43 660 1234505','paul.gruber@example.at','ÖGK','5234 300965',v_practice_id)
  returning id into v_p_gruber;

  insert into patients (username, name, full_name, dob, adresse, tel, email, versicherung, svnr, practice_id)
  values ('mia.winkler','Mia','Mia Winkler',(current_date - interval '110 days')::date,'Wiesenweg 3, 1210 Wien','+43 660 1234506','eltern.winkler@example.at','ÖGK','6234 000000',v_practice_id)
  returning id into v_p_winkler;

  insert into patients (username, name, full_name, dob, adresse, tel, email, versicherung, svnr, practice_id)
  values ('noah.bauer','Noah','Noah Bauer',v_bauer_dob,'Feldweg 8, 2340 Mödling','+43 660 1234507','eltern.bauer@example.at','ÖGK','7234 000001',v_practice_id)
  returning id into v_p_bauer;

  insert into patients (username, name, full_name, dob, adresse, tel, email, versicherung, svnr, practice_id)
  values ('emma.fischer','Emma','Emma Fischer','1993-12-08','Lindenallee 21, 4600 Wels','+43 660 1234508','emma.fischer@example.at','ÖGK','8234 081293',v_practice_id)
  returning id into v_p_fischer;

  insert into patients (username, name, full_name, dob, adresse, tel, email, versicherung, svnr, practice_id)
  values ('jakob.maier','Jakob','Jakob Maier','1950-04-17','Dorfstraße 6, 3100 St. Pölten','+43 660 1234509','jakob.maier@example.at','ÖGK','9234 170450',v_practice_id)
  returning id into v_p_maier;

  insert into patients (username, name, full_name, dob, adresse, tel, email, versicherung, svnr, practice_id)
  values ('laura.koenig','Laura','Laura König','1988-06-25','Gartenweg 11, 9020 Klagenfurt','+43 660 1234510','laura.koenig@example.at','BVAEB','1334 250688',v_practice_id)
  returning id into v_p_koenig;

  -- ── Termine ────────────────────────────────────────────────
  insert into termine (patient_id, patient_name, art, date, time, end_time, status, arzt_id, versicherung, tel, svnr, dob, practice_id) values
    (v_p_wagner,  'Lukas Wagner',  'Kontrolle',                (current_date + 1),  '09:00','09:20','bestaetigt', v_arzt_id, 'ÖGK','+43 660 1234501','1234 120385','1985-03-12', v_practice_id),
    (v_p_berger,  'Anna Berger',   'Akutsprechstunde',         (current_date + 3),  '10:30','10:50','neu',        v_arzt_id, 'ÖGK','+43 660 1234502','2234 220790','1990-07-22', v_practice_id),
    (v_p_steiner, 'Felix Steiner', 'Kontrolle',                (current_date - 10), '08:15','08:35','bestaetigt', v_arzt_id, 'BVAEB','+43 660 1234503','3234 051178','1978-11-05', v_practice_id),
    (v_p_huber,   'Sophie Huber',  'Erstberatung',             (current_date + 7),  '14:00','14:30','bestaetigt', v_arzt_id, 'SVS','+43 660 1234504','4234 140201','2001-02-14', v_practice_id),
    (v_p_gruber,  'Paul Gruber',   'Laborbefund-Besprechung',  (current_date - 2),  '11:00','11:20','abgesagt',   v_arzt_id, 'ÖGK','+43 660 1234505','5234 300965','1965-09-30', v_practice_id),
    (v_p_gruber,  'Paul Gruber',   'Kontrolle',                (current_date + 5),  '11:00','11:20','neu',        v_arzt_id, 'ÖGK','+43 660 1234505','5234 300965','1965-09-30', v_practice_id),
    (v_p_winkler, 'Mia Winkler',   'Kontrolle (U-Untersuchung)',(current_date + 2), '09:40','10:00','bestaetigt', v_arzt_id, 'ÖGK','+43 660 1234506','6234 000000',(current_date - interval '110 days')::date, v_practice_id),
    (v_p_maier,   'Jakob Maier',   'Kontrolle',                (current_date + 10), '15:00','15:20','bestaetigt', v_arzt_id, 'ÖGK','+43 660 1234509','9234 170450','1950-04-17', v_practice_id);

  -- ── Nachrichten (patient_messages) ────────────────────────
  insert into patient_messages (patient_id, dir, type, text, sent_by, practice_id) values
    (v_p_wagner,  'in',  'text', 'Guten Tag, ich wollte fragen ob ich meinen Termin morgen um 09:00 auf den Nachmittag verschieben kann?', null, v_practice_id),
    (v_p_wagner,  'out', 'text', 'Guten Tag Herr Wagner, kein Problem -- wir haben morgen um 15:30 Uhr noch frei. Passt das für Sie?', v_arzt_id, v_practice_id),
    (v_p_berger,  'in',  'text', 'Hallo, ich habe seit gestern leichtes Fieber. Sollte ich trotzdem zum Termin kommen oder lieber verschieben?', null, v_practice_id),
    (v_p_fischer, 'in',  'text', 'Guten Tag, sind meine letzten Blutbefunde schon da?', null, v_practice_id),
    (v_p_fischer, 'out', 'text', 'Guten Tag Frau Fischer, die Befunde sind eingelangt und unauffällig. Ich rufe Sie heute noch kurz an.', v_arzt_id, v_practice_id),
    (v_p_koenig,  'in',  'text', 'Vielen Dank für die schnelle Rückmeldung gestern!', null, v_practice_id);

  -- ── Kartei-Verlauf (patient_visits) ────────────────────────
  insert into patient_visits (patient_id, visit_date, visit_type, diagnose, notes, created_by, practice_id) values
    (v_p_steiner, (current_date - 10), 'Kontrolle', 'Hypertonie, gut eingestellt', 'Blutdruck 132/84, Patient beschwerdefrei. Medikation unverändert fortführen.', v_arzt_id, v_practice_id),
    (v_p_maier,   (current_date - 30), 'Kontrolle', 'Diabetes mellitus Typ 2, stabil', 'HbA1c 6.8%, Werte im Zielbereich. Nächste Kontrolle in 3 Monaten.', v_arzt_id, v_practice_id),
    (v_p_bauer,   (v_bauer_dob + interval '9 years'), 'Vorsorgeuntersuchung', 'Altersgerechte Entwicklung', 'Größe/Gewicht altersentsprechend, Impfstatus siehe Impfkalender.', v_arzt_id, v_practice_id);

  -- ── Impfungen (patient_impfungen) -- Noah Bauer, für D2 MMR bewusst
  -- unvollständig gelassen, damit die Kartei den "überfällig"-Zustand
  -- realistisch zeigt. Mia Winkler bekommt bewusst KEINE Einträge -- ihr
  -- dob (110 Tage) allein reicht, damit die Sekretär:innen-Übersicht die
  -- fällige 6-fach/Pneumokokken-Impfung automatisch anzeigt.
  insert into patient_impfungen (patient_id, vaccine_key, vaccine_name, dose_label, datum, uploaded_by, practice_id) values
    (v_p_bauer, 'sechsfach', '6-fach (Diphtherie-Tetanus-Pertussis-Hib-Polio-Hepatitis B)', 'D1', (v_bauer_dob + interval '3 months'), v_arzt_id, v_practice_id),
    (v_p_bauer, 'sechsfach', '6-fach (Diphtherie-Tetanus-Pertussis-Hib-Polio-Hepatitis B)', 'D2', (v_bauer_dob + interval '5 months'), v_arzt_id, v_practice_id),
    (v_p_bauer, 'sechsfach', '6-fach (Diphtherie-Tetanus-Pertussis-Hib-Polio-Hepatitis B)', 'D3', (v_bauer_dob + interval '11 months'), v_arzt_id, v_practice_id),
    (v_p_bauer, 'mmr', 'MMR (Masern-Mumps-Röteln)', 'D1', (v_bauer_dob + interval '13 months'), v_arzt_id, v_practice_id);

  raise notice 'Pilot-Demo-Daten für Praxis "%" (id=%) erfolgreich eingefügt: 10 Patienten, 8 Termine, 6 Nachrichten, 3 Verlauf-Einträge, 4 Impfungen.', v_practice_name, v_practice_id;
end $$;
