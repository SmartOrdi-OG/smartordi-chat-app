import { sb } from './supabase';

// Mirrors secretary.html's VACCINE_SCHEDULE/VACCINE_SCHEDULE_MAX_AGE_DAYS/
// dueVaccinationsForPatient()/allDueVaccinations()/dueVaccinationPatientSet()
// -- the Impfpass/vaccine-schedule due-date subsystem (distinct from Phase
// 17's chronic-condition follow-up worklist, despite the similar-sounding
// "Kontrollpatienten"/"fällig" wording both features share).
export const VACCINE_SCHEDULE = [
  { key: 'sechsfach', name: '6-fach (Diphtherie-Tetanus-Pertussis-Hib-Polio-Hepatitis B)', doses: [
    { label: 'D1', minDay: 90 }, { label: 'D2', minDay: 150 }, { label: 'D3', minDay: 330 },
    { label: 'A1', minDay: 2190 }, { label: 'A2', minDay: 5110 },
  ] },
  { key: 'pneumokokken', name: 'Pneumokokken', doses: [
    { label: 'D1', minDay: 90 }, { label: 'D2', minDay: 146 }, { label: 'D3', minDay: 360 },
  ] },
  { key: 'rotavirus', name: 'Rotavirus', doses: [
    { label: 'D1', minDay: 42 }, { label: 'D2', minDay: 70 },
  ] },
  { key: 'mmr', name: 'MMR (Masern-Mumps-Röteln)', doses: [
    { label: 'D1', minDay: 365 }, { label: 'D2', minDay: 455 },
  ] },
  { key: 'varizellen', name: 'Varizellen (Windpocken)', doses: [
    { label: 'D1', minDay: 365 }, { label: 'D2', minDay: 407 },
  ] },
  { key: 'meningokokken_b', name: 'Meningokokken B', doses: [
    { label: 'D1', minDay: 90 }, { label: 'D2', minDay: 150 }, { label: 'D3', minDay: 390 },
  ] },
  { key: 'meningokokken_acwy', name: 'Meningokokken ACWY', doses: [
    { label: 'D1', minDay: 4015 },
  ] },
  { key: 'hpv', name: 'HPV', doses: [
    { label: 'D1', minDay: 3285 }, { label: 'D2', minDay: 3465 },
  ] },
  { key: 'influenza', name: 'Influenza', doses: [
    { label: 'D1', minDay: 183 }, { label: 'D2', minDay: 211 },
  ], recurringDays: 365 },
  { key: 'fsme', name: 'FSME (Zecken-Impfung)', doses: [
    { label: 'D1', minDay: 365 }, { label: 'D2', minDay: 410 }, { label: 'D3', minDay: 680 }, { label: 'A1', minDay: 2505 },
  ], recurringDays: 1095 },
];
export const VACCINE_SCHEDULE_MAX_AGE_DAYS = 6570;

function ageInDays(dob) {
  if (!dob) return null;
  return Math.floor((new Date() - new Date(dob + 'T00:00:00')) / 86400000);
}
function daysUntil(dateStr) {
  return Math.round((new Date(dateStr + 'T00:00:00') - new Date(new Date().toISOString().split('T')[0] + 'T00:00:00')) / 86400000);
}
function daysSince(dateStr) {
  const today = new Date().toISOString().split('T')[0];
  return Math.round((new Date(today + 'T00:00:00') - new Date(dateStr + 'T00:00:00')) / 86400000);
}

// impfungen: array of {vaccineKey, datum, nextDue} for ONE patient. Returns
// every due/overdue vaccination, most urgent first isn't guaranteed here
// (callers that only want the single worst one take due[0], same as the
// original's own secOvImpfWarning usage).
export function dueVaccinationsForPatient(dob, impfungen) {
  const due = [];
  const list = impfungen || [];
  const explicitKeys = new Set();
  list.forEach((i) => {
    if (!i.nextDue) return;
    const d = daysUntil(i.nextDue);
    if (d <= 30) {
      explicitKeys.add(i.vaccineKey || i.vaccineName);
      due.push({ vaccine: i.vaccineName, status: d < 0 ? 'ueberfaellig' : 'faellig', detail: d < 0 ? `seit ${Math.abs(d)} Tag(en) überfällig` : (d === 0 ? 'heute fällig' : `in ${d} Tag(en) fällig`) });
    }
  });
  const ageD = ageInDays(dob);
  if (ageD !== null && ageD <= VACCINE_SCHEDULE_MAX_AGE_DAYS) {
    VACCINE_SCHEDULE.forEach((v) => {
      if (explicitKeys.has(v.key)) return;
      const given = list.filter((i) => i.vaccineKey === v.key);
      if (given.length < v.doses.length) {
        const nextDose = v.doses[given.length];
        if (ageD >= nextDose.minDay) {
          const overdueDays = ageD - nextDose.minDay;
          due.push({ vaccine: `${v.name} (${nextDose.label})`, status: overdueDays > 30 ? 'ueberfaellig' : 'faellig', detail: overdueDays > 30 ? `seit ${overdueDays} Tag(en) fällig` : 'fällig' });
        }
      } else if (v.recurringDays) {
        const lastGiven = given.slice().sort((a, b) => b.datum.localeCompare(a.datum))[0];
        if (lastGiven) {
          const sinceDays = daysSince(lastGiven.datum);
          if (sinceDays >= v.recurringDays - 30) {
            const overdueDays = sinceDays - v.recurringDays;
            due.push({ vaccine: `${v.name} (Auffrischung)`, status: overdueDays > 30 ? 'ueberfaellig' : 'faellig', detail: overdueDays > 30 ? `seit ${overdueDays} Tag(en) fällig` : 'fällig' });
          }
        }
      }
    });
  }
  return due;
}

export async function getImpfungenForPatient(patientId) {
  const { data, error } = await sb.from('patient_impfungen').select('vaccine_key,vaccine_name,datum,next_due').eq('patient_id', patientId);
  if (error) { console.error('getImpfungenForPatient failed', error); return []; }
  return (data || []).map((row) => ({ vaccineKey: row.vaccine_key, vaccineName: row.vaccine_name, datum: row.datum, nextDue: row.next_due }));
}

// One bulk query for the whole practice (RLS already scopes it), same
// pattern as lib/followupReminders.js's getAllVisitsForRecall() -- avoids
// one query per patient.
export async function getAllImpfungenGrouped() {
  const { data, error } = await sb.from('patient_impfungen').select('patient_id,vaccine_key,vaccine_name,datum,next_due');
  if (error) { console.error('getAllImpfungenGrouped failed', error); return {}; }
  const byPatient = {};
  (data || []).forEach((row) => {
    (byPatient[row.patient_id] = byPatient[row.patient_id] || []).push({
      vaccineKey: row.vaccine_key, vaccineName: row.vaccine_name, datum: row.datum, nextDue: row.next_due,
    });
  });
  return byPatient;
}

// patients: array of {id, dob}. Returns a Set of patient ids with at least
// one due/overdue vaccination -- keyed by id, not full name (the original
// keys its own dueSet by patient full-name text, since a Termin row there
// only ever carries a name; this app's Termine already carry patientId,
// so using that instead avoids the exact kind of same-name-collision bug
// already fixed elsewhere in this port, e.g. Phase 11's document import).
export async function dueVaccinationPatientIdSet(patients) {
  const byPatient = await getAllImpfungenGrouped();
  const set = new Set();
  patients.forEach((p) => {
    if (dueVaccinationsForPatient(p.dob, byPatient[p.id]).length) set.add(p.id);
  });
  return set;
}
