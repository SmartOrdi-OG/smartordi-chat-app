// secretary.html's "Erweiterte Suche" sidebar filter + live patient search
// -- extracted out of its own inline <script> into its own file, same
// reasoning/pattern as doctor.html's vendor/kartei-advanced-search.js (this
// is secretary.html's own parallel implementation, over a different DOM
// structure -- .patient-row/.p-meta/sec-svnr here vs .patient-item/
// data-svnr/adv-svnr there -- so it's its own file rather than a shared
// one). No behavior change -- every function below is moved verbatim;
// secretary.html loads this file before its own inline <script> so every
// global here (secAdvSearch, filterPatients, etc.) is still available
// exactly as before to onclick="..."/oninput="..." attributes and other
// code in secretary.html itself (renderRealPatientRows/isRealSelectable
// Patient/accountToPatientEntry/renderPatientRowsList stay in secretary.
// html; debounce/searchPatientsServer come from vendor/patient-data.js).
function secAdvSearch(){
  const svnr=(document.getElementById('sec-svnr').value||'').toLowerCase();
  const vers=(document.getElementById('sec-vers').value||'').toLowerCase();
  document.querySelectorAll('.patient-row').forEach(row=>{
    const meta=(row.querySelector('.p-meta')?.textContent||'').toLowerCase();
    const svMatch=!svnr||meta.includes(svnr);
    const versMatch=!vers||meta.includes(vers);
    row.style.display=(svMatch&&versMatch)?'':'none';
  });
}

function clearSecAdvSearch(){
  document.getElementById('sec-svnr').value='';
  document.getElementById('sec-dob').value='';
  document.getElementById('sec-vers').value='';
  document.querySelectorAll('.patient-row').forEach(r=>r.style.display='');
}

// Real live search (searchPatientsServer(), vendor/patient-data.js) instead
// of hiding/showing whatever .patient-row rows renderRealPatientRows()
// already put on screen -- that only ever covered the ≤500-most-recently-
// active patients loadPatients() itself is bounded to, so a patient outside
// that window was invisible to the one search box a secretary actually
// uses day to day, even though this same live search already existed and
// was used elsewhere (Termin booking, CSV-import matching). Matches by
// name OR SV-Nummer now too, same as before.
// "Erweiterte Suche" (secAdvSearch() below) still filters the already-
// rendered list only -- same limitation, left for a follow-up (see
// TODO.md), matching the same deliberate scope doctor.html's advSearch()
// was left at.
async function filterPatients(q){
  const query=(q||'').trim();
  if(!query){
    renderRealPatientRows(); // restores the normal full list
    return;
  }
  const results=await searchPatientsServer(query,50);
  // A fast typist can trigger a newer search before an older, slower one's
  // response lands -- discard a stale response instead of flashing
  // outdated results over whatever's currently typed.
  const input=document.getElementById('secPatientSearchInput');
  if(input&&input.value.trim()!==query) return;
  const listRoot=document.getElementById('patientList');
  if(!listRoot) return;
  const entries=results.filter(isRealSelectablePatient).map(accountToPatientEntry).sort((a,b)=>a.name.localeCompare(b.name,'de'));
  renderPatientRowsList(listRoot,entries);
}
const filterPatientsDebounced=debounce(filterPatients,300);
