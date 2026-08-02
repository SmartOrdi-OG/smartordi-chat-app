// Kartei Anamnese-tab glue (doctor-side only) -- extracted out of
// doctor.html's own inline <script> into its own file, same reasoning/
// pattern as the other vendor/kartei-*.js files: doctor.html had grown
// into one huge script mixing dozens of unrelated features together. No
// behavior change here -- every function below is moved verbatim;
// doctor.html loads this file before its own inline <script> so every
// global here is still available exactly as before to onclick="..."
// attributes and other code in doctor.html itself.
// collectAnamneseData/applyAnamneseData/SPECIALTY_ANAMNESE (the actual
// shared field definitions/data collection, also used by patient.html)
// stay in vendor/anamnese-shared.js -- this file is only the doctor-side
// Kartei UI glue around them. findPatientAccountByFullName stays in
// doctor.html since it's a shared lookup used well beyond Anamnese
// (Kartei-opening flow, chat, exports); showToast/upsertPatientIdentity
// come from doctor.html/vendor/patient-data.js respectively.

// Anamnese (background history, rarely touched after the first fill-in)
// collapses to a summary bar by default within the merged Anamnese/Neu
// tab, so logging today's visit (the actual day-to-day action here)
// doesn't require scrolling past the whole questionnaire every time.
function toggleAnamneseSection(forceOpen){
  const body=document.getElementById('anamnese-collapse-body');
  const arrow=document.getElementById('anamnese-toggle-arrow');
  if(!body)return;
  const open=forceOpen===true||body.style.display==='none';
  body.style.display=open?'block':'none';
  if(arrow)arrow.textContent=open?'▴':'▾';
}

// supabase/phase8_anamnese.sql -- Anamnese now lives on the real patients
// row (upsertPatientIdentity), not just this device's localStorage, so it's
// the same data the patient sees (and can no longer be wrongly re-prompted
// for) from any device.
// Real bug found: the success toast used to fire unconditionally at the end
// regardless of whether anything upstream actually ran -- no patient
// selected, or a patient with no real Supabase account yet, both silently
// skipped the save entirely and still claimed "✓ Anamnese gespeichert!".
async function saveAnamnese(){
  // Scoped to the questionnaire itself (see loadAnamneseForPatient's own
  // note) -- #ktab-anamnese now also nests the unrelated "Neu" visit-entry
  // form, whose fields must never end up saved as anamnese answers.
  const root=document.getElementById('anamnese-collapse-body');
  const data=collectAnamneseData(root);
  const currentName=document.getElementById('kartei-name')?.textContent;
  if(!currentName||currentName==='Kein Patient ausgewählt'){ showToast('Bitte zuerst einen Patienten auswählen.','error'); return; }
  const found=findPatientAccountByFullName(currentName);
  if(!found){ showToast('Dieser Patient hat noch kein Cloud-Konto — die Anamnese kann erst gespeichert werden, sobald ein echtes Patientenkonto besteht.','error'); return; }
  try{
    await upsertPatientIdentity(found.username,{anamnese:data});
  }catch(e){
    showToast('✗ Speichern fehlgeschlagen','error');
    return;
  }
  showToast('✓ Anamnese gespeichert!');
}

// Loads whichever patient is currently shown in Kartei: renders the
// specialty section for the doctor they were registered under (falling back
// to this device's own Fachrichtung setting), resets the form, then fills in
// their submitted answers if any exist.
function loadAnamneseForPatient(name){
  const found=findPatientAccountByFullName(name);
  const account=found?found.accounts[found.username]:null;
  const fach=account?.fach||localStorage.getItem('fachrichtung')||'Allgemeinmedizin';
  updateAnamneseByFach(fach);
  // Scoped to the questionnaire itself, not the whole (now merged) Anamnese
  // tab -- that container also nests the unrelated "Neu" visit-entry form,
  // whose fields (date/type/complaint/...) must survive a patient switch
  // untouched instead of being blanked out as a side effect of this reset.
  const root=document.getElementById('anamnese-collapse-body');
  root.querySelectorAll('input,select,textarea').forEach(el=>{
    if(el.type==='checkbox') el.checked=false; else el.value='';
  });
  if(account && account.anamnese) applyAnamneseData(root,account.anamnese);
}

function updateAnamneseByFach(fach){
  const label=document.getElementById('anamnese-fach-label');
  const section=document.getElementById('anamnese-specialty-section');
  if(!section)return;
  const spec=SPECIALTY_ANAMNESE[fach];
  if(spec){
    if(label)label.textContent=spec.label;
    section.innerHTML=spec.html;
  } else {
    if(label)label.textContent='Allgemeinanamnese';
    section.innerHTML='';
  }
}

// Reads whichever answers are actually filled in on the (already-populated,
// see loadAnamneseForPatient()) Anamnese form as plain "Label: value" lines,
// for the report PDF -- reuses the rendered DOM as the data source (same
// idea printImpfpass() already relies on) instead of re-deriving each
// field's human label from its data-key storage key.
function collectAnamneseSummaryLines(root){
  const lines=[];
  root.querySelectorAll('input,select,textarea').forEach(el=>{
    if(el.type==='checkbox'){
      if(!el.checked) return;
      const label=el.closest('label');
      const span=label?label.querySelector('span'):null;
      const text=(span?span.textContent:(label?.textContent||'')).trim();
      if(text) lines.push(text);
      return;
    }
    const val=(el.value||'').trim();
    if(!val) return;
    const container=el.closest('div');
    const labelEl=container?container.querySelector('.k-form-label'):null;
    const labelText=labelEl?labelEl.textContent.trim():(el.placeholder||'').trim();
    lines.push(labelText?labelText+': '+val:val);
  });
  return lines;
}
