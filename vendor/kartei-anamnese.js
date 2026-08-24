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
    showToast('Speichern fehlgeschlagen: '+saveErrorMessage(e),'error');
    return;
  }
  showToast('Anamnese gespeichert!');
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
    if(el.type==='checkbox') el.checked=false;
    // A <select> whose options are all non-empty (every Gesundheitsfragebogen Ja/Nein
    // toggle, plus an.kind.geburtsart, an.gyn.menopause, an.card.schrittmacher, etc.) has
    // no option with value="" -- setting .value='' on those leaves selectedIndex at -1
    // (nothing shown as selected) instead of resetting to the field's actual default.
    // selectedIndex=0 always lands back on the first, intended-default <option>.
    else if(el.tagName==='SELECT') el.selectedIndex=0;
    else el.value='';
  });
  if(account && account.anamnese) applyAnamneseData(root,account.anamnese);
  // applyAnamneseData only sets .value on the Gesundheitsfragebogen selects (Allgemeinmedizin/
  // Kinderheilkunde) -- it never touches the sibling "Wenn ja, ..." field's display:none, so a
  // returning patient's saved "Ja" answer would otherwise load with its detail text hidden.
  anGfbSyncAll(root);
  updateAnamneseHighlightsLine(root,!!(account&&account.anamnese));
}

// Shows a one-line "⚠ N Auffälligkeiten: ..." summary on the collapsed
// Anamnese bar itself, built from collectGfbAuffaelligkeiten() (vendor/
// anamnese-shared.js) -- so a doctor sees what's actually flagged in the
// Gesundheitsfragebogen without even opening the tab. Real complaint this
// addresses: tomedo's own patient-questionnaire users report exactly this
// difficulty (can't easily see just the "yes" answers) on their user forum
// -- see TODO.md. Says nothing (not "keine Auffälligkeiten") when the
// patient never actually submitted an Anamnese, or when this specialty
// doesn't include the Gesundheitsfragebogen at all (see SPECIALTY_ANAMNESE)
// -- a blank/no-data patient must never be silently read as "clean".
function updateAnamneseHighlightsLine(root,hasSubmittedAnamnese){
  const el=document.getElementById('anamnese-highlights-line');
  if(!el) return;
  const hasGfb=!!root.querySelector('.gfb-q');
  if(!hasSubmittedAnamnese||!hasGfb){ el.style.display='none'; el.textContent=''; el.title=''; return; }
  const flags=collectGfbAuffaelligkeiten(root);
  el.textContent=flags.length
    ? '⚠ '+flags.length+' Auffällig'+(flags.length===1?'keit':'keiten')+': '+flags.join(', ')
    : 'Keine Auffälligkeiten im Gesundheitsfragebogen';
  el.title=el.textContent;
  el.style.display='';
}

// Doctor-only "Nur Ja-Antworten anzeigen" filter (checkbox inserted by
// updateAnamneseByFach() below, not part of the shared patient-facing
// template): hides every Gesundheitsfragebogen row currently answered
// "Nein" so a fully-filled-out questionnaire can be scanned for just what
// needs attention, instead of reading past 20+ "Nein" rows every time.
function applyGfbOnlyJaFilter(container){
  const toggle=container.querySelector('#gfbOnlyJaToggle');
  const onlyJa=!!(toggle&&toggle.checked);
  container.querySelectorAll('.gfb-q').forEach(q=>{
    if(!onlyJa){ q.style.display=''; return; }
    const select=q.querySelector('select');
    q.style.display=(select&&select.value==='Ja')?'':'none';
  });
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
  // "Nur Ja-Antworten anzeigen" filter toggle -- inserted here (doctor-side
  // glue), not baked into ANAMNESE_GESUNDHEITSFRAGEBOGEN_HTML itself, since
  // that template is shared verbatim with patient.html's own fill-in form,
  // where a "show only Ja" filter makes no sense.
  const gfbTitleEl=section.querySelector('[data-i18n="an.gfb.section.title"]');
  if(gfbTitleEl){
    const container=gfbTitleEl.parentElement;
    const toggleRow=document.createElement('label');
    toggleRow.style.cssText='display:flex;align-items:center;gap:6px;font-size:11.5px;color:#64748b;cursor:pointer;margin:8px 0;';
    toggleRow.innerHTML='<input type="checkbox" id="gfbOnlyJaToggle"> Nur Ja-Antworten anzeigen';
    gfbTitleEl.insertAdjacentElement('afterend',toggleRow);
    const refilter=()=>applyGfbOnlyJaFilter(container);
    toggleRow.querySelector('input').addEventListener('change',refilter);
    container.addEventListener('change',(e)=>{ if(e.target.matches('.gfb-q select')) refilter(); });
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
