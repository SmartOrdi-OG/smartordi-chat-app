// Kartei "Verlauf" (visit history) tab -- extracted out of doctor.html's own
// inline <script> into its own file, same reasoning as vendor/patient-data.js/
// vendor/staff-accounts.js: doctor.html had grown into one huge script mixing
// dozens of unrelated features together, which made the recent Kartei
// duplicate-visit-entry bug (loadKarteiVisits() racing itself) harder to spot
// than it should have been. No behavior change here -- every function below
// is moved verbatim; doctor.html loads this file before its own inline
// <script> so every global here (VISITS, loadKarteiVisits, etc.) is still
// available exactly as before to onclick="..." attributes and other code in
// doctor.html itself (findPatientIdByFullName/getVisitsForPatient/
// createPatientVisit come from vendor/patient-data.js; showToast/
// currentStaffSession/switchKarteiTab/escapeHtml stay in doctor.html).

let activeYear = 'all';
const VISITS = [];

// Fetches this patient's real visit history (supabase/phase27_patient_visits.sql)
// into the VISITS cache and re-renders -- VISITS itself used to be the ONLY
// place this data lived (never persisted anywhere), so every logged visit
// vanished on reload and never reached a second device. Clears any stale
// entries for this patient name first so repeated tab switches don't pile
// up duplicates of the same rows.
// Guards against two overlapping calls both landing rows for the same
// patient -- each call only clears out that patient's PREVIOUS rows at its
// own start, before its own await, which doesn't help if a second call
// starts while the first is still in flight (its splice runs before the
// first call's push, finds nothing to remove, and both then push their own
// copy of the same rows). This request-id check discards a call's own
// results once a newer call has superseded it, so only the latest call's
// rows ever actually land, regardless of how many overlapping calls happen.
let _karteiVisitsRequestId=0;
async function loadKarteiVisits(name){
  const requestId=++_karteiVisitsRequestId;
  for(let i=VISITS.length-1;i>=0;i--){ if(VISITS[i].patient===name) VISITS.splice(i,1); }
  if(!name||name==='Kein Patient ausgewählt'){ renderYearPills();filterVisits(); return; }
  const patientId=await findPatientIdByFullName(name);
  if(requestId!==_karteiVisitsRequestId) return;
  if(!patientId){ renderYearPills();filterVisits(); return; }
  const rows=await getVisitsForPatient(patientId);
  if(requestId!==_karteiVisitsRequestId) return;
  rows.forEach(r=>{
    VISITS.push({patient:name,date:r.visit_date,type:r.visit_type,beschwerde:r.beschwerde||'',temp:r.temperature||'',bd:r.blutdruck||'',schmerz:r.schmerz||'',diag:r.diagnose||'Keine Diagnose',notes:r.notes||'–',therapy:r.therapy||''});
  });
  renderYearPills();filterVisits();
}

function renderYearPills(){
  const patientName=document.getElementById('kartei-name')?.textContent;
  const years=[...new Set(VISITS.filter(v=>v.patient===patientName).map(v=>v.date.slice(0,4)))].sort((a,b)=>b-a);
  const c=document.getElementById('kYearPills');
  if(!c)return;
  c.innerHTML=`<button class="k-year-pill ${activeYear==='all'?'active':''}" onclick="setYear('all',this)">Alle</button>`+
    years.map(y=>`<button class="k-year-pill ${activeYear===y?'active':''}" onclick="setYear('${y}',this)">${y}</button>`).join('');
}

function setYear(year,btn){
  activeYear=year;
  document.querySelectorAll('.k-year-pill').forEach(p=>p.classList.remove('active'));
  if(btn)btn.classList.add('active');
  filterVisits();
}

function filterVisits(){
  const q=(document.getElementById('kSearch')?.value||'').toLowerCase();
  const patientName=document.getElementById('kartei-name')?.textContent;
  const filtered=VISITS.filter(v=>{
    const pm=v.patient===patientName;
    const ym=activeYear==='all'||v.date.startsWith(activeYear);
    const tm=!q||[v.diag,v.notes,v.type,v.therapy||''].some(s=>s.toLowerCase().includes(q));
    return pm&&ym&&tm;
  });
  renderVisitList(filtered);
}

const TYPE_STYLE={
  'Notfall':    'background:#fef2f2;color:#dc2626',
  'Erstgespräch':'background:#f0fdf4;color:#16a34a',
  'Telefonisch':'background:#f0f9ff;color:#0284c7',
  'Kontrolle':  'background:#fef9c3;color:#854d0e',
  'Ordination': 'background:#f1f5f9;color:#475569',
};

function renderVisitList(list){
  const c=document.getElementById('kVisitList');
  const cnt=document.getElementById('kVisitCount');
  if(!c)return;
  if(cnt) cnt.textContent=`${list.length} Einträge${activeYear!=='all'?' · '+activeYear:''}`;
  if(!list.length){c.innerHTML=`<div class="k-empty-state"><div class="k-empty-icon">📋</div>Keine Einträge gefunden</div>`;return;}
  c.innerHTML=list.map(v=>{
    const fmt=new Date(v.date).toLocaleDateString('de-AT',{day:'2-digit',month:'2-digit',year:'numeric'});
    const ts=TYPE_STYLE[v.type]||TYPE_STYLE['Ordination'];
    const vitals=[
      v.beschwerde?`Beschwerde: ${escapeHtml(v.beschwerde)}`:'',
      v.temp?`Temp. ${escapeHtml(v.temp)}`:'',
      v.bd?`RR ${escapeHtml(v.bd)}`:'',
      v.schmerz?`Schmerz ${escapeHtml(v.schmerz)}/10`:'',
    ].filter(Boolean).join(' · ');
    return `<div class="k-visit">
      <div class="k-visit-header"><span class="k-visit-date">${fmt}</span><span class="k-visit-type" style="${ts}">${escapeHtml(v.type)}</span></div>
      <div class="k-visit-diag">${escapeHtml(v.diag)}</div>
      ${vitals?`<div class="k-visit-notes" style="color:#0891b2;font-weight:600;">${vitals}</div>`:''}
      <div class="k-visit-notes">${escapeHtml(v.notes)}</div>
      ${v.therapy?`<span class="k-visit-therapy"> ${escapeHtml(v.therapy)}</span>`:''}
    </div>`;
  }).join('');
}

// ICD-10 autocomplete for #kDiag (see vendor/icd10.js for the data/search
// itself) -- same results-dropdown pattern as secretary.html's
// #ntPatientSearch/#ntPatientResults appointment-booking patient search.
let _icd10DiagResults = [];
function icdDiagSearch() {
  const q = document.getElementById('kDiag').value;
  const resultsEl = document.getElementById('kDiagResults');
  const results = searchIcd10(q, 20);
  _icd10DiagResults = results;
  if (!results.length) { resultsEl.style.display = 'none'; resultsEl.innerHTML = ''; return; }
  resultsEl.innerHTML = results.map((r, i) =>
    `<div onmousedown="selectIcd10Diag(${i})" style="padding:9px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #f1f5f9;"><b>${escapeHtml(r[0])}</b> – ${escapeHtml(r[1])}</div>`
  ).join('');
  resultsEl.style.display = 'block';
}
function selectIcd10Diag(i) {
  const r = _icd10DiagResults[i];
  if (!r) return;
  document.getElementById('kDiag').value = r[0] + ' – ' + r[1];
  document.getElementById('kDiagResults').style.display = 'none';
}

// Real bug this used to have: nothing here ever reached Supabase -- every
// logged visit lived only in the in-memory VISITS array and vanished on
// reload (supabase/phase27_patient_visits.sql). Now inserts a real row
// first, then re-fetches the Verlauf tab from that same source of truth
// (via switchKarteiTab below) so the UI reflects exactly what's actually
// persisted instead of a locally-guessed shape.
async function saveKarteiVisit(){
  const patient=document.getElementById('kartei-name')?.textContent||'';
  const date=document.getElementById('kDate').value;
  const type=document.getElementById('kType').value;
  const beschwerde=document.getElementById('kBeschwerde').value.trim();
  const temp=document.getElementById('kTemp').value.trim();
  const bd=document.getElementById('kBD').value.trim();
  const schmerz=document.getElementById('kSchmerz').value;
  const diag=document.getElementById('kDiag').value.trim()||'Keine Diagnose';
  const notes=document.getElementById('kNotes').value.trim()||'–';
  const therapy=document.getElementById('kTherapy').value.trim();
  if(!date){ showToast('Bitte ein Datum angeben.','error'); return; }
  const patientId=await findPatientIdByFullName(patient);
  if(!patientId){ showToast('Dieser Patient hat noch kein Cloud-Konto — Besuche können erst gespeichert werden, sobald ein echtes Patientenkonto besteht.','error'); return; }
  try{
    const session=currentStaffSession();
    await createPatientVisit(patientId,{date,type,beschwerde,temp,bd,schmerz,diag,notes,therapy},session?session.username:null);
  }catch(e){
    showToast('✗ Speichern fehlgeschlagen','error');
    return;
  }
  document.getElementById('kBeschwerde').value='';
  document.getElementById('kTemp').value='';
  document.getElementById('kBD').value='';
  document.getElementById('kSchmerz').value='';
  document.getElementById('kDiag').value='';
  document.getElementById('kNotes').value='';
  document.getElementById('kTherapy').value='';
  activeYear='all';
  switchKarteiTab('verlauf',document.querySelectorAll('.kartei-tab')[0]);
  const msgs=document.getElementById('messages');
  if(msgs){
    const fmt=new Date(date).toLocaleDateString('de-AT',{day:'2-digit',month:'2-digit',year:'numeric'});
    const sys=document.createElement('div');
    sys.className='system-msg';
    sys.style.cssText='background:#f0fdfa;border-color:#99f6e4;color:#0f766e;';
    sys.textContent=` Kartei aktualisiert: ${type} vom ${fmt}`;
    msgs.appendChild(sys);msgs.scrollTop=msgs.scrollHeight;
  }
}
