// Kartei "MKP" (Mutter-Kind-Pass) tab -- extracted out of doctor.html's own
// inline <script> into its own file, same reasoning/pattern as
// vendor/kartei-visits.js (VISITS/Verlauf tab): doctor.html had grown into
// one huge script mixing dozens of unrelated features together. No behavior
// change here -- every function below is moved verbatim; doctor.html loads
// this file before its own inline <script> so every global here
// (renderKarteiMkp, etc.) is still available exactly as before to
// onclick="..." attributes and other code in doctor.html itself
// (findPatientIdByFullName/findPatientByFullName/getMkpExamsForPatient/
// saveMkpExam come from vendor/patient-data.js; escapeHtml/currentStaffSession/
// showToast stay in doctor.html).
//
// MKP_EXAMS/mkpAgeDays/mkpStatusFor now live in vendor/mkp-exams.js
// (loaded before this file, see doctor.html) -- pulled out once
// patient.html needed the exact same exam list/status logic for its own
// read-only view (supabase/phase69_patient_mkp_readonly.sql).
let mkpCurrentPatientId=null;
let mkpCurrentRecords=[];
let mkpCurrentExamKey=null;
async function renderKarteiMkp(){
  const name=document.getElementById('kartei-name')?.textContent;
  const noPatientEl=document.getElementById('kMkpNoPatient');
  const listWrap=document.getElementById('kMkpListWrap');
  const formWrap=document.getElementById('kMkpFormWrap');
  formWrap.style.display='none';
  if(!name||name==='Kein Patient ausgewählt'){
    noPatientEl.style.display='block';
    listWrap.style.display='none';
    return;
  }
  noPatientEl.style.display='none';
  listWrap.style.display='block';
  const listEl=document.getElementById('kMkpList');
  listEl.innerHTML='<div style="color:#94a3b8;font-size:12px;">Lädt...</div>';
  const patientId=await findPatientIdByFullName(name);
  if(!patientId){
    listEl.innerHTML='<div style="color:#94a3b8;font-size:12px;">Dieser Patient hat noch kein Cloud-Konto — MKP-Daten können erst gespeichert werden, sobald ein echtes Patientenkonto besteht.</div>';
    return;
  }
  mkpCurrentPatientId=patientId;
  const rec=findPatientByFullName(name);
  const dob=rec?rec.accounts[rec.username].dob:null;
  const ageDays=mkpAgeDays(dob);
  mkpCurrentRecords=await getMkpExamsForPatient(patientId);
  listEl.innerHTML=MKP_EXAMS.map(function(exam){
    const record=mkpCurrentRecords.find(function(r){ return r.exam_key===exam.key; });
    const status=mkpStatusFor(exam,record,ageDays);
    return `<div class="mkp-exam-row" onclick="mkpOpenExam('${exam.key}')">
      <div style="flex:1;min-width:0;">
        <div class="mkp-exam-title">${exam.title}</div>
        <div class="mkp-exam-age">${exam.ageLabel}</div>
      </div>
      <span class="mkp-status-pill mkp-status-${status.cls}">${status.label}</span>
    </div>`;
  }).join('');
}
// MKP_EXAMS carries 130+ distinct field labels across the 13 Untersuchungen
// (body measurements, eye/ear checks, motor/speech/social development,
// orthopedic findings, vaccination status, ...) -- far too many, and too
// specific ("Wiederholt immer dieselben Laute/Silben/Worte/Tätigkeiten"), to
// hand-pick one SVG per exact label like PR1-3 did for their much shorter,
// static field lists. Instead this keyword-matches the label against the
// clinical concept it belongs to and picks the closest-fitting icon already
// established elsewhere in the icon-pass project, falling back to a generic
// file/notes icon for the long tail of one-off descriptors it doesn't
// recognize -- still on-brand, without needing a 130-entry lookup table.
const MKP_ICON_RULES=[
  [/gewicht|länge|umfang|blutdruck|gestationsalter|längendifferenz/i,'<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>'],
  [/auge|visus|strabismus|skiaskopie|amblyopie|anisometropie|hornhaut|linse|fixation|fixiert|cover-test|heterophorie|bulbus|konvergenz|parallelstand|schielen|lichtempfindlichkeit|fundus|brechende|spaltlampe|licht/i,'<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'],
  [/ohr|hör|geräusch|lärm|klingel|erschrickt|reagiert auf reize|beruhigen|ansprechen/i,'<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>'],
  [/zahn|gebiss|fluorid|mund|rachen|nase/i,'<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>'],
  [/sprache|laut|wort|silbe|imitiert|rufen|zurufe/i,'<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>'],
  [/sozial|kontakt|spielt|zieht sich/i,'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'],
  [/psychisch|psychosozial|verhalten/i,'<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>'],
  [/ernährung|stillen|trink|gedeih/i,'<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>'],
  [/risiko|dringend|empfohlen|auffäll|missbildung|krampf|erbrechen/i,'<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'],
  [/impfung|prophylaxe|vitamin|therapie|behandlung/i,'<path d="M10.5 20.5L3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7z"/><line x1="8.5" y1="8.5" x2="15.5" y2="15.5"/>'],
  [/diagnose|erkrankung|organbefund|anamnese|befund/i,'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>'],
  [/woche|kontrolle in/i,'<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'],
  [/erledigt|fällig/i,'<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 17.01"/>'],
  [/krabbeln|dreht|hebt|greif|steh|sitz|gehen|aufstehen|beweglichkeit|spontanmotorik|motorisch|kognitiv|entwicklungsstand|entwicklung|hüfte|wirbelsäule|füße|fußstellung|extremitäten|thorax|schädel|hals|schenkel|genitale|typ links|typ rechts|beckenendlage|mehrling|haltung|oberkörper|allgemeinzustand|spreizhemmung/i,'<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'],
];
const MKP_ICON_FALLBACK='<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>';
function mkpFieldIcon(label){
  const rule=MKP_ICON_RULES.find(function(r){ return r[0].test(label||''); });
  const paths=rule?rule[1]:MKP_ICON_FALLBACK;
  return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}
function mkpFieldHtml(examKey,f,val){
  const valEsc=val!=null?escapeHtml(val):'';
  const icon=mkpFieldIcon(f.label);
  if(f.type==='num'){
    return `<div class="k-form-group"><label class="k-form-label k-form-label-icon">${icon}${f.label}</label><input type="number" class="k-form-input" id="mkp-${examKey}-${f.id}" value="${valEsc}"></div>`;
  }
  if(f.type==='text'){
    return `<div class="k-form-group"><label class="k-form-label k-form-label-icon">${icon}${f.label}</label><input type="text" class="k-form-input" id="mkp-${examKey}-${f.id}" value="${valEsc}"></div>`;
  }
  if(f.type==='textarea'){
    return `<div class="k-form-group"><label class="k-form-label k-form-label-icon">${icon}${f.label}</label><textarea class="k-form-input" id="mkp-${examKey}-${f.id}" rows="2">${valEsc}</textarea></div>`;
  }
  if(f.type==='yn'){
    return `<div class="mkp-toggle-row"><span class="mkp-toggle-label">${icon}${f.label}</span><span>
      <label><input type="radio" name="mkp-${examKey}-${f.id}" value="ja" ${val==='ja'?'checked':''}> Ja</label>
      <label style="margin-left:10px;"><input type="radio" name="mkp-${examKey}-${f.id}" value="nein" ${val==='nein'?'checked':''}> Nein</label></span></div>`;
  }
  if(f.type==='status'){
    return `<div class="mkp-toggle-row"><span class="mkp-toggle-label">${icon}${f.label}</span><span>
      <label><input type="radio" name="mkp-${examKey}-${f.id}" value="unauffaellig" ${val==='unauffaellig'?'checked':''}> Unauffällig</label>
      <label style="margin-left:10px;"><input type="radio" name="mkp-${examKey}-${f.id}" value="auffaellig" ${val==='auffaellig'?'checked':''}> Auffällig</label></span></div>`;
  }
  if(f.type==='check'){
    return `<label class="mkp-check-row"><input type="checkbox" id="mkp-${examKey}-${f.id}" ${val===true?'checked':''}>${icon}${f.label}</label>`;
  }
  return '';
}
function mkpOpenExam(examKey){
  const exam=MKP_EXAMS.find(function(e){ return e.key===examKey; });
  if(!exam) return;
  mkpCurrentExamKey=examKey;
  const record=mkpCurrentRecords.find(function(r){ return r.exam_key===examKey; });
  const data=(record&&record.data)||{};
  document.getElementById('kMkpFormTitle').textContent=exam.title+' — '+exam.ageLabel;
  document.getElementById('kMkpFormFields').innerHTML=exam.fields.map(function(f){ return mkpFieldHtml(examKey,f,data[f.id]); }).join('');
  document.getElementById('kMkpListWrap').style.display='none';
  document.getElementById('kMkpFormWrap').style.display='block';
}
function mkpBackToList(){
  document.getElementById('kMkpFormWrap').style.display='none';
  document.getElementById('kMkpListWrap').style.display='block';
}
async function mkpSaveCurrentExam(){
  const exam=MKP_EXAMS.find(function(e){ return e.key===mkpCurrentExamKey; });
  if(!exam||!mkpCurrentPatientId) return;
  const data={};
  exam.fields.forEach(function(f){
    const id='mkp-'+exam.key+'-'+f.id;
    if(f.type==='num'){ const v=document.getElementById(id).value; data[f.id]=v?Number(v):null; }
    else if(f.type==='text'||f.type==='textarea'){ data[f.id]=document.getElementById(id).value||''; }
    else if(f.type==='yn'||f.type==='status'){ const el=document.querySelector('input[name="'+id+'"]:checked'); data[f.id]=el?el.value:null; }
    else if(f.type==='check'){ data[f.id]=document.getElementById(id).checked; }
  });
  try{
    const session=currentStaffSession();
    await saveMkpExam(mkpCurrentPatientId,exam.key,data,session?session.username:null);
    showToast('✓ Untersuchung gespeichert');
    mkpCurrentRecords=await getMkpExamsForPatient(mkpCurrentPatientId);
    mkpBackToList();
    renderKarteiMkp();
  }catch(e){
    showToast('✗ Speichern fehlgeschlagen','error');
  }
}
