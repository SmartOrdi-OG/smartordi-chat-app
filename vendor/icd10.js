// Search over vendor/icd10-data.js's ICD10_CODES, used to turn the free-text
// "Diagnose / ICD" field (vendor/kartei-visits.js's #kDiag) into a smart
// autocomplete without forcing structured entry -- a doctor can still type
// and save anything as before; picking a suggestion just fills in "CODE –
// Bezeichnung", the same shape the field's own placeholder already showed.
//
// ICD10_CODES is a plain synchronous global (like doctor.html's own
// VACCINE_SCHEDULE) rather than something fetched at runtime -- this catalog
// has no per-tenant or per-request data at all, and fetch() of a local file
// is blocked by CORS under the file:// pages this app's own test suite uses,
// same reasoning as every other static reference list in this codebase.
const icd10Ready = Promise.resolve(ICD10_CODES);

// Matches free text against either the code or its German label. Code-prefix
// matches are ranked before label matches so typing a real code (e.g. "J06")
// surfaces it immediately instead of it getting buried under text matches.
function searchIcd10(query, limit) {
  limit = limit || 20;
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  const codeMatches = [];
  const labelMatches = [];
  for (let i = 0; i < ICD10_CODES.length; i++) {
    const code = ICD10_CODES[i][0];
    const label = ICD10_CODES[i][1];
    if (code.toLowerCase().startsWith(q)) codeMatches.push(ICD10_CODES[i]);
    else if (label.toLowerCase().includes(q)) labelMatches.push(ICD10_CODES[i]);
  }
  return codeMatches.concat(labelMatches).slice(0, limit);
}
