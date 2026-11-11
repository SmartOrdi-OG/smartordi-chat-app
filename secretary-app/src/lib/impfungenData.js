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
