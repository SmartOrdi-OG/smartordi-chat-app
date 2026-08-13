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
function mkpFieldHtml(examKey,f,val){
  const valEsc=val!=null?escapeHtml(val):'';
  if(f.type==='num'){
    return `<div class="k-form-group"><label class="k-form-label">${f.label}</label><input type="number" class="k-form-input" id="mkp-${examKey}-${f.id}" value="${valEsc}"></div>`;
  }
  if(f.type==='text'){
    return `<div class="k-form-group"><label class="k-form-label">${f.label}</label><input type="text" class="k-form-input" id="mkp-${examKey}-${f.id}" value="${valEsc}"></div>`;
  }
  if(f.type==='textarea'){
    return `<div class="k-form-group"><label class="k-form-label">${f.label}</label><textarea class="k-form-input" id="mkp-${examKey}-${f.id}" rows="2">${valEsc}</textarea></div>`;
  }
  if(f.type==='yn'){
    return `<div class="mkp-toggle-row"><span class="mkp-toggle-label">${f.label}</span><span>
      <label><input type="radio" name="mkp-${examKey}-${f.id}" value="ja" ${val==='ja'?'checked':''}> Ja</label>
      <label style="margin-left:10px;"><input type="radio" name="mkp-${examKey}-${f.id}" value="nein" ${val==='nein'?'checked':''}> Nein</label></span></div>`;
  }
  if(f.type==='status'){
    return `<div class="mkp-toggle-row"><span class="mkp-toggle-label">${f.label}</span><span>
      <label><input type="radio" name="mkp-${examKey}-${f.id}" value="unauffaellig" ${val==='unauffaellig'?'checked':''}> Unauffällig</label>
      <label style="margin-left:10px;"><input type="radio" name="mkp-${examKey}-${f.id}" value="auffaellig" ${val==='auffaellig'?'checked':''}> Auffällig</label></span></div>`;
  }
  if(f.type==='check'){
    return `<label class="mkp-check-row"><input type="checkbox" id="mkp-${examKey}-${f.id}" ${val===true?'checked':''}> ${f.label}</label>`;
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
