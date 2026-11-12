import { sb } from './supabase';

// Mirrors secretary.html's VACCINE_SCHEDULE (just the name/key pairs
// "Impfung eintragen" needs to resolve a dropdown pick back to its
// vaccine_key -- the full per-dose due-date schedule that same constant
// also carries lives in lib/vaccineSchedule.js, Phase 18) and
// addImpfungEntry() (vendor/patient-data.js, supabase/phase5_impfungen.sql).
export const VACCINE_NAMES = [
  { key: 'sechsfach', name: '6-fach (Diphtherie-Tetanus-Pertussis-Hib-Polio-Hepatitis B)' },
  { key: 'pneumokokken', name: 'Pneumokokken' },
  { key: 'rotavirus', name: 'Rotavirus' },
  { key: 'mmr', name: 'MMR (Masern-Mumps-Röteln)' },
  { key: 'varizellen', name: 'Varizellen (Windpocken)' },
  { key: 'meningokokken_b', name: 'Meningokokken B' },
  { key: 'meningokokken_acwy', name: 'Meningokokken ACWY' },
  { key: 'hpv', name: 'HPV' },
  { key: 'influenza', name: 'Influenza' },
  { key: 'fsme', name: 'FSME (Zecken-Impfung)' },
  { key: 'covid19', name: 'COVID-19' },
];
export const VACCINE_DOSE_LABELS = ['1. Dosis', '2. Dosis', '3. Dosis', 'Auffrischung', 'Einmaldosis'];

// Mirrors secretary.html's matchVaccineKey()/VACCINE_NAME_ALIASES -- CSV
// import (Phase 20's "Impfungen" column) only ever has the free-text
// vaccine name an old system's export happened to use, never a pick from
// this file's own VACCINE_NAMES dropdown, which already sets vaccineKey
// correctly. Without a key, dueVaccinationsForPatient() (lib/
// vaccineSchedule.js) -- which matches a given dose against VACCINE_SCHEDULE
// strictly by `key`, never by free-text name -- could never recognize an
// imported dose as satisfying that vaccine's requirement, silently leaving
// an already-given, already-recorded dose showing up as overdue forever.
const VACCINE_NAME_ALIASES = {
  sechsfach: ['6-fach', '6fach', 'sechsfach', 'hexavalent'],
  pneumokokken: ['pneumokokken', 'pneumo'],
  rotavirus: ['rotavirus', 'rota'],
  mmr: ['mmr', 'masern-mumps-röteln', 'masern', 'mumps', 'röteln'],
  varizellen: ['varizellen', 'windpocken'],
  meningokokken_b: ['meningokokken b', 'meningokokken-b', 'men b'],
  meningokokken_acwy: ['meningokokken acwy', 'meningokokken-acwy', 'men acwy'],
  hpv: ['hpv'],
  influenza: ['influenza', 'grippe'],
  fsme: ['fsme', 'zecken', 'zeckenimpfung', 'zecken-impfung'],
};
export function matchVaccineKey(rawName) {
  const n = (rawName || '').trim().toLowerCase();
  if (!n) return null;
  const byExactOrPrefix = VACCINE_NAMES.find((v) => n === v.key || n === v.name.toLowerCase() || v.name.toLowerCase().startsWith(n));
  if (byExactOrPrefix) return byExactOrPrefix.key;
  const aliasKey = Object.keys(VACCINE_NAME_ALIASES).find((key) => VACCINE_NAME_ALIASES[key].some((alias) => n === alias || n.startsWith(alias)));
  return aliasKey || null;
}

// uploaded_by is a staff_profiles(id) uuid FK -- the signed-in staff
// member's own id, unlike the original's session.username text (a
// pre-existing mismatch there; this is the correct value for the column).
export async function addImpfungEntry(patientId, entry, uploadedBy) {
  const row = {
    patient_id: patientId,
    vaccine_key: entry.vaccineKey || null,
    vaccine_name: entry.vaccineName,
    dose_label: entry.doseLabel,
    datum: entry.datum,
    next_due: entry.nextDue || null,
    charge: entry.charge || null,
    uploaded_by: uploadedBy || null,
  };
  const { error } = await sb.from('patient_impfungen').insert(row);
  if (error) { console.error('addImpfungEntry failed', error); throw error; }
}
