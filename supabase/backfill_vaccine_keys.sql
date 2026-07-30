-- ══════════════════════════════════════════════════════════════
-- ONE-OFF data repair -- NOT a phaseNN_*.sql schema migration, just a
-- manual UPDATE. Run this ONCE, any time after the CSV-import
-- matchVaccineKey() fix ships, to fix already-imported patient_impfungen
-- rows (like the "Alina Saadat" case) whose vaccine_key was left null by
-- every CSV import before this fix -- new imports going forward already
-- get this right automatically.
--
-- Safe to run multiple times (only touches rows still missing a key).
-- Read-only preview first if you want to see what it would change:
--   select id, patient_id, vaccine_name, vaccine_key from patient_impfungen where vaccine_key is null;
-- ══════════════════════════════════════════════════════════════

update patient_impfungen set vaccine_key = case
  when lower(vaccine_name) ~ '(6-fach|6fach|sechsfach|hexavalent)' then 'sechsfach'
  when lower(vaccine_name) ~ '(pneumokokken|pneumo)' then 'pneumokokken'
  when lower(vaccine_name) ~ 'rotavirus|rota' then 'rotavirus'
  when lower(vaccine_name) ~ '(mmr|masern|mumps|röteln)' then 'mmr'
  when lower(vaccine_name) ~ '(varizellen|windpocken)' then 'varizellen'
  when lower(vaccine_name) ~ 'meningokokken.*b|men b' then 'meningokokken_b'
  when lower(vaccine_name) ~ 'meningokokken.*acwy|men acwy' then 'meningokokken_acwy'
  when lower(vaccine_name) ~ 'hpv' then 'hpv'
  when lower(vaccine_name) ~ '(influenza|grippe)' then 'influenza'
  when lower(vaccine_name) ~ '(fsme|zecken)' then 'fsme'
  else vaccine_key
end
where vaccine_key is null;
