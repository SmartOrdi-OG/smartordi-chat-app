// Praxis sidebar "Erweiterte Suche" (filter panel over the already-rendered
// patient list) -- extracted out of doctor.html's own inline <script> into
// its own file, same reasoning/pattern as vendor/kartei-visits.js and the
// other vendor/kartei-*.js files: doctor.html had grown into one huge
// script mixing dozens of unrelated features together. No behavior change
// here -- every function below is moved verbatim; doctor.html loads this
// file before its own inline <script> so every global here (toggleAdvSearch,
// filterPatientsList, etc.) is still available exactly as before to
// onclick="..." attributes and other code in doctor.html itself
// (renderPatientList/applyAllPatientsCollapsedState/isAllPatientsCollapsed/
// todaysTerminByPatient/patientItemHtml stay in doctor.html; debounce/
// searchPatientsServer come from vendor/patient-data.js).
// ══ ADVANCED SEARCH ══
function toggleAdvSearch(){
  const panel=document.getElementById('adv-search-panel');
  const btn=document.getElementById('adv-search-btn');
  const open=panel.style.display==='none';
  panel.style.display=open?'block':'none';
  btn.textContent=open?'Schließen':'Filter';
  btn.style.background=open?'#fee2e2':' #EAF4F1';
  btn.style.color=open?'#dc2626':'#0E5E56';
  btn.style.borderColor=open?'#fecaca':'#bfdbfe';
}

// advSearch() (below) still toggles individual .patient-item elements' own
// display style, but a MATCH inside "Alle Patienten" would stay invisible
// if that whole section is still collapsed (see
// applyAllPatientsCollapsedState() above) -- both this function and
// advSearch() force the section open for the duration of an active search,
// WITHOUT touching the doctor's actual stored collapse preference, which
// clearAdvSearch() (no active filter left)/an empty query here restores.
//
// Real live search (searchPatientsServer(), vendor/patient-data.js) instead
// of hiding/showing whatever .patient-item rows renderPatientList() already
// put on screen -- that only ever covered the ≤500-most-recently-active
// patients loadPatients() itself is bounded to, so a patient outside that
// window was invisible to the one search box a doctor actually uses day to
// day, even though this same live search already existed and was used
// elsewhere (Termin booking, CSV-import matching). Matches by name OR SV-
// Nummer now too, which the old plain substring-over-name match didn't.
// "Erweiterte Suche" (advSearch() below) still filters the already-rendered
// list only -- same limitation, left for a follow-up (see TODO.md).
async function filterPatientsList(val){
  const q=(val||'').trim();
  if(!q){
    renderPatientList(); // restores the normal Heute/Alle-Patienten split
    return;
  }
  // Force the section open immediately (before the round-trip resolves) so
  // it doesn't sit collapsed while a result is already on its way.
  applyAllPatientsCollapsedState(false);
  const activeName=document.getElementById('chat-name')?.textContent||'';
  const todayMap=todaysTerminByPatient();
  const results=await searchPatientsServer(q,50);
  // A fast typist can trigger a newer search before an older, slower one's
  // response lands -- discard a stale response instead of flashing
  // outdated results over whatever's currently typed.
  const input=document.getElementById('patientSearchInput');
  if(input&&input.value.trim()!==q) return;
  const group=document.getElementById('allPatientsGroup');
  if(!group) return;
  // Excludes anyone already shown in "Heute" so a match with today's
  // appointment doesn't appear twice (once there, once here).
  const filtered=results.filter(r=>!todayMap[r.fullName]);
  group.innerHTML=filtered.map(r=>patientItemHtml({
    name:r.fullName,color:'#0E5E56',versicherung:r.versicherung||'',svnr:r.svnr||'',dob:r.dob||'',
    preview:'',time:'',badge:0,dynamic:false,
  },activeName,null)).join('');
}
const filterPatientsListDebounced=debounce(filterPatientsList,300);

function advSearch(){
  const svnr=(document.getElementById('adv-svnr').value||'').toLowerCase();
  const dob=document.getElementById('adv-dob').value;
  const vers=(document.getElementById('adv-versicherung').value||'').toLowerCase();
  const items=document.querySelectorAll('.patient-item');
  items.forEach(item=>{
    // Reads the data-svnr/data-dob/data-versicherung attributes
    // patientItemHtml() now sets -- .patient-meta's own visible text never
    // held this data (only the appointment time/unread badge), so this
    // filter was previously a silent no-op. Found in a full app-wide bug
    // audit (2026-07-29).
    const svMatch=!svnr||(item.dataset.svnr||'').toLowerCase().includes(svnr);
    const dobMatch=!dob||item.dataset.dob===dob;
    const versMatch=!vers||(item.dataset.versicherung||'').toLowerCase().includes(vers);
    item.style.display=(svMatch&&dobMatch&&versMatch)?'':'none';
  });
  applyAllPatientsCollapsedState(false);
}

function clearAdvSearch(){
  document.getElementById('adv-svnr').value='';
  document.getElementById('adv-dob').value='';
  document.getElementById('adv-versicherung').value='';
  document.querySelectorAll('.patient-item').forEach(i=>i.style.display='');
  applyAllPatientsCollapsedState(isAllPatientsCollapsed());
}
