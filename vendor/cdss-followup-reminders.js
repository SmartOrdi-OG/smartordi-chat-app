// Second CDSS slice (see vendor/cdss-medication-alerts.js for the first):
// a non-blocking "Kontroll-Erinnerung" (follow-up reminder) banner in
// Kartei Verlauf, for patients with a chronic-condition keyword anywhere in
// their visit history (VISITS[].diag) who haven't been seen in longer than
// that condition's own recommended check-in interval. Same spirit as the
// existing Impfkalender due-vaccination banner (impfpass-warnung): computed
// from real dates already on file, shown once per Kartei load, purely
// informative -- it never blocks anything, and an empty result means
// "nothing in this small known list matched", not "no follow-up needed".
//
// Deliberately a small, illustrative list of common chronic conditions with
// widely-known monitoring intervals, not a substitute for real clinical
// judgment or a licensed guideline database.
const CHRONIC_CONDITIONS = [
  { id: 'diabetes', label: 'Diabetes', keywords: ['diabetes'], months: 6 },
  { id: 'hypertonie', label: 'Hypertonie', keywords: ['hypertonie', 'bluthochdruck'], months: 6 },
  { id: 'hypothyreose', label: 'Schilddrüsenunterfunktion', keywords: ['hypothyreose', 'schilddrüsenunterfunktion'], months: 12 },
  { id: 'asthmacopd', label: 'Asthma/COPD', keywords: ['asthma', 'copd'], months: 12 },
];

function _monthsBetween(from, to) {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

// visits: array of {date, diag} for ONE patient (any object with those two
// fields works -- doctor.html's VISITS entries already have both). Returns
// null if nothing applies, else the single most-overdue match:
// {label, monthsSince, thresholdMonths}.
function detectFollowupReminder(visits, now) {
  if (!visits || !visits.length) return null;
  now = now || new Date();
  const lastDateStr = visits.reduce((max, v) => (v.date > max ? v.date : max), visits[0].date);
  const monthsSince = _monthsBetween(new Date(lastDateStr), now);
  const allDiagText = visits.map(v => (v.diag || '').toLowerCase()).join(' | ');

  let best = null;
  CHRONIC_CONDITIONS.forEach(c => {
    if (!c.keywords.some(k => allDiagText.includes(k))) return;
    if (monthsSince < c.months) return;
    const overdueBy = monthsSince - c.months;
    if (!best || overdueBy > best.overdueBy) best = { label: c.label, monthsSince, thresholdMonths: c.months, overdueBy };
  });
  return best;
}
