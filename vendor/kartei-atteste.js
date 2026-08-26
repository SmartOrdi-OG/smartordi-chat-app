// Kartei "Pflegefreistellung" (Antrag auf Pflegefreistellung, § 16
// Urlaubsgesetz) and "Arbeitsunfähigkeit" (Arbeitsunfähigkeitsmeldung /
// Krankenstandsbestätigung) document generation -- supabase/
// phase51_atteste.sql. Shared between doctor.html (its own Kartei tab,
// under the "Mehr" dropdown) and secretary.html (a per-patient modal opened
// from the chat pane header) -- unlike vendor/kartei-rezept-ueberweisung.js,
// this file deliberately avoids every doctor.html-only global (kartei-name,
// findPatientRecordAsync, currentStaffSession, appendRealMessage...): every
// build/print/download function below takes the patient's full name as an
// explicit argument instead (defaulting to #kartei-name for doctor.html's
// own tab call sites, which pass none), and reads the staff session
// directly off sessionStorage rather than through doctor.html's
// currentStaffSession() helper. Same jsPDF direct-drawing (T/L/R helper)
// pattern as buildRezeptPdf() in vendor/kartei-rezept-ueberweisung.js.
//
// Print/download, plus "Per Chat senden" on doctor.html only (real user
// request, 2026-08-18) -- both documents are physically signed/stamped
// paper forms the patient (or their relative) hands to a third party
// (employer, Krankenkasse), but the patient often wants/needs a digital
// copy of their own too, same reasoning that already applies to Rezept/
// Überweisung. secretary.html still has no doc-message-to-chat
// infrastructure of its own to reuse (doctor.html's appendRealMessage()/
// renderMessages() aren't available there), so sendPflegefreistellungToChat()/
// sendArbeitsunfaehigkeitToChat() below guard for that instead of assuming
// it -- there is deliberately no "Per Chat senden" button in secretary.html's
// own modal for these two documents yet.

function _attestSession(){
  try{ return JSON.parse(sessionStorage.getItem('smartordi_user')); }catch(e){ return null; }
}

// Whose name/Fachrichtung/stamp/signature to print as the issuing doctor.
// When a doctor is themselves issuing it, that's simply their own
// staff_profiles row (looked up by session.username, which is the auth
// user id -- same id staff_profiles.id uses, see loadStaffAccounts()). A
// secretary has no such row of their own -- for them, issuing staff is
// always "the practice's doctor" (falls back to the first role==='arzt'
// account in the roster; a practice with more than one doctor would need
// the secretary to pick one explicitly, not yet supported).
function resolveAttestArztInfo(){
  const session=_attestSession();
  const roster=loadStaffAccounts()||{};
  if(session && roster[session.username] && roster[session.username].role==='arzt'){
    return roster[session.username];
  }
  return Object.values(roster).find(a=>a.role==='arzt')||null;
}

// doctor.html already defines its own openPdfAndPrint() (hidden-iframe
// print); secretary.html has none, so this only fills in the gap there --
// never overrides doctor.html's existing one.
window.openPdfAndPrint = window.openPdfAndPrint || function(blobUrl){
  const iframe=document.createElement('iframe');
  iframe.style.cssText='position:fixed;top:-10000px;left:-10000px;width:1px;height:1px;border:0;';
  iframe.src=blobUrl;
  document.body.appendChild(iframe);
  const cleanup=()=>iframe.remove();
  iframe.onload=()=>{
    try{ iframe.contentWindow.focus(); iframe.contentWindow.print(); }
    catch(e){ cleanup(); window.open(blobUrl); }
  };
  window.addEventListener('afterprint',cleanup,{once:true});
  setTimeout(cleanup,120000);
};

function attestFmtDate(iso){
  if(!iso) return '—';
  const d=new Date(iso);
  if(isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('de-AT');
}

// doctor.html's own Kartei tab-switch calls this with no argument (falls
// back to #kartei-name); secretary.html's modal passes the patient it
// opened the modal for explicitly, since it has no #kartei-name element.
function _attestCurrentName(override){
  if(override) return override;
  return document.getElementById('kartei-name')?.textContent;
}

// ══ PFLEGEFREISTELLUNG ══
// patient_id (and the "Zu pflegende Person" box below) is always the
// CURRENTLY OPEN patient -- the Angehörige who needed care -- never the
// Antragsteller (the working relative applying for leave at their own
// employer, who may not be a patient here at all, so stored as free text).

async function buildPflegefreistellungPdf(patientNameOverride){
  if(typeof window.jspdf==='undefined'){ alert('jsPDF lädt... Bitte nochmal versuchen.'); return null; }
  const patientName=_attestCurrentName(patientNameOverride);
  if(!patientName||patientName==='Kein Patient ausgewählt'){ showToast('Bitte zuerst einen Patienten auswählen.'); return null; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  const account = await findPatientAccountAsync(patientName);
  const arzt = resolveAttestArztInfo();
  const practice = getPracticeSettings();

  const antragsteller = document.getElementById('pf-antragsteller').value||'';
  const verwandtschaft = document.getElementById('pf-verwandtschaft').value||'';
  const von = document.getElementById('pf-von').value||'';
  const bis = document.getElementById('pf-bis').value||'';
  const ort = document.getElementById('pf-ort').value||'';

  // align (7th arg, optional): jsPDF's own text-alignment option -- used
  // below to center the issuing doctor's name/date directly under the
  // signature image instead of left-aligning it at the image's left edge,
  // which visually reads as "next to", not "under", the actual ink.
  const T=(text,x,y,size=10,style='normal',color=[0,0,0],align)=>{
    doc.setFontSize(size);doc.setFont('helvetica',style);doc.setTextColor(...color);
    doc.text(String(text||''),x,y,align?{align}:undefined);
  };
  const L=(x1,y1,x2,y2,w=0.3)=>{doc.setLineWidth(w);doc.line(x1,y1,x2,y2);};
  const R=(x,y,w,h,lw=0.3)=>{doc.setLineWidth(lw);doc.rect(x,y,w,h);};

  let y=15;
  T('BESTÄTIGUNG',15,14,18,'bold',[30,64,175]);
  T('Pflegefreistellung gemäß § 16 Urlaubsgesetz',140,10,8,'normal',[120,120,120]);
  T(new Date().toLocaleDateString('de-AT'),140,16,9,'normal',[120,120,120]);
  doc.setDrawColor(30,64,175);L(10,20,200,20,0.6);
  y=28;

  R(10,y,90,22);
  T('Ausstellende Ärztin/Arzt:',13,y+6,8,'normal',[120,120,120]);
  T(arzt?arzt.fullName:'—',13,y+12,11,'bold');
  T((arzt&&arzt.fach||'—')+' · '+(practice&&practice.adresse||'—'),13,y+18,8);

  R(105,y,95,22);
  T('Zu pflegende Person:',108,y+6,8,'normal',[120,120,120]);
  T(account?account.fullName:patientName,108,y+12,11,'bold');
  T('SV-Nr: '+(account&&account.svnr||'—'),108,y+18,8);
  y+=30;

  T('Hiermit wird ärztlich bestätigt, dass die Pflege bzw. Betreuung der oben',10,y+6,10,'normal');
  T('genannten Person durch',10,y+12,10,'normal');
  T(antragsteller||'—',55,y+12,11,'bold');
  T('('+(verwandtschaft||'—')+')',10,y+19,9,'normal',[100,100,100]);
  y+=27;
  T('im folgenden Zeitraum medizinisch erforderlich war:',10,y,10,'normal');
  y+=8;

  doc.setFillColor(248,250,252);doc.rect(10,y,190,16,'F');R(10,y,190,16);
  T('Von',15,y+6,8,'normal',[120,120,120]); T(attestFmtDate(von),15,y+13,12,'bold');
  T('Bis',110,y+6,8,'normal',[120,120,120]); T(attestFmtDate(bis),110,y+13,12,'bold');
  y+=26;

  // Signature area
  y=Math.max(y,220);
  L(10,y,200,y);
  y+=8;
  if(arzt&&arzt.stempelDataUrl){try{doc.addImage(arzt.stempelDataUrl,'PNG',10,y,40,30);}catch(e){}}
  if(arzt&&arzt.sigDataUrl){try{doc.addImage(arzt.sigDataUrl,'PNG',60,y,55,26);}catch(e){}}
  // Centered under each image's own box (stamp: x 10-50, signature: x
  // 60-115) instead of left-aligned at the box's left edge, so the name/
  // date actually reads as sitting under the ink, not floating beside it.
  T('Stempel & Unterschrift',30,y+34,8,'normal',[150,150,150],'center');
  T(arzt?arzt.fullName:'—',87.5,y+34,9,'bold',[0,0,0],'center');
  T((ort||'—')+', '+new Date().toLocaleDateString('de-AT'),87.5,y+38,8,'normal',[120,120,120],'center');

  doc.setFillColor(248,250,252);doc.rect(0,282,210,15,'F');
  T('DSGVO-konform',10,290,7,'normal',[150,150,150]);
  T('Datum: '+new Date().toLocaleDateString('de-AT'),170,290,7,'normal',[150,150,150]);

  doc._attestPatientName=account?account.fullName:patientName;
  doc._attestFields={antragstellerName:antragsteller,verwandtschaftsverhaeltnis:verwandtschaft,von,bis,ort};
  return doc;
}

function clearPflegefreistellungForm(){
  document.getElementById('pf-antragsteller').value='';
  document.getElementById('pf-verwandtschaft').value='';
  document.getElementById('pf-von').value='';
  document.getElementById('pf-bis').value='';
  document.getElementById('pf-ort').value='';
}

async function _persistPflegefreistellung(doc,documentId){
  const patientId=await findPatientIdByFullName(doc._attestPatientName);
  if(!patientId) return;
  const session=_attestSession();
  try{ await createPatientPflegefreistellung(patientId,doc._attestFields,session?session.username:null,documentId||null); }
  catch(e){ console.error('Failed to persist structured Pflegefreistellung record',e); }
}
// "Per Chat senden" -- same document, delivered to the patient's own chat/
// account instead of paper (same pattern as sendRezeptToChat() in vendor/
// kartei-rezept-ueberweisung.js). doctor.html only -- see this file's own
// header comment for why.
async function sendPflegefreistellungToChat(patientNameOverride){
  if(typeof appendRealMessage!=='function'||typeof findPatientIdByFullName!=='function'||typeof uploadPatientDocument!=='function'){
    showToast('✗ Senden per Chat ist hier nicht verfügbar','error'); return;
  }
  const doc=await buildPflegefreistellungPdf(patientNameOverride);
  if(!doc) return;
  const name=doc._attestPatientName;
  try{
    const base64Data=doc.output('datauristring').split(',')[1];
    const filename=`Pflegefreistellung_${name.replace(/\s+/g,'_')}_${new Date().toLocaleDateString('de-AT').replace(/\./g,'-')}.pdf`;
    const patientId=await findPatientIdByFullName(name);
    let docId=null;
    if(patientId){
      const session=_attestSession();
      const sizeBytes=Math.round(base64Data.length*0.75);
      const saved=await uploadPatientDocument(patientId,{
        category:'sonstiges', title:'Bestätigung: Pflegefreistellung', filename, mimeType:'application/pdf', sizeBytes, base64Data,
      },session?session.username:null);
      docId=saved.id;
    }
    await _persistPflegefreistellung(doc,docId);
    // supabase/phase83_patient_message_translations.sql -- real user report
    // (2026-08-26): this "uw" (document) message header/sub were missed by
    // the original translation sweep entirely (it only ever looked at
    // plain 'text' messages) and kept arriving in German regardless of the
    // patient's language. msgKey/msgParams reuse the same 2 columns that
    // already exist -- patient.html's msgRowHtml() derives BOTH the header
    // and the sub-line from them via renderSystemMessage()/renderUwSub()
    // (vendor/i18n-patient.js), no new column needed.
    const msg={dir:'out', type:'uw', text:'Bestätigung: Pflegefreistellung ausgestellt',
      filename, sub:'Pflegefreistellung', docId, time:getTime()+' ✓',
      msgKey:'chat.uw.pflegefreistellung', msgParams:{}};
    appendRealMessage(name,msg);
    const chatNameEl=document.getElementById('chat-name');
    if(chatNameEl && chatNameEl.textContent===name){
      renderMessages(name,colorForName(name));
    }
    clearPflegefreistellungForm();
    showToast('✓ Bestätigung per Chat gesendet');
  }catch(e){
    console.error('Failed to send Pflegefreistellung via chat',e);
    showToast('✗ Senden über Chat fehlgeschlagen','error');
  }
}

// "Patient ist in der Ordination" -- prints now, on paper, for the
// Antragsteller to submit at their own employer. Same createPatientRezept()-
// style persistence-without-document_id as printRezept(), since nothing
// gets uploaded to patient_documents on this path.
async function printPflegefreistellung(patientNameOverride){
  const doc=await buildPflegefreistellungPdf(patientNameOverride);
  if(!doc) return;
  openPdfAndPrint(doc.output('bloburl'));
  await _persistPflegefreistellung(doc);
  clearPflegefreistellungForm();
}

async function downloadPflegefreistellungPdf(patientNameOverride){
  const doc=await buildPflegefreistellungPdf(patientNameOverride);
  if(!doc) return;
  doc.save(`Pflegefreistellung_${(doc._attestPatientName||'').replace(/\s+/g,'_')}.pdf`);
  await _persistPflegefreistellung(doc);
  clearPflegefreistellungForm();
}

// ══ ARBEITSUNFÄHIGKEIT ══
// patient_id here IS the currently open patient -- they're the one being
// certified unable to work, unlike Pflegefreistellung above.

async function buildArbeitsunfaehigkeitPdf(patientNameOverride){
  if(typeof window.jspdf==='undefined'){ alert('jsPDF lädt... Bitte nochmal versuchen.'); return null; }
  const patientName=_attestCurrentName(patientNameOverride);
  if(!patientName||patientName==='Kein Patient ausgewählt'){ showToast('Bitte zuerst einen Patienten auswählen.'); return null; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  const account = await findPatientAccountAsync(patientName);
  const arzt = resolveAttestArztInfo();

  const von=document.getElementById('au2-von').value||'';
  const bis=document.getElementById('au2-bis').value||'';
  const grund=document.getElementById('au2-grund').value||'Krankheit';
  const adresse=document.getElementById('au2-adresse').value||'';
  const bettruhe=document.getElementById('au2-bettruhe').checked;
  const ausgehVon=document.getElementById('au2-ausgehVon').value||'';
  const ausgehBis=document.getElementById('au2-ausgehBis').value||'';
  const versTraeger=document.getElementById('au2-versicherungstraeger').value||'';
  const versNummer=document.getElementById('au2-versicherungsnummer').value||'';

  // align (7th arg, optional) -- see buildPflegefreistellungPdf()'s own
  // comment on this same helper above.
  const T=(text,x,y,size=10,style='normal',color=[0,0,0],align)=>{
    doc.setFontSize(size);doc.setFont('helvetica',style);doc.setTextColor(...color);
    doc.text(String(text||''),x,y,align?{align}:undefined);
  };
  const L=(x1,y1,x2,y2,w=0.3)=>{doc.setLineWidth(w);doc.line(x1,y1,x2,y2);};
  const R=(x,y,w,h,lw=0.3)=>{doc.setLineWidth(lw);doc.rect(x,y,w,h);};

  let y=15;
  T('ARBEITSUNFÄHIGKEITSMELDUNG',15,14,15,'bold',[30,64,175]);
  T('Krankenstandsbestätigung',140,10,8,'normal',[120,120,120]);
  T(new Date().toLocaleDateString('de-AT'),140,16,9,'normal',[120,120,120]);
  doc.setDrawColor(30,64,175);L(10,20,200,20,0.6);
  y=28;

  R(10,y,90,22);
  T('Ausstellende Ärztin/Arzt:',13,y+6,8,'normal',[120,120,120]);
  T(arzt?arzt.fullName:'—',13,y+12,11,'bold');
  T(arzt&&arzt.fach||'—',13,y+18,8);

  R(105,y,95,22);
  T('Patient/in:',108,y+6,8,'normal',[120,120,120]);
  T(account?account.fullName:patientName,108,y+12,11,'bold');
  T('SV-Nr: '+(versNummer||(account&&account.svnr)||'—'),108,y+18,8);
  y+=30;

  T('Zeitraum der Arbeitsunfähigkeit:',10,y+6,10,'bold');
  y+=10;
  doc.setFillColor(248,250,252);doc.rect(10,y,190,16,'F');R(10,y,190,16);
  T('Von',15,y+6,8,'normal',[120,120,120]); T(attestFmtDate(von),15,y+13,12,'bold');
  T('Bis',110,y+6,8,'normal',[120,120,120]); T(attestFmtDate(bis),110,y+13,12,'bold');
  y+=24;

  R(10,y,190,16);
  T('Grund',15,y+6,8,'normal',[120,120,120]); T(grund,15,y+13,11,'bold');
  T('Bettruhe',110,y+6,8,'normal',[120,120,120]);
  T(bettruhe?'erforderlich':'nicht erforderlich',110,y+13,10,'bold',bettruhe?[220,38,38]:[22,163,74]);
  y+=22;

  if(ausgehVon||ausgehBis){
    R(10,y,190,14);
    T('Ausgehzeiten',15,y+6,8,'normal',[120,120,120]);
    T((ausgehVon||'—')+' – '+(ausgehBis||'—')+' Uhr',15,y+12,10,'bold');
    y+=20;
  }

  R(10,y,190,16);
  T('Krankenstandsadresse',15,y+6,8,'normal',[120,120,120]);
  T(adresse||'—',15,y+13,10);
  y+=22;

  R(10,y,190,14);
  T('Versicherungsträger',15,y+6,8,'normal',[120,120,120]);
  T(versTraeger||'—',15,y+12,10,'bold');
  y+=20;

  // Signature area
  y=Math.max(y,225);
  L(10,y,200,y);
  y+=8;
  if(arzt&&arzt.stempelDataUrl){try{doc.addImage(arzt.stempelDataUrl,'PNG',10,y,40,30);}catch(e){}}
  if(arzt&&arzt.sigDataUrl){try{doc.addImage(arzt.sigDataUrl,'PNG',60,y,55,26);}catch(e){}}
  // Centered under each image's own box -- see buildPflegefreistellungPdf()'s
  // own comment on this same fix above.
  T('Stempel & Unterschrift',30,y+34,8,'normal',[150,150,150],'center');
  T(arzt?arzt.fullName:'—',87.5,y+34,9,'bold',[0,0,0],'center');

  doc.setFillColor(248,250,252);doc.rect(0,282,210,15,'F');
  T('DSGVO-konform',10,290,7,'normal',[150,150,150]);
  T('Datum: '+new Date().toLocaleDateString('de-AT'),170,290,7,'normal',[150,150,150]);

  doc._attestPatientName=account?account.fullName:patientName;
  doc._attestFields={
    von,bis,grund,krankenstandsadresse:adresse,bettruhe,
    ausgehzeitVon:ausgehVon,ausgehzeitBis:ausgehBis,
    versicherungstraeger:versTraeger,versicherungsnummer:versNummer,
  };
  return doc;
}

function clearArbeitsunfaehigkeitForm(){
  document.getElementById('au2-von').value='';
  document.getElementById('au2-bis').value='';
  document.getElementById('au2-grund').value='Krankheit';
  document.getElementById('au2-adresse').value='';
  document.getElementById('au2-bettruhe').checked=false;
  document.getElementById('au2-ausgehVon').value='';
  document.getElementById('au2-ausgehBis').value='';
  document.getElementById('au2-versicherungstraeger').value='';
  document.getElementById('au2-versicherungsnummer').value='';
}

async function _persistArbeitsunfaehigkeit(doc,documentId){
  const patientId=await findPatientIdByFullName(doc._attestPatientName);
  if(!patientId) return;
  const session=_attestSession();
  try{ await createPatientArbeitsunfaehigkeit(patientId,doc._attestFields,session?session.username:null,documentId||null); }
  catch(e){ console.error('Failed to persist structured Arbeitsunfähigkeit record',e); }
}
// "Per Chat senden" -- see sendPflegefreistellungToChat()'s own comment
// right above for the full reasoning (doctor.html only).
async function sendArbeitsunfaehigkeitToChat(patientNameOverride){
  if(typeof appendRealMessage!=='function'||typeof findPatientIdByFullName!=='function'||typeof uploadPatientDocument!=='function'){
    showToast('✗ Senden per Chat ist hier nicht verfügbar','error'); return;
  }
  const doc=await buildArbeitsunfaehigkeitPdf(patientNameOverride);
  if(!doc) return;
  const name=doc._attestPatientName;
  try{
    const base64Data=doc.output('datauristring').split(',')[1];
    const filename=`Arbeitsunfaehigkeit_${name.replace(/\s+/g,'_')}_${new Date().toLocaleDateString('de-AT').replace(/\./g,'-')}.pdf`;
    const patientId=await findPatientIdByFullName(name);
    let docId=null;
    if(patientId){
      const session=_attestSession();
      const sizeBytes=Math.round(base64Data.length*0.75);
      const saved=await uploadPatientDocument(patientId,{
        category:'sonstiges', title:'Arbeitsunfähigkeitsmeldung', filename, mimeType:'application/pdf', sizeBytes, base64Data,
      },session?session.username:null);
      docId=saved.id;
    }
    await _persistArbeitsunfaehigkeit(doc,docId);
    // supabase/phase83_patient_message_translations.sql -- see the same
    // note on the Pflegefreistellung sender above.
    const msg={dir:'out', type:'uw', text:'Arbeitsunfähigkeitsmeldung ausgestellt',
      filename, sub:'Krankenstandsbestätigung', docId, time:getTime()+' ✓',
      msgKey:'chat.uw.attest', msgParams:{}};
    appendRealMessage(name,msg);
    const chatNameEl=document.getElementById('chat-name');
    if(chatNameEl && chatNameEl.textContent===name){
      renderMessages(name,colorForName(name));
    }
    clearArbeitsunfaehigkeitForm();
    showToast('✓ Meldung per Chat gesendet');
  }catch(e){
    console.error('Failed to send Arbeitsunfähigkeit via chat',e);
    showToast('✗ Senden über Chat fehlgeschlagen','error');
  }
}

async function printArbeitsunfaehigkeit(patientNameOverride){
  const doc=await buildArbeitsunfaehigkeitPdf(patientNameOverride);
  if(!doc) return;
  openPdfAndPrint(doc.output('bloburl'));
  await _persistArbeitsunfaehigkeit(doc);
  clearArbeitsunfaehigkeitForm();
}

async function downloadArbeitsunfaehigkeitPdf(patientNameOverride){
  const doc=await buildArbeitsunfaehigkeitPdf(patientNameOverride);
  if(!doc) return;
  doc.save(`Arbeitsunfaehigkeit_${(doc._attestPatientName||'').replace(/\s+/g,'_')}.pdf`);
  await _persistArbeitsunfaehigkeit(doc);
  clearArbeitsunfaehigkeitForm();
}

// doctor.html's switchKarteiTab() calls this when either tab is activated
// (see doctor.html) -- populates the patient-info display box and, for
// Arbeitsunfähigkeit, auto-fills patient-derived defaults the same way
// Rezept/Überweisung already do, but only into still-empty fields so it
// never clobbers something the doctor already typed this same activation.
// nameOverride: secretary.html has no #kartei-name/#kartei-meta (it opens
// this per-patient from the chat pane instead), so it passes the currently
// open chat's name explicitly and the meta line is left blank there.
async function openAttestTabForCurrentPatient(kind,nameOverride){
  const n=nameOverride||document.getElementById('kartei-name')?.textContent||'—';
  const m=nameOverride?'':(document.getElementById('kartei-meta')?.textContent||'');
  if(kind==='pflegefreistellung'){
    const el=document.getElementById('pf-patient-info');
    if(el) el.textContent=n+(m?' · '+m:'');
    return;
  }
  if(kind==='arbeitsunfaehigkeit'){
    const el=document.getElementById('au2-patient-info');
    if(el) el.textContent=n+(m?' · '+m:'');
    if(n && n!=='Kein Patient ausgewählt'){
      const account=await findPatientAccountAsync(n);
      const adresseEl=document.getElementById('au2-adresse');
      const versTraegerEl=document.getElementById('au2-versicherungstraeger');
      const versNummerEl=document.getElementById('au2-versicherungsnummer');
      if(adresseEl && !adresseEl.value) adresseEl.value=(account&&account.adresse)||'';
      if(versTraegerEl && !versTraegerEl.value) versTraegerEl.value=(account&&account.versicherung)||'';
      if(versNummerEl && !versNummerEl.value) versNummerEl.value=(account&&account.svnr)||'';
    }
  }
}
