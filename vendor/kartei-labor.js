// Kartei "Labor" tab -- extracted out of doctor.html's own inline <script>
// into its own file, same reasoning/pattern as vendor/kartei-visits.js/
// vendor/kartei-mkp.js/vendor/kartei-documents.js: doctor.html had grown
// into one huge script mixing dozens of unrelated features together. No
// behavior change here -- every function below is moved verbatim;
// doctor.html loads this file before its own inline <script> so every
// global here is still available exactly as before to onclick="..."
// attributes and other code in doctor.html itself.
// deleteKarteiDocument()/downloadKarteiDocument() (vendor/kartei-documents.js)
// and fileToBase64()/formatFileSize() (doctor.html) are shared with the
// Dokumente tab, since Labor is a category-filtered lens over the same
// patient_documents table; getDocumentsForPatient/uploadPatientDocument
// come from vendor/patient-data.js.

// ══ LABOR FUNCTIONS ══
// Labor is a category-filtered lens over the same real patient_documents
// table as the Dokumente tab (category='befund') -- a lab PDF uploaded
// here shows up in the patient's Dokumente tab under Befunde too, and vice
// versa. Replaces what used to be a manual, localStorage-only text-entry
// form (art/ergebnis/status/institut) that was never actually shared with
// the patient.
async function renderKarteiLabor(){
  const name=document.getElementById('kartei-name')?.textContent;
  const noPatientEl=document.getElementById('kLaborNoPatient');
  const contentEl=document.getElementById('kLaborContent');
  if(!name||name==='Kein Patient ausgewählt'){
    if(noPatientEl)noPatientEl.style.display='block';
    if(contentEl)contentEl.style.display='none';
    return;
  }
  if(noPatientEl)noPatientEl.style.display='none';
  if(contentEl)contentEl.style.display='block';
  const listEl=document.getElementById('labor-liste');
  listEl.innerHTML='<div style="color:#94a3b8;font-size:12px;">Lädt...</div>';
  const patientId=await findPatientIdByFullName(name);
  if(!patientId){
    listEl.innerHTML='<div style="color:#94a3b8;font-size:12px;">Dieser Patient hat noch kein Cloud-Konto — Befunde können erst hochgeladen werden, sobald ein echtes Patientenkonto besteht.</div>';
    return;
  }
  const docs=(await getDocumentsForPatient(patientId)).filter(function(d){ return d.category==='befund'; });
  if(!docs.length){
    listEl.innerHTML='<div style="color:#94a3b8;font-size:12px;">Noch keine Befunde hochgeladen.</div>';
    return;
  }
  listEl.innerHTML=docs.map(function(d){ return karteiLaborRowHtml(d); }).join('');
}
// A row is either a real uploaded PDF (file_data, downloadable) or a quick
// free-text note jotted down for an in-office test with no report to
// upload (body_text, shown inline instead of a download button).
function karteiLaborRowHtml(d){
  const df=new Date(d.created_at).toLocaleDateString('de-AT');
  if(d.body_text){
    return `<div style="background:white;border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:8px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <div style="font-size:13px;font-weight:700;color:#0f172a;">${escapeHtml(d.title)}</div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:11px;color:#94a3b8;">${df}</span>
          <button onclick="deleteKarteiDocument('${d.id}')" title="Löschen" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:14px;padding:4px;">🗑</button>
        </div>
      </div>
      <div style="font-size:12px;color:#475569;line-height:1.5;white-space:pre-wrap;">${escapeHtml(d.body_text)}</div>
    </div>`;
  }
  return `<div style="background:white;border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:8px;display:flex;align-items:center;gap:12px;">
    <div style="width:36px;height:36px;background:#fef2f2;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;">📄</div>
    <div style="flex:1;min-width:0;">
      <div style="font-size:13px;font-weight:700;color:#0f172a;">${escapeHtml(d.title)}</div>
      <div style="font-size:11px;color:#94a3b8;">${df} · ${formatFileSize(d.size_bytes)}</div>
    </div>
    <button onclick="downloadKarteiDocument('${d.id}')" style="background:#fef2f2;border:1px solid #fecaca;border-radius:7px;padding:6px 10px;font-size:11px;font-weight:700;color:#dc2626;cursor:pointer;font-family:inherit;white-space:nowrap;">⬇ PDF</button>
    <button onclick="deleteKarteiDocument('${d.id}')" title="Löschen" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:14px;padding:4px;">🗑</button>
  </div>`;
}
async function saveKarteiLaborNote(){
  const name=document.getElementById('kartei-name')?.textContent;
  if(!name||name==='Kein Patient ausgewählt') return;
  const title=document.getElementById('kLaborNoteTitel').value.trim();
  if(!title){ showToast('Bitte einen Titel eingeben.','error'); return; }
  const text=document.getElementById('kLaborNoteText').value.trim();
  if(!text){ showToast('Bitte ein Ergebnis eingeben.','error'); return; }
  const patientId=await findPatientIdByFullName(name);
  if(!patientId){ showToast('Dieser Patient hat noch kein Cloud-Konto.','error'); return; }
  const btn=document.getElementById('kLaborNoteBtn');
  const originalLabel=btn.innerHTML;
  btn.disabled=true; btn.textContent='Wird gespeichert...';
  try{
    const session=currentStaffSession();
    await uploadPatientDocument(patientId,{
      category:'befund', title:title, bodyText:text,
    },session?session.username:null);
    document.getElementById('kLaborNoteTitel').value='';
    document.getElementById('kLaborNoteText').value='';
    showToast('✓ Notiz gespeichert');
    renderKarteiLabor();
  }catch(e){
    showToast('✗ Speichern fehlgeschlagen','error');
  }finally{
    btn.disabled=false; btn.innerHTML=originalLabel;
  }
}
async function uploadKarteiLaborDoc(){
  const name=document.getElementById('kartei-name')?.textContent;
  if(!name||name==='Kein Patient ausgewählt') return;
  const fileInput=document.getElementById('kLaborFile');
  const file=fileInput.files[0];
  if(!file){ showToast('Bitte zuerst eine PDF-Datei auswählen.','error'); return; }
  if(file.type!=='application/pdf'){ showToast('Nur PDF-Dateien sind erlaubt.','error'); return; }
  if(file.size>getPlanUploadMaxBytes()){ showToast('Datei ist zu groß (max. '+formatUploadMaxLabel()+').','error'); return; }
  const title=document.getElementById('kLaborTitel').value.trim();
  if(!title){ showToast('Bitte einen Titel eingeben.','error'); return; }
  const patientId=await findPatientIdByFullName(name);
  if(!patientId){ showToast('Dieser Patient hat noch kein Cloud-Konto.','error'); return; }
  const btn=document.getElementById('kLaborUploadBtn');
  const originalLabel=btn.innerHTML;
  btn.disabled=true; btn.textContent='Wird hochgeladen...';
  try{
    const base64Data=await fileToBase64(file);
    const session=currentStaffSession();
    await uploadPatientDocument(patientId,{
      category:'befund', title:title, filename:file.name, mimeType:file.type, sizeBytes:file.size, base64Data:base64Data,
    },session?session.username:null);
    document.getElementById('kLaborTitel').value='';
    fileInput.value='';
    showToast('✓ Befund hochgeladen');
    renderKarteiLabor();
  }catch(e){
    showToast('✗ Hochladen fehlgeschlagen','error');
  }finally{
    btn.disabled=false; btn.innerHTML=originalLabel;
  }
}
