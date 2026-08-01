// Kartei "Impfung" (vaccination) tab -- extracted out of doctor.html's own
// inline <script> into its own file, same reasoning/pattern as
// vendor/kartei-visits.js/kartei-mkp.js/kartei-documents.js/kartei-labor.js/
// kartei-signature.js: doctor.html had grown into one huge script mixing
// dozens of unrelated features together. No behavior change here -- every
// function below is moved verbatim; doctor.html loads this file before its
// own inline <script> so every global here is still available exactly as
// before to onclick="..." attributes and other code in doctor.html itself.
// openPdfAndPrint() stays in doctor.html -- it's a shared utility also used
// by other PDF-printing flows (Rezept), not specific to this tab.
// VACCINE_SCHEDULE/dueVaccinationsForPatient/setVaccinePrice/loadImpfPreise
// stay in doctor.html (shared with the Dashboard's own due-vaccinations
// widget, and duplicated in secretary.html by longstanding convention in
// this codebase); findPatientRecordAsync/loadImpfungenFor/impfRowToJs/
// addImpfungEntry come from vendor/patient-data.js; currentStaffSession/
// showToast stay in doctor.html.

function toggleSonstigeImpf(sel){
  const custom=document.getElementById('impf-name-custom');
  custom.style.display=sel.value==='Sonstige'?'block':'none';
  if(sel.value==='Sonstige')custom.focus();
}

// ══ IMPFUNG FUNCTIONS ══
function renderImpfEintrag(imp){
  const df=imp.datum?new Date(imp.datum).toLocaleDateString('de-AT'):'—';
  const nextStr=imp.nextDue?new Date(imp.nextDue).toLocaleDateString('de-AT'):'—';
  const isExpired=imp.nextDue&&new Date(imp.nextDue)<new Date();
  const badge=imp.nextDue
    ?(isExpired
      ?'<span style="background:#fee2e2;color:#dc2626;font-size:10px;font-weight:700;padding:3px 8px;border-radius:8px;">Fällig</span>'
      :'<span style="background:#dcfce7;color:#16a34a;font-size:10px;font-weight:700;padding:3px 8px;border-radius:8px;">✓ Aktuell</span>')
    :'';
  return `<div class="impf-eintrag" style="background:white;border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:8px;display:flex;align-items:center;gap:12px;">
    <div style="width:40px;height:40px;background:#dcfce7;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;"></div>
    <div style="flex:1;">
      <div style="font-size:13px;font-weight:700;color:#0f172a;">${imp.vaccineName}${imp.doseLabel?' — '+imp.doseLabel:''}</div>
      <div style="font-size:11px;color:#64748b;">${df}${imp.charge?' · Charge: '+imp.charge:''}${imp.nextDue?' · Nächste: '+nextStr:''}</div>
    </div>
    ${badge}
  </div>`;
}
// Renders the currently-loaded patient's own vaccination history (from
// Supabase's patient_impfungen, keyed by that patient's real id) instead of
// leaving whichever patient's entries happened to be in the DOM last --
// vaccination records are exactly the kind of data that must never bleed
// between patients.
async function populateKarteiImpfung(name){
  const list=document.getElementById('impfpass-liste');
  if(!list) return;
  const rec=await findPatientRecordAsync(name);
  await impfungenReady;
  const impfungen=rec?.id ? loadImpfungenFor(rec.id).map(impfRowToJs) : [];
  list.innerHTML=impfungen.length
    ? impfungen.map(renderImpfEintrag).join('')
    : '<div style="text-align:center;padding:20px;color:#94a3b8;font-size:12px;">Keine Impfungen erfasst</div>';
  const warnBox=document.getElementById('impfpass-warnung');
  if(warnBox){
    const due=dueVaccinationsForPatient(name,rec?.dob,impfungen);
    warnBox.style.display=due.length?'block':'none';
    const preise=loadImpfPreise();
    warnBox.innerHTML=due.length ? `<div style="background:#fef2f2;border-left:4px solid #dc2626;border-radius:12px;padding:12px 14px;margin-bottom:14px;">
      <div style="font-size:12px;font-weight:800;color:#991b1b;margin-bottom:6px;">⚠ Fällige Impfungen</div>
      ${due.map(d=>`<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:#7f1d1d;margin-bottom:4px;">
        <span>${d.vaccine} — ${d.detail}</span>
        <input type="text" value="${preise[d.vaccine]||''}" placeholder="Preis" onchange="setVaccinePrice('${d.vaccine}',this.value)" style="width:80px;padding:4px 6px;border:1.5px solid #fecaca;border-radius:6px;font-family:inherit;font-size:11px;outline:none;text-align:right;flex-shrink:0;background:white;">
      </div>`).join('')}
    </div>` : '';
  }
}
async function addImpfung(){
  let name=document.getElementById('impf-name').value;
  if(name==='Sonstige'){
    name=document.getElementById('impf-name-custom').value.trim();
    if(!name){alert('Bitte Impfstoffname eingeben.');return;}
  }
  const datum=document.getElementById('impf-datum').value;
  const dosis=document.getElementById('impf-dosis').value;
  const next=document.getElementById('impf-next').value;
  const charge=document.getElementById('impf-charge').value;
  if(!datum){alert('Bitte Datum eingeben.');return;}
  const currentName=document.getElementById('kartei-name')?.textContent;
  if(!currentName||currentName==='Kein Patient ausgewählt'){alert('Bitte zuerst einen Patienten auswählen.');return;}
  const rec=await findPatientRecordAsync(currentName);
  if(!rec?.id){alert('Dieser Patient hat noch kein Cloud-Konto -- Impfungen können nur für Patienten mit Konto gespeichert werden.');return;}
  const vaccine=VACCINE_SCHEDULE.find(v=>v.name===name);
  const session=currentStaffSession();
  try{
    await addImpfungEntry(rec.id,{vaccineKey:vaccine?vaccine.key:null,vaccineName:name,doseLabel:dosis,datum,nextDue:next,charge},session?session.username:null);
  }catch(e){ showToast('✗ Speichern fehlgeschlagen','error'); return; }
  populateKarteiImpfung(currentName);
  document.getElementById('impf-charge').value='';
  document.getElementById('impf-next').value='';
  showToast('✓ Impfung eingetragen!');
}

function printImpfpass(){
  if(typeof window.jspdf==='undefined'){alert('jsPDF lädt...');return;}
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  // Plain white header (bold colored title + a thin rule) instead of a
  // full-width solid-fill banner -- printed on a real printer, that dark
  // block burns through ink/toner for zero extra information over a title.
  doc.setFontSize(16);doc.setFont('helvetica','bold');doc.setTextColor(22,163,74);
  doc.text('Impfpass',15,14);
  doc.setDrawColor(22,163,74);doc.setLineWidth(0.6);doc.line(10,19,200,19);
  doc.setFontSize(10);doc.setFont('helvetica','normal');doc.setTextColor(0,0,0);
  const n=document.getElementById('kartei-name')?.textContent||'—';
  doc.text('Patient: '+n,15,27);doc.text('Datum: '+new Date().toLocaleDateString('de-AT'),150,27);
  let y=37;
  const entries=document.querySelectorAll('.impf-eintrag');
  entries.forEach(e=>{
    const lines=e.innerText.split('\n').filter(l=>l.trim());
    doc.setFontSize(11);doc.setFont('helvetica','bold');doc.setTextColor(0,0,0);
    doc.text(lines[0]||'',15,y);
    doc.setFontSize(9);doc.setFont('helvetica','normal');doc.setTextColor(100,100,100);
    doc.text(lines[1]||'',15,y+5);
    doc.setLineWidth(0.3);doc.line(10,y+8,200,y+8);
    y+=14;if(y>270){doc.addPage();y=20;}
  });
  doc.setFontSize(8);doc.setTextColor(150,150,150);
  doc.text('DSGVO-konform',10,285);
  const url=doc.output('bloburl');
  openPdfAndPrint(url);
}
