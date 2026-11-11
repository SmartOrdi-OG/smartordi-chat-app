import { sb } from './supabase';

// Mirrors vendor/cdss-followup-reminders.js's detectFollowupReminder() and
// secretary.html's own Übersicht "Kontrollpatienten fällig" worklist
// (computeRecallList()/getAllVisitsForRecall(), vendor/patient-data.js) --
// a non-blocking "Kontroll-Erinnerung" for patients with a chronic-
// condition keyword anywhere in their visit history who haven't been seen
// in longer than that condition's own recommended check-in interval.
// Deliberately a small, illustrative list of common chronic conditions
// with widely-known monitoring intervals, not a substitute for real
// clinical judgment or a licensed guideline database -- same disclaimer
// the original carries.
export const CHRONIC_CONDITIONS = [
  { id: 'diabetes', label: 'Diabetes', keywords: ['diabetes'], months: 6 },
  { id: 'hypertonie', label: 'Hypertonie', keywords: ['hypertonie', 'bluthochdruck'], months: 6 },
  { id: 'hypothyreose', label: 'Schilddrüsenunterfunktion', keywords: ['hypothyreose', 'schilddrüsenunterfunktion'], months: 12 },
  { id: 'asthmacopd', label: 'Asthma/COPD', keywords: ['asthma', 'copd'], months: 12 },
];

function monthsBetween(from, to) {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

// visits: array of {date, diag} for ONE patient. Returns null if nothing
// applies, else the single most-overdue match:
// {label, monthsSince, thresholdMonths, overdueBy}.
export function detectFollowupReminder(visits, now) {
  if (!visits || !visits.length) return null;
  now = now || new Date();
  const lastDateStr = visits.reduce((max, v) => (v.date > max ? v.date : max), visits[0].date);
  const monthsSince = monthsBetween(new Date(lastDateStr), now);
  const allDiagText = visits.map((v) => (v.diag || '').toLowerCase()).join(' | ');

  let best = null;
  CHRONIC_CONDITIONS.forEach((c) => {
    if (!c.keywords.some((k) => allDiagText.includes(k))) return;
    if (monthsSince < c.months) return;
    const overdueBy = monthsSince - c.months;
    if (!best || overdueBy > best.overdueBy) best = { label: c.label, monthsSince, thresholdMonths: c.months, overdueBy };
  });
  return best;
}

// Only patient_id/visit_date/diagnose are needed (not getVisitsForPatient()'s
// full column list), one query for the whole practice (RLS already scopes
// it) instead of one per patient.
export async function getAllVisitsForRecall() {
  const { data, error } = await sb.from('patient_visits').select('patient_id,visit_date,diagnose');
  if (error) { console.error('getAllVisitsForRecall failed', error); return []; }
  return data || [];
}

// patients: the already-fetched patient list (listPatients(), lib/
// patientsData.js) -- a bounded, name-ordered page, same deliberate
// simplification that list already makes elsewhere in this app, rather
// than the original's separate unbounded-snapshot fetch for this one
// feature.
export async function computeRecallList(patients) {
  const visits = await getAllVisitsForRecall();
  const byPatient = {};
  visits.forEach((v) => {
    if (!v.patient_id) return;
    (byPatient[v.patient_id] = byPatient[v.patient_id] || []).push({ date: v.visit_date, diag: v.diagnose });
  });
  const now = new Date();
  const out = [];
  patients.forEach((p) => {
    const patientVisits = byPatient[p.id];
    if (!patientVisits) return;
    const reminder = detectFollowupReminder(patientVisits, now);
    if (reminder) out.push({ patientId: p.id, name: p.fullName || p.name, ...reminder });
  });
  out.sort((a, b) => b.overdueBy - a.overdueBy);
  return out;
}

export function buildRecallReminderText(name, label, monthsSince) {
  return 'Guten Tag ' + name + '! Laut unseren Unterlagen wäre bei Ihnen eine Kontrolluntersuchung (' + label
    + ') fällig — Ihr letzter Eintrag liegt ' + monthsSince + ' Monate zurück. Bitte vereinbaren Sie bei Gelegenheit einen Termin.';
}
