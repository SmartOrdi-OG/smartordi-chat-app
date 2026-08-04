// Kartei "Dokumente" tab -- extracted out of doctor.html's own inline
// <script> into its own file, same reasoning/pattern as
// vendor/kartei-visits.js/vendor/kartei-mkp.js: doctor.html had grown into
// one huge script mixing dozens of unrelated features together. No behavior
// change here -- every function/constant below is moved verbatim;
// doctor.html loads this file before its own inline <script> so every
// global here is still available exactly as before to onclick="..."
// attributes and other code in doctor.html itself.
// fileToBase64()/formatFileSize() stay in doctor.html -- they're shared
// utilities also used by the chat file-attach flow, the Kartei report
// sender, and the Labor document upload, not specific to this tab.
// getDocumentsForPatient/getPatientDocumentFile/uploadPatientDocument/
// deletePatientDocument come from vendor/patient-data.js; escapeHtml/
// showToast/currentStaffSession/findPatientIdByFullName/
// getPlanUploadMaxBytes/formatUploadMaxLabel stay in doctor.html.

// ══ KARTEI DOKUMENTE (real, Supabase-backed patient_documents -- unlike
// Labor/Impfpass above, this is genuinely shared: what's uploaded here is
// what the patient sees in their own Dokumente tab) ══

const DOK_KATEGORIE_LABEL={befund:'Befund',ueberweisung:'Überweisung',rezept:'Rezept',sonstiges:'Sonstiges'};

async function renderKarteiDocuments(){
  const name=document.getElementById('kartei-name')?.textContent;
  const noPatientEl=document.getElementById('kDokNoPatient');
  const contentEl=document.getElementById('kDokContent');
  if(!name||name==='Kein Patient ausgewählt'){
    if(noPatientEl)noPatientEl.style.display='block';
    if(contentEl)contentEl.style.display='none';
    return;
  }
  if(noPatientEl)noPatientEl.style.display='none';
  if(contentEl)contentEl.style.display='block';
  const listEl=document.getElementById('kDokListe');
  listEl.innerHTML='<div style="color:#94a3b8;font-size:12px;">Lädt...</div>';
  const patientId=await findPatientIdByFullName(name);
  if(!patientId){
    listEl.innerHTML='<div style="color:#94a3b8;font-size:12px;">Dieser Patient hat noch kein Cloud-Konto — Dokumente können erst hochgeladen werden, sobald ein echtes Patientenkonto besteht.</div>';
    return;
  }
  listEl.dataset.patientId=patientId;
  const docs=await getDocumentsForPatient(patientId);
  if(!docs.length){
    listEl.innerHTML='<div style="color:#94a3b8;font-size:12px;">Noch keine Dokumente hochgeladen.</div>';
    return;
  }
  listEl.innerHTML=docs.map(function(d){ return karteiDokRowHtml(d); }).join('');
}
// Same real/text split as karteiLaborRowHtml, teal-themed to match this tab.
function karteiDokRowHtml(d){
  const df=new Date(d.created_at).toLocaleDateString('de-AT');
  if(d.body_text){
    return `<div style="background:white;border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:8px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <div style="font-size:13px;font-weight:700;color:#0f172a;">${escapeHtml(d.title)}</div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:11px;color:#94a3b8;">${escapeHtml(DOK_KATEGORIE_LABEL[d.category]||d.category)} · ${df}</span>
          <button onclick="deleteKarteiDocument('${d.id}')" title="Löschen" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:14px;padding:4px;">🗑</button>
        </div>
      </div>
      <div style="font-size:12px;color:#475569;line-height:1.5;white-space:pre-wrap;">${escapeHtml(d.body_text)}</div>
    </div>`;
  }
  return `<div style="background:white;border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:8px;display:flex;align-items:center;gap:12px;">
    <div style="width:36px;height:36px;background:#EAF4F1;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;">📄</div>
    <div style="flex:1;min-width:0;">
      <div style="font-size:13px;font-weight:700;color:#0f172a;">${escapeHtml(d.title)}</div>
      <div style="font-size:11px;color:#94a3b8;">${escapeHtml(DOK_KATEGORIE_LABEL[d.category]||d.category)} · ${df} · ${formatFileSize(d.size_bytes)}</div>
    </div>
    <button onclick="downloadKarteiDocument('${d.id}')" style="background:#EAF4F1;border:1px solid #bfdbfe;border-radius:7px;padding:6px 10px;font-size:11px;font-weight:700;color:#0E5E56;cursor:pointer;font-family:inherit;white-space:nowrap;">⬇ PDF</button>
    <button onclick="deleteKarteiDocument('${d.id}')" title="Löschen" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:14px;padding:4px;">🗑</button>
  </div>`;
}
async function uploadKarteiDocument(){
  const name=document.getElementById('kartei-name')?.textContent;
  if(!name||name==='Kein Patient ausgewählt') return;
  const fileInput=document.getElementById('kDokFile');
  const file=fileInput.files[0];
  if(!file){ showToast('Bitte zuerst eine PDF-Datei auswählen.','error'); return; }
  if(file.type!=='application/pdf'){ showToast('Nur PDF-Dateien sind erlaubt.','error'); return; }
  if(file.size>getPlanUploadMaxBytes()){ showToast('Datei ist zu groß (max. '+formatUploadMaxLabel()+').','error'); return; }
  const title=document.getElementById('kDokTitel').value.trim();
  if(!title){ showToast('Bitte einen Titel eingeben.','error'); return; }
  const category=document.getElementById('kDokKategorie').value;
  const patientId=await findPatientIdByFullName(name);
  if(!patientId){ showToast('Dieser Patient hat noch kein Cloud-Konto.','error'); return; }
  const btn=document.getElementById('kDokUploadBtn');
  const originalLabel=btn.innerHTML;
  btn.disabled=true; btn.textContent='Wird hochgeladen...';
  try{
    const base64Data=await fileToBase64(file);
    const session=currentStaffSession();
    await uploadPatientDocument(patientId,{
      category:category, title:title, filename:file.name, mimeType:file.type, sizeBytes:file.size, base64Data:base64Data,
    },session?session.username:null);
    document.getElementById('kDokTitel').value='';
    fileInput.value='';
    showToast('✓ Dokument hochgeladen');
    renderKarteiDocuments();
  }catch(e){
    showToast('✗ Hochladen fehlgeschlagen','error');
  }finally{
    btn.disabled=false; btn.innerHTML=originalLabel;
  }
}
async function downloadKarteiDocument(docId){
  const file=await getPatientDocumentFile(docId);
  if(!file){ showToast('✗ Datei konnte nicht geladen werden','error'); return; }
  const blob=await (await fetch('data:'+file.mimeType+';base64,'+file.base64)).blob();
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=file.filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); },4000);
}
async function deleteKarteiDocument(docId){
  if(!await showConfirmDialog('Dieses Dokument wirklich löschen?')) return;
  try{
    await deletePatientDocument(docId);
    renderKarteiDocuments();
  }catch(e){
    showToast('✗ Löschen fehlgeschlagen','error');
  }
}
