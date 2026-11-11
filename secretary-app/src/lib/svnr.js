// Mirrors vendor/staff-accounts.js's svnrMatchesDob() -- only checks that
// the SVNr's embedded TTMMJJ birth date matches the Geburtsdatum field,
// deliberately not the real Prüfziffer/checksum algorithm (see that file's
// own comment). Returns null ("nothing to check yet") when either field is
// still incomplete.
export function svnrMatchesDob(svnr, dobIso) {
  const digits = String(svnr || '').replace(/\D/g, '');
  if (digits.length !== 10 || !dobIso) return null;
  const d = new Date(dobIso + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  const expected = String(d.getDate()).padStart(2, '0') + String(d.getMonth() + 1).padStart(2, '0') + String(d.getFullYear()).slice(-2);
  return digits.slice(4) === expected;
}
