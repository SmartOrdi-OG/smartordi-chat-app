// Kartei "Rezept" (Kassenrezept) and "Ueberweisung" (referral) tabs --
// extracted out of doctor.html's own inline <script> into their own file,
// same de-monolithization pattern as vendor/kartei-visits.js,
// vendor/kartei-mkp.js, vendor/kartei-documents.js, vendor/kartei-labor.js,
// vendor/kartei-signature.js, vendor/kartei-impfung.js and
// vendor/kartei-anamnese.js before it.
//
// Both tabs' logic lived interleaved with unrelated Kartei-wide code
// (switchKarteiTab(), the patient-search panel, etc.) rather than as one
// contiguous block, so this file is assembled from two separate ranges of
// the original doctor.html:
//   - the Ueberweisung form/preview cluster (openUwPreview, closeUwModal,
//     uwVal/uwRadio/uwFmtDate, getUwData, buildUwA4, clearUeberweisungForm,
//     handleUwSend)
//   - the Rezept + Ueberweisung PDF-building cluster (buildRezeptPdf,
//     clearRezeptForm, printRezept, sendRezeptToChat, buildUeberweisungPdf,
//     downloadUwPDF)
//
// Left in doctor.html on purpose, as shared utilities used well beyond
// these two tabs: escapeHtml (vendor/staff-accounts.js), findPatientRecord/
// findPatientRecordAsync/findPatientIdByFullName/uploadPatientDocument/
// createPatientRezept/createPatientUeberweisung (vendor/patient-data.js),
// renderMedikamentOptions, showToast, currentStaffSession, getTime,
// colorForName, appendRealMessage, renderMessages, openPdfAndPrint.
// sigDataUrl/stempelDataUrl (read here, not written) live in
// vendor/kartei-signature.js -- same top-level-`let`-is-visible-to-every-
// later-loaded-<script> reasoning as every prior extraction that reads
// them. switchKarteiTab()'s own Rezept/Ueberweisung-tab-population
// branches stay in doctor.html since that function handles every Kartei
// tab, not just these two.

function openUwPreview(){
  buildUwA4();
  handleUwSend();
  document.getElementById('uwModal').style.display='flex';
}

function closeUwModal(){
  document.getElementById('uwModal').style.display='none';
}

function uwVal(id){ return (document.getElementById(id)?.value||'').trim(); }
function uwRadio(name){ return document.querySelector(`input[name="${name}"]:checked`)?.value||'Nein'; }
function uwFmtDate(str){ if(!str)return''; const d=new Date(str); return d.toLocaleDateString('de-AT',{day:'2-digit',month:'2-digit',year:'numeric'}); }

function getUwData(){
  return {
    pName:   document.getElementById('uw-patient-name')?.textContent||'',
    pMeta:   document.getElementById('uw-patient-meta')?.textContent||'',
    pAdresse:document.getElementById('uw-patient-adresse')?.textContent||'',
    pNachname:(document.getElementById('uw-patient-name')?.textContent||'').split(' ')[0]||'',
    pVorname: (document.getElementById('uw-patient-name')?.textContent||'').split(' ').slice(1).join(' ')||'',
    pSVNR:   (document.getElementById('uw-patient-meta')?.textContent||'').match(/SV[\s]*([\d\s]+)/)?.[1]?.trim()||'',
    kt:      uwVal('uwKT')||'ÖGK',
    status:  uwVal('uwStatus')||'1',
    von:     uwVal('uwVon')||'—',
    an:      uwVal('uwAn')||'–',
    // Anschrift/Telefon of the RECEIVING doctor/Krankenhaus -- not the
    // patient's own (that's pAdresse above).
    anAdresse:uwVal('uwAnAdresse'),
    anTel:   uwVal('uwAnTel'),
    fach:    uwVal('uwFach')||'Kardiologie',
    dring:   uwVal('uwDring')||'Normal',
    diag:    uwVal('uwDiag')||'–',
    wegen:   uwVal('uwWegen')||'–',
    notes:   uwVal('uwNotes')||'–',
    au:      uwRadio('uwAU'),
    rez:     uwRadio('uwRez'),
    datum:   uwFmtDate(uwVal('uwDatum'))||new Date().toLocaleDateString('de-AT'),
    email:   uwVal('uwEmail'),
    sendChat: document.getElementById('uwSendChat')?.checked,
    sendEmail:document.getElementById('uwSendEmail')?.checked,
  };
}

function buildUwA4(){
  const d = getUwData();
  const kts = ['ÖGK','BVAEB','SVS','KFL','Andere'];
  const statuses = [['1','Erwerbstätig'],['5','Pensionist/in'],['7','Arbeitslos'],['9','Kriegshinterbliebene']];
  const dringColor = d.dring==='Notfall'?'#dc2626':d.dring==='Dringend'?'#d97706':'#0f172a';

  const ktBoxes = kts.map(kt=>`
    <div style="flex:1;border-right:1px solid #000;padding:3px 4px;text-align:center;${d.kt===kt?'background:#000;color:white;':''}">
      <div style="font-size:7px;${d.kt===kt?'color:rgba(255,255,255,0.8);':'color:#555;'}">${kt}</div>
    </div>`).join('');

  const stBoxes = statuses.map(([n,l])=>`
    <div style="flex:${n==='9'?2:1};border-right:1px solid #000;padding:3px 4px;text-align:center;${d.status===n?'background:#000;color:white;':''}">
      <div style="font-size:11px;font-weight:900;${d.status===n?'color:white;':''}">${n}</div>
      <div style="font-size:6px;${d.status===n?'color:rgba(255,255,255,0.7);':'color:#777;'}">${l}</div>
    </div>`).join('');

  const chk=(v,check)=>`<span style="display:inline-block;width:11px;height:11px;border:1.5px solid #000;text-align:center;line-height:10px;font-size:9px;font-weight:900;">${v===check?'✓':''}</span>`;

  // Anschrift/Telefon of the RECEIVING doctor/Krankenhaus -- only shown
  // when at least one was actually filled in, so an unused Überweisung
  // (no external contact details on hand yet) doesn't print an empty box.
  const anKontaktRow = (d.anAdresse||d.anTel) ? `
      <tr>
        <td style="border:1px solid #000;padding:4px 6px;">
          <div style="font-size:7px;color:#777;font-weight:700;text-transform:uppercase;">Anschrift (Arzt/Krankenhaus)</div>
          <div style="font-size:9px;">${escapeHtml(d.anAdresse||'–')}</div>
        </td>
        <td style="border:1px solid #000;padding:4px 6px;">
          <div style="font-size:7px;color:#777;font-weight:700;text-transform:uppercase;">Telefon (Arzt/Krankenhaus)</div>
          <div style="font-size:9px;">${escapeHtml(d.anTel||'–')}</div>
        </td>
      </tr>` : '';

  document.getElementById('uwA4').innerHTML = `
    <!-- Title -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;">
      <div>
        <div style="font-size:24px;font-weight:900;font-style:italic;letter-spacing:-0.5px;">Überweisung</div>
        <div style="font-size:7.5px;color:#555;margin-top:2px;max-width:260px;">Gilt nicht als Vorbewilligung für eine spätere stationäre Krankenhausaufnahme.</div>
      </div>
      <div style="text-align:right;">
        <div style="border:2px solid #000;padding:3px 10px;font-size:11px;font-weight:700;text-align:center;">${d.kt}</div>
        <div style="font-size:7px;color:#777;margin-top:2px;">Bitte den Namen des<br>Kostenträgers einsetzen!</div>
      </div>
    </div>

    <!-- KT Boxes -->
    <div style="display:flex;border:1px solid #000;margin-bottom:4px;">${ktBoxes}</div>

    <!-- Status Boxes -->
    <div style="display:flex;border:1px solid #000;margin-bottom:8px;">
      ${stBoxes}
      <div style="flex:3;padding:4px 8px;border-left:1px solid #000;">
        <div style="font-size:7px;color:#777;">Bitte zutreffendes Feld bezeichnen!</div>
        <div style="font-size:7px;color:#777;margin-top:1px;">Andere Kostenträger</div>
      </div>
    </div>

    <!-- Patient Grid -->
    <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">
      <tr>
        <td colspan="2" style="border:1px solid #000;padding:4px 6px;">
          <div style="font-size:7px;color:#777;font-weight:700;text-transform:uppercase;">Familienname / Vorname</div>
          <div style="font-size:13px;font-weight:700;">${escapeHtml(d.pName)}</div>
        </td>
      </tr>
      <tr>
        <td style="border:1px solid #000;padding:4px 6px;width:50%;">
          <div style="font-size:7px;color:#777;font-weight:700;text-transform:uppercase;">Anschrift</div>
          <div style="font-size:11px;">${escapeHtml(d.pAdresse||'–')}</div>
        </td>
        <td style="border:1px solid #000;padding:4px 6px;">
          <div style="font-size:7px;color:#777;font-weight:700;text-transform:uppercase;">Versicherungsnummer</div>
          <div style="font-size:12px;font-family:monospace;font-weight:700;">${escapeHtml(d.pSVNR||'–')}</div>
        </td>
      </tr>
      <tr>
        <td style="border:1px solid #000;padding:4px 6px;">
          <div style="font-size:7px;color:#777;font-weight:700;text-transform:uppercase;">Beschäftigt bei (Dienstgeber/in, Dienstort)</div>
          <div style="font-size:10px;min-height:14px;"></div>
        </td>
        <td style="border:1px solid #000;padding:4px 6px;">
          <div style="font-size:7px;color:#777;font-weight:700;text-transform:uppercase;">Versicherte/r (wenn Angehörige/r)</div>
          <div style="font-size:10px;min-height:14px;"></div>
        </td>
      </tr>
    </table>

    <!-- Überweisung Section -->
    <div style="background:#000;color:white;padding:3px 6px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Überweisung</div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:6px;">
      <tr>
        <td style="border:1px solid #000;padding:4px 6px;width:50%;">
          <div style="font-size:7px;color:#777;font-weight:700;text-transform:uppercase;">Von (überweisender Arzt)</div>
          <div style="font-size:10px;font-weight:600;">${escapeHtml(d.von)}</div>
        </td>
        <td style="border:1px solid #000;padding:4px 6px;">
          <div style="font-size:7px;color:#777;font-weight:700;text-transform:uppercase;">Überweisung an</div>
          <div style="font-size:10px;font-weight:600;">${escapeHtml(d.an)}</div>
        </td>
      </tr>${anKontaktRow}
      <tr>
        <td style="border:1px solid #000;padding:4px 6px;">
          <div style="font-size:7px;color:#777;font-weight:700;text-transform:uppercase;">Fachrichtung</div>
          <div style="font-size:11px;font-weight:700;">${escapeHtml(d.fach)}</div>
        </td>
        <td style="border:1px solid #000;padding:4px 6px;">
          <div style="font-size:7px;color:#777;font-weight:700;text-transform:uppercase;">Dringlichkeit</div>
          <div style="font-size:11px;font-weight:700;color:${dringColor};">${escapeHtml(d.dring)}</div>
        </td>
      </tr>
    </table>

    <!-- Diagnose Section -->
    <div style="background:#000;color:white;padding:3px 6px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Diagnose & Befund</div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:6px;">
      <tr>
        <td style="border:1px solid #000;padding:4px 6px;">
          <div style="font-size:7px;color:#777;font-weight:700;text-transform:uppercase;">Diagnose</div>
          <div style="font-size:11px;font-weight:700;">${escapeHtml(d.diag)}</div>
        </td>
      </tr>
      <tr>
        <td style="border:1px solid #000;padding:4px 6px;">
          <div style="font-size:7px;color:#777;font-weight:700;text-transform:uppercase;">wegen</div>
          <div style="font-size:10px;">${escapeHtml(d.wegen)}</div>
        </td>
      </tr>
      <tr>
        <td style="border:1px solid #000;padding:4px 6px;min-height:30px;">
          <div style="font-size:7px;color:#777;font-weight:700;text-transform:uppercase;">Klinische Informationen</div>
          <div style="font-size:10px;line-height:1.5;min-height:20px;">${escapeHtml(d.notes)}</div>
        </td>
      </tr>
    </table>

    <!-- Bottom Row -->
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="border:1px solid #000;padding:6px 8px;width:50%;vertical-align:top;">
          <div style="font-size:7.5px;color:#555;margin-bottom:5px;">*) Bitte Zutreffendes ankreuzen</div>
          <div style="font-size:10px;font-weight:700;margin-bottom:4px;">
            Arbeitsunfähig:&nbsp;
            ${chk(d.au,'Ja')} Ja &nbsp;&nbsp;
            ${chk(d.au,'Nein')} Nein
          </div>
          <div style="font-size:10px;font-weight:700;margin-bottom:6px;">
            Rezeptgebührenbefreit:&nbsp;
            ${chk(d.rez,'Ja')} Ja &nbsp;&nbsp;
            ${chk(d.rez,'Nein')} Nein
          </div>
          <div style="font-size:7.5px;color:#555;line-height:1.4;">Nachstehendes Feld ist von dem Facharzt/Arzt für Allgemeinmedizin auszufüllen, welcher/welche die Behandlung übernommen hat bzw. die Befundung durchführt.</div>
          <div style="font-size:8px;color:#777;margin-top:8px;">Behandlungsbeginn am: ___________</div>
        </td>
        <td style="border:1px solid #000;padding:6px 8px;vertical-align:top;">
          <div style="font-size:7.5px;color:#555;margin-bottom:4px;">Die vertraglich vorgesehenen Kosten werden übernommen</div>
          <div style="font-size:8.5px;color:#777;margin-bottom:2px;">Tag &nbsp;&nbsp;&nbsp; Monat &nbsp;&nbsp;&nbsp; Jahr</div>
          <div style="font-size:11px;font-weight:700;margin-bottom:8px;">${d.datum}</div>
          <div style="border:1px dashed #aaa;height:50px;display:flex;align-items:center;justify-content:center;gap:6px;border-radius:3px;overflow:hidden;padding:4px;">
            ${stempelDataUrl ? `<img src="${stempelDataUrl}" alt="Stempel" style="max-height:40px;max-width:44px;object-fit:contain;">` : '<span style="font-size:7px;color:#aaa;">Stempel</span>'}
            <div style="width:1px;height:30px;background:#ddd;"></div>
            ${sigDataUrl ? `<img src="${sigDataUrl}" alt="Unterschrift" style="max-height:40px;max-width:64px;object-fit:contain;">` : '<span style="font-size:7px;color:#aaa;">Unterschrift</span>'}
          </div>
        </td>
      </tr>
    </table>

    <!-- Footer -->
    <div style="margin-top:6px;border-top:1px solid #ccc;padding-top:5px;font-size:7.5px;color:#777;text-align:center;">
      Stempel und Unterschrift des Arztes/der Ärztin &nbsp;|&nbsp; DSGVO-konform &nbsp;|&nbsp; ${d.datum}
    </div>
  `;
}

function clearUeberweisungForm(){
  document.getElementById('uwAn').value='';
  document.getElementById('uwAnAdresse').value='';
  document.getElementById('uwAnTel').value='';
  document.getElementById('uwDiag').value='';
  document.getElementById('uwWegen').value='';
  document.getElementById('uwNotes').value='';
  document.getElementById('uwEmail').value='';
  document.getElementById('uwDatum').value='';
  const auNein=document.querySelector('input[name="uwAU"][value="Nein"]');
  if(auNein) auNein.checked=true;
  const rezNein=document.querySelector('input[name="uwRez"][value="Nein"]');
  if(rezNein) rezNein.checked=true;
}

// "Per Chat senden" used to be a pure DOM-only animation (fake chat bubble
// appended via setTimeout, never actually saved anywhere) -- see
// supabase/phase9_chat_documents.sql. It now really: builds the same PDF
// downloadUwPDF() would produce, uploads it as a real patient_documents row
// (so it shows up in the Dokumente tab and is genuinely downloadable, not
// just a filename label), and persists a real chat message referencing it,
// so the patient, the secretary, and any other doctor who opens this same
// chat all see the exact same thing -- not just whoever clicked send.
async function handleUwSend(){
  const d = getUwData();
  let html = '<div style="display:flex;flex-direction:column;gap:8px;padding:16px 20px 0;">';

  if(d.sendChat){
    html+=`<div style="display:flex;align-items:center;gap:8px;background:#f0fdfa;border:1px solid #99f6e4;border-radius:8px;padding:9px 12px;font-size:12px;font-weight:600;color:#0f766e;">✓  Per Chat an <strong>${escapeHtml(d.pName)}</strong>gesendet</div>`;
  }
  if(d.sendEmail && d.email){
    html+=`<div style="display:flex;align-items:center;gap:8px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:9px 12px;font-size:12px;font-weight:600;color:#0369a1;">✓  E-Mail an <strong>${escapeHtml(d.email)}</strong>gesendet</div>`;
  } else if(d.sendEmail && !d.email){
    html+=`<div style="display:flex;align-items:center;gap:8px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:9px 12px;font-size:12px;font-weight:600;color:#c2410c;">Keine E-Mail-Adresse angegeben</div>`;
  }
  html+='</div>';
  document.getElementById('uwSendStatus').innerHTML=html;

  if(!d.sendChat) return;

  try{
    const pdfDoc=buildUeberweisungPdf();
    const base64Data=pdfDoc.output('datauristring').split(',')[1];
    const filename=`Überweisung_${d.pNachname}_${d.datum.replace(/\./g,'-')}.pdf`;
    let docId=null;
    const patientId=await findPatientIdByFullName(d.pName);
    if(patientId){
      const session=currentStaffSession();
      const sizeBytes=Math.round(base64Data.length*0.75);
      const saved=await uploadPatientDocument(patientId,{
        category:'ueberweisung', title:'Überweisung an '+d.an, filename, mimeType:'application/pdf', sizeBytes, base64Data,
      },session?session.username:null);
      docId=saved.id;
      // Structured storage (supabase/phase38_rezepte_ueberweisungen.sql) --
      // alongside the PDF upload above, not instead of it.
      try{
        await createPatientUeberweisung(patientId,{
          kt:d.kt, status:d.status, von:d.von, an:d.an, anAdresse:d.anAdresse, anTel:d.anTel, fach:d.fach, dring:d.dring,
          diag:d.diag, wegen:d.wegen, notes:d.notes, au:d.au==='Ja', rez:d.rez==='Ja',
          datumIso:uwVal('uwDatum'),
        },session?session.username:null,docId);
      }catch(e){ console.error('Failed to persist structured Überweisung record',e); }
    }
    // supabase/phase83_patient_message_translations.sql -- real user report
    // (2026-08-26): this "uw" (document) message header/sub were missed by
    // the original translation sweep entirely (it only ever looked at
    // plain 'text' messages) and kept arriving in German regardless of the
    // patient's language. an/fach/dring are raw values (recipient name,
    // specialty, urgency) -- same "pass through untranslated" treatment as
    // `art`/doctor names elsewhere in this feature, never translated
    // further themselves.
    const msg={dir:'out', type:'uw', text:`Überweisung → ${d.an} (${d.fach}) · ${d.dring}`,
      filename, sub:`${d.fach} · ${d.dring}`, docId, time:getTime()+' ✓',
      msgKey:'chat.uw.ueberweisung', msgParams:{an:d.an, fach:d.fach, dring:d.dring}};
    appendRealMessage(d.pName,msg);
    // If this patient's chat happens to be the one currently open, redraw it
    // so the real persisted message replaces whatever's on screen right now.
    const chatNameEl=document.getElementById('chat-name');
    if(chatNameEl && chatNameEl.textContent===d.pName){
      renderMessages(d.pName,colorForName(d.pName));
    }
    clearUeberweisungForm();
  }catch(e){
    console.error('Failed to send Überweisung via chat',e);
    showToast('✗ Senden über Chat fehlgeschlagen','error');
  }
}

// Builds the actual Rezept PDF -- shared by printRezept() (physical print,
// patient present in the office) and sendRezeptToChat() (uploads the same
// PDF to the patient's chat instead), so a doctor can pick either action
// separately rather than the old single button always doing both at once.
async function buildRezeptPdf(){
  if(typeof window.jspdf==='undefined'){ alert('jsPDF lädt... Bitte nochmal versuchen.'); return null; }
  const currentName=document.getElementById('kartei-name')?.textContent;
  if(!currentName||currentName==='Kein Patient ausgewählt'){ showToast('Bitte zuerst einen Patienten auswählen.'); return null; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});

  // Get patient data -- this used to reference a "currentPatient" variable
  // that was never defined anywhere in this file, so every single call
  // threw a ReferenceError before generating anything: the Rezept tab's
  // only action was completely non-functional.
  const rec=(await findPatientRecordAsync(currentName))||{};
  const p = {name:rec.name||currentName, svnr:rec.svnr, dob:rec.dob?new Date(rec.dob).toLocaleDateString('de-AT'):null};
  const med1 = document.getElementById('rz-med1').value || '';
  const med2 = document.getElementById('rz-med2').value || '';
  const med3 = document.getElementById('rz-med3').value || '';
  const med4 = document.getElementById('rz-med4').value || '';
  const pack1 = document.getElementById('rz-pack1').value || '1';
  const pack2 = document.getElementById('rz-pack2').value || '1';
  const pack3 = document.getElementById('rz-pack3').value || '1';
  const pack4 = document.getElementById('rz-pack4').value || '1';
  const dose1 = document.getElementById('rz-dose1').value || '';
  const dose2 = document.getElementById('rz-dose2').value || '';
  const dose3 = document.getElementById('rz-dose3').value || '';
  const dose4 = document.getElementById('rz-dose4').value || '';
  const notes = document.getElementById('rz-notes').value || '';
  const befreit = document.getElementById('rz-befreit').checked;

  const T=(text,x,y,size=10,style='normal',color=[0,0,0])=>{
    doc.setFontSize(size);doc.setFont('helvetica',style);doc.setTextColor(...color);doc.text(String(text||''),x,y);
  };
  const L=(x1,y1,x2,y2,w=0.3)=>{doc.setLineWidth(w);doc.line(x1,y1,x2,y2);};
  const R=(x,y,w,h,lw=0.3)=>{doc.setLineWidth(lw);doc.rect(x,y,w,h);};

  let y=15;

  // Header -- plain white background (bold colored title + a thin rule)
  // instead of a full-width solid-fill banner, which burns through a real
  // printer's ink/toner for zero extra information over a title.
  T('KASSENREZEPT',15,14,18,'bold',[30,64,175]);
  T('Österreich · DSGVO-konform',140,10,8,'normal',[120,120,120]);
  T(new Date().toLocaleDateString('de-AT'),140,16,9,'normal',[120,120,120]);
  doc.setDrawColor(30,64,175);L(10,20,200,20,0.6);
  y=28;

  // Arzt Info
  R(10,y,90,22);
  T('Ausstellende Ärztin:',13,y+6,8,'normal',[120,120,120]);
  T(document.getElementById('setArztName')?.value||'—',13,y+12,11,'bold');
  T((document.getElementById('setFach')?.value||'—')+' · '+(document.getElementById('setAdresse')?.value||'—'),13,y+18,8);

  // Patient Info
  R(105,y,95,22);
  T('Patient/in:',108,y+6,8,'normal',[120,120,120]);
  T((p.name||'—'),108,y+12,11,'bold');
  T('SV-Nr: '+(p.svnr||'—')+'  Geb: '+(p.dob||'—'),108,y+18,8);
  y+=30;

  // Rezeptgebührenbefreit
  if(befreit){
    doc.setFillColor(240,253,244);doc.rect(10,y,190,9,'F');
    doc.setLineWidth(0.5);doc.setDrawColor(34,197,94);doc.rect(10,y,190,9);
    T('✓  REZEPTGEBÜHRENBEFREIT',15,y+6,10,'bold',[22,163,74]);
    y+=14;
  }

  // Medikamente
  T('Verordnungen:',10,y+6,11,'bold');
  y+=10;
  L(10,y,200,y);
  y+=4;

  // Loop over all 4 possible Medikament slots (rz-med3/4 added alongside
  // the "+ Medikament hinzufügen" button -- see addMedikamentSlot()) instead
  // of two hardcoded blocks, so a filled-in 3rd/4th medication prints the
  // same way as 1/2 without duplicating this block again.
  const medikamente=[
    {med:med1,pack:pack1,dose:dose1},
    {med:med2,pack:pack2,dose:dose2},
    {med:med3,pack:pack3,dose:dose3},
    {med:med4,pack:pack4,dose:dose4},
  ];
  let medNum=0;
  for(const m of medikamente){
    if(!m.med) continue;
    medNum++;
    doc.setFillColor(248,250,252);doc.rect(10,y,190,18,'F');
    R(10,y,190,18);
    T(medNum+'.',13,y+7,10,'bold');
    T(m.med,20,y+7,12,'bold');
    T('Packungen: '+m.pack,20,y+14,9,'normal',[80,80,80]);
    T('Dosierung: '+m.dose,80,y+14,9,'normal',[80,80,80]);
    y+=24;
  }

  if(notes){
    y+=4;
    T('Hinweise:',10,y,9,'bold',[100,100,100]);
    y+=5;
    const lines=doc.splitTextToSize(notes,180);
    doc.setFontSize(9);doc.setFont('helvetica','normal');doc.setTextColor(60,60,60);
    doc.text(lines,10,y);
    y+=lines.length*5+6;
  }

  // Signature area
  y=Math.max(y,220);
  L(10,y,200,y);
  y+=8;

  // Stamp & Signature from settings -- stempelDataUrl/sigDataUrl (declared
  // further down, set by saveSig()/the stamp upload handlers) are what
  // Einstellungen actually populates; these two localStorage keys were never
  // written by anything, so a saved signature never actually made it onto a
  // printed/sent Rezept. Same variables Überweisung/Patientenbericht already
  // read correctly.
  // Was 35x18/50x18 -- a real rubber stamp impression is roughly round
  // (~40mm across), and squeezing it into an 18mm-tall box shrank it well
  // below legible size on a printed page (user: "حجم الختم صغير كتير عالوصفة").
  // Sized up (and the label/name lines pushed down to match) so the stamp
  // prints at a size close to its real physical footprint.
  if(typeof stempelDataUrl!=='undefined'&&stempelDataUrl){try{doc.addImage(stempelDataUrl,'PNG',10,y,40,30);}catch(e){}}
  if(typeof sigDataUrl!=='undefined'&&sigDataUrl){try{doc.addImage(sigDataUrl,'PNG',60,y,55,26);}catch(e){}}
  T('Stempel & Unterschrift',10,y+34,8,'normal',[150,150,150]);
  T(document.getElementById('setArztName')?.value||'—',60,y+34,9,'bold');
  const stempelAdresse=document.getElementById('setAdresse')?.value||'';
  T((document.getElementById('setFach')?.value||'—')+(stempelAdresse?' · '+stempelAdresse.split(',').pop().trim():''),60,y+38,7,'normal',[120,120,120]);

  // Footer
  doc.setFillColor(248,250,252);doc.rect(0,282,210,15,'F');
  T('DSGVO-konform',10,290,7,'normal',[150,150,150]);
  T('Datum: '+new Date().toLocaleDateString('de-AT'),170,290,7,'normal',[150,150,150]);

  doc._rezeptPatientName=p.name;
  doc._rezeptMedSummary=[med1,med2,med3,med4].filter(Boolean).join(', ')||'Rezept';
  // Structured fields for createPatientRezept() (supabase/phase38_rezepte_
  // ueberweisungen.sql + phase39_rezept_med3_med4.sql) -- attached to the
  // returned doc the same way _rezeptPatientName/_rezeptMedSummary already
  // are, so printRezept()/sendRezeptToChat() don't need to re-read the DOM
  // a second time.
  doc._rezeptFields={med1,pack1,dose1,med2,pack2,dose2,med3,pack3,dose3,med4,pack4,dose4,notes,befreit};
  return doc;
}
function clearRezeptForm(){
  document.getElementById('rz-med1').value='';
  document.getElementById('rz-pack1').value='1';
  document.getElementById('rz-dose1').value='';
  document.getElementById('rz-med2').value='';
  document.getElementById('rz-pack2').value='1';
  document.getElementById('rz-dose2').value='';
  document.getElementById('rz-med3').value='';
  document.getElementById('rz-pack3').value='1';
  document.getElementById('rz-dose3').value='';
  document.getElementById('rz-med4').value='';
  document.getElementById('rz-pack4').value='1';
  document.getElementById('rz-dose4').value='';
  document.getElementById('rz-notes').value='';
  document.getElementById('rz-befreit').checked=false;
  document.getElementById('rz-med1-kategorie').value='alle';
  document.getElementById('rz-med2-kategorie').value='alle';
  document.getElementById('rz-med3-kategorie').value='alle';
  document.getElementById('rz-med4-kategorie').value='alle';
  renderMedikamentOptions('commonMedikamente1','alle');
  renderMedikamentOptions('commonMedikamente2','alle');
  renderMedikamentOptions('commonMedikamente3','alle');
  renderMedikamentOptions('commonMedikamente4','alle');
  document.getElementById('rz-med3-block').style.display='none';
  document.getElementById('rz-med4-block').style.display='none';
  document.getElementById('rz-add-med-btn').style.display='block';
  checkMedicationAlerts();
}

// CDSS first slice (see vendor/cdss-medication-alerts.js): non-blocking
// alerts for known drug-drug interactions / drug-allergy-class matches
// among whatever's currently typed into rz-med1..4. _rzCurrentAllergie is
// refreshed once per Rezept-tab activation (openRezeptTabForCurrentPatient()
// below) rather than re-fetched on every keystroke. Built via
// deriveAllergyText() (vendor/cdss-medication-alerts.js), which combines the
// free-text allergie field with the patient's structured Anamnese allergy
// answers -- the free-text field alone is only ever populated by CSV bulk
// import, so relying on it exclusively silently missed every allergy a
// doctor/patient actually recorded the normal way (real bug, 2026-08-07).
let _rzCurrentAllergie='';
async function openRezeptTabForCurrentPatient(){
  const name=document.getElementById('kartei-name')?.textContent;
  const rec = name && name!=='Kein Patient ausgewählt' ? await findPatientRecordAsync(name) : null;
  _rzCurrentAllergie = deriveAllergyText(rec);
  checkMedicationAlerts();
  renderCaveAlert(rec);
}

// Unconditional -- shows whenever the patient has a Cave note, regardless
// of which Medikament is (or isn't yet) typed above, unlike rzMedAlerts.
function renderCaveAlert(rec){
  const box=document.getElementById('rzCaveAlert');
  if(!box) return;
  if(rec&&rec.cave){ box.style.display='block'; box.textContent='⚠ CAVE: '+rec.cave; }
  else { box.style.display='none'; box.textContent=''; }
}
function checkMedicationAlerts(){
  const box=document.getElementById('rzMedAlerts');
  if(!box) return;
  const drugTexts=['rz-med1','rz-med2','rz-med3','rz-med4'].map(id=>document.getElementById(id)?.value||'');
  const alerts=detectMedicationAlerts(drugTexts,_rzCurrentAllergie);
  if(!alerts.length){ box.style.display='none'; box.innerHTML=''; return; }
  box.style.display='block';
  box.innerHTML=alerts.map(a=>{
    const isAllergy=a.type==='allergy';
    const bg=isAllergy?'#fef2f2':'#fffbeb', border=isAllergy?'#dc2626':'#d97706', text=isAllergy?'#991b1b':'#92400e', label=isAllergy?'⚠ Mögliche Allergie':'⚠ Mögliche Wechselwirkung';
    return `<div style="background:${bg};border-left:4px solid ${border};border-radius:10px;padding:10px 12px;margin-bottom:8px;font-size:12px;color:${text};">
      <div style="font-weight:800;margin-bottom:2px;">${label}</div>
      ${escapeHtml(a.text)}
    </div>`;
  }).join('') + `<div style="font-size:10px;color:#94a3b8;margin-bottom:10px;">Automatischer Hinweis auf Basis einer begrenzten, nicht vollständigen Liste bekannter Wechselwirkungen — ersetzt nicht die fachliche Beurteilung. Sie können trotzdem wie gewohnt speichern/drucken/senden.</div>`;
}

// "Der Patient ist in der Ordination" -- print it now, on paper, for the
// patient to take with them. Printing a real Rezept is just as much a real
// prescribing event as sending it via chat, so it persists the same
// structured record (createPatientRezept()) -- just without a document_id,
// since no PDF gets uploaded on this path.
async function printRezept(){
  const doc=await buildRezeptPdf();
  if(!doc) return;
  openPdfAndPrint(doc.output('bloburl'));
  const patientId=await findPatientIdByFullName(doc._rezeptPatientName);
  if(patientId){
    const session=currentStaffSession();
    try{ await createPatientRezept(patientId,doc._rezeptFields,session?session.username:null,null); }
    catch(e){ console.error('Failed to persist structured Rezept record after print',e); }
  }
  clearRezeptForm();
}

// "Als PDF an den Chat senden" -- same document, delivered to the patient's
// own chat/account instead of paper (kept separate from printRezept() since
// a doctor picks exactly one of the two, not both every time).
async function sendRezeptToChat(){
  const doc=await buildRezeptPdf();
  if(!doc) return;
  const name=doc._rezeptPatientName;
  try{
    const base64Data=doc.output('datauristring').split(',')[1];
    const filename=`Rezept_${name.replace(/\s+/g,'_')}_${new Date().toLocaleDateString('de-AT').replace(/\./g,'-')}.pdf`;
    const patientId=await findPatientIdByFullName(name);
    let docId=null;
    if(patientId){
      const session=currentStaffSession();
      const sizeBytes=Math.round(base64Data.length*0.75);
      const saved=await uploadPatientDocument(patientId,{
        category:'rezept', title:doc._rezeptMedSummary, filename, mimeType:'application/pdf', sizeBytes, base64Data,
      },session?session.username:null);
      docId=saved.id;
      try{ await createPatientRezept(patientId,doc._rezeptFields,session?session.username:null,docId); }
      catch(e){ console.error('Failed to persist structured Rezept record',e); }
    }
    // supabase/phase83_patient_message_translations.sql -- see the same
    // note on the Überweisung sender above. summary (the medication list)
    // is a raw value, same treatment as art/fach/dring elsewhere.
    const msg={dir:'out', type:'uw', text:`Rezept ausgestellt · ${doc._rezeptMedSummary}`,
      filename, sub:'Kassenrezept', docId, time:getTime()+' ✓',
      msgKey:'chat.uw.rezept', msgParams:{summary:doc._rezeptMedSummary}};
    appendRealMessage(name,msg);
    const chatNameEl=document.getElementById('chat-name');
    if(chatNameEl && chatNameEl.textContent===name){
      renderMessages(name,colorForName(name));
    }
    clearRezeptForm();
    showToast('✓ Rezept per Chat gesendet');
  }catch(e){
    console.error('Failed to send Rezept via chat',e);
    showToast('✗ Senden über Chat fehlgeschlagen','error');
  }
}

// Builds the actual Überweisung PDF -- shared by downloadUwPDF() (client-side
// download) and handleUwSend()'s real chat-send path (uploads this same PDF
// as a real patient_documents row), so both deliver the exact same document
// instead of the chat path being a separate, purely cosmetic simulation.
function buildUeberweisungPdf(){
  if(typeof window.jspdf==='undefined'){ throw new Error('jsPDF not loaded'); }
  const { jsPDF } = window.jspdf;
  const d = getUwData();
  const doc = new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  let y=15;
  const L=(x1,y1,x2,y2,w=0.3)=>{doc.setLineWidth(w);doc.line(x1,y1,x2,y2);};
  const R=(x,ry,w,h,lw=0.3)=>{doc.setLineWidth(lw);doc.rect(x,ry,w,h);};
  const T=(text,x,ty,size=10,style='normal',color=[0,0,0])=>{
    doc.setFontSize(size);doc.setFont('helvetica',style);doc.setTextColor(...color);doc.text(String(text||''),x,ty);
  };

  // Title
  doc.setFontSize(24);doc.setFont('helvetica','bolditalic');doc.setTextColor(0,0,0);
  doc.text('Überweisung',15,y);
  R(160,8,35,12,0.5); T(d.kt,177,16,11,'bold'); T('Kostenträger',161,22,7,'normal',[120,120,120]);
  y+=6; T('Gilt nicht als Vorbewilligung für eine spätere stationäre Krankenhausaufnahme.',15,y,7,'normal',[100,100,100]);
  y+=4; L(15,y,195,y,0.5); y+=5;

  // KT Boxes
  const kts=['ÖGK','BVAEB','SVS','KFL','Andere'];
  kts.forEach((kt,i)=>{
    const x=15+i*36;
    if(d.kt===kt){doc.setFillColor(0,0,0);doc.rect(x,y,36,7,'F');T(kt,x+18,y+5,9,'bold',[255,255,255]);}
    else{R(x,y,36,7);T(kt,x+18,y+5,9,'normal',[0,0,0]);}
  });y+=7;

  // Status boxes
  const sts=[['1','Erwerbstätig',22],['5','Pensionist',22],['7','Arbeitslos',22],['9','Kriegshinterbliebene',34]];
  let sx=15;
  sts.forEach(([n,l,w])=>{
    if(d.status===n){doc.setFillColor(0,0,0);doc.rect(sx,y,w,10,'F');T(n,sx+w/2-1,y+5,11,'bold',[255,255,255]);T(l.substring(0,8),sx+2,y+9,6,'normal',[200,200,200]);}
    else{R(sx,y,w,10);T(n,sx+w/2-1,y+5,11,'bold');T(l.substring(0,7),sx+2,y+9,6,'normal',[120,120,120]);}
    sx+=w;
  });
  R(sx,y,195-sx,10);T('Bitte zutreffendes Feld bezeichnen!',sx+2,y+6,7,'normal',[100,100,100]);y+=12;

  // Patient
  R(15,y,180,10);T('Familienname / Vorname',17,y+3,7,'normal',[120,120,120]);T(d.pName,17,y+8,12,'bold');y+=10;
  R(15,y,90,9);R(105,y,90,9);
  T('Anschrift',17,y+3,7,'normal',[120,120,120]);T(d.pAdresse||'',17,y+7.5,9);
  T('Versicherungsnummer',107,y+3,7,'normal',[120,120,120]);
  doc.setFont('courier','bold');doc.setFontSize(11);doc.text(d.pSVNR||'',107,y+7.5);doc.setFont('helvetica','normal');y+=9;
  R(15,y,90,8);R(105,y,90,8);
  T('Beschäftigt bei (Dienstgeber)',17,y+3,7,'normal',[120,120,120]);
  T('Versicherte/r (Angehörige/r)',107,y+3,7,'normal',[120,120,120]);y+=9;

  // Überweisung header
  doc.setFillColor(0,0,0);doc.rect(15,y,180,5,'F');doc.setTextColor(255,255,255);doc.setFontSize(8);doc.setFont('helvetica','bold');
  doc.text('ÜBERWEISUNG',17,y+3.5);doc.setTextColor(0,0,0);y+=5;
  R(15,y,90,8);R(105,y,90,8);T('Von',17,y+3,7,'normal',[120,120,120]);T(d.von,17,y+7,9);T('Überweisung an',107,y+3,7,'normal',[120,120,120]);T(d.an,107,y+7,9);y+=8;
  // Anschrift/Telefon of the RECEIVING doctor/Krankenhaus -- only drawn
  // when at least one was actually filled in, same reasoning as buildUwA4()'s
  // anKontaktRow above.
  if(d.anAdresse||d.anTel){
    R(15,y,90,8);R(105,y,90,8);
    T('Anschrift (Arzt/Krankenhaus)',17,y+3,7,'normal',[120,120,120]);T(d.anAdresse||'–',17,y+7,9);
    T('Telefon (Arzt/Krankenhaus)',107,y+3,7,'normal',[120,120,120]);T(d.anTel||'–',107,y+7,9);
    y+=8;
  }
  R(15,y,90,8);R(105,y,90,8);T('Fachrichtung',17,y+3,7,'normal',[120,120,120]);T(d.fach,17,y+7,10,'bold');
  T('Dringlichkeit',107,y+3,7,'normal',[120,120,120]);
  const dc=d.dring==='Notfall'?[220,38,38]:d.dring==='Dringend'?[217,119,6]:[0,0,0];
  T(d.dring,107,y+7,10,'bold',dc);doc.setTextColor(0,0,0);y+=9;

  // Diagnose header
  doc.setFillColor(0,0,0);doc.rect(15,y,180,5,'F');doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');doc.setFontSize(8);
  doc.text('DIAGNOSE & BEFUND',17,y+3.5);doc.setTextColor(0,0,0);y+=5;
  R(15,y,180,9);T('Diagnose',17,y+3,7,'normal',[120,120,120]);T(d.diag,17,y+8,10,'bold');y+=9;
  R(15,y,180,9);T('wegen',17,y+3,7,'normal',[120,120,120]);T(d.wegen,17,y+8,9);y+=9;
  const nlines=doc.splitTextToSize(d.notes,174);
  const nh=Math.max(14,nlines.length*4+8);R(15,y,180,nh);T('Klinische Informationen',17,y+3,7,'normal',[120,120,120]);
  doc.setFontSize(9);doc.setFont('helvetica','normal');doc.text(nlines,17,y+7);y+=nh+2;

  // Bottom
  R(15,y,90,30);R(105,y,90,30);
  T('*) Bitte Zutreffendes ankreuzen',17,y+4,7,'normal',[100,100,100]);
  T('Arbeitsunfähig:',17,y+10,9,'bold');
  R(52,y+7,4,4);if(d.au==='Ja')T('✓',52.5,y+10.5,8,'bold');T('Ja',57,y+10,9);
  R(65,y+7,4,4);if(d.au==='Nein')T('✓',65.5,y+10.5,8,'bold');T('Nein',70,y+10,9);
  T('Rezeptgebührenbefreit:',17,y+17,9,'bold');
  R(63,y+14,4,4);if(d.rez==='Ja')T('✓',63.5,y+17.5,8,'bold');T('Ja',68,y+17,9);
  R(76,y+14,4,4);if(d.rez==='Nein')T('✓',76.5,y+17.5,8,'bold');T('Nein',81,y+17,9);
  T('Behandlungsbeginn am: ___________',17,y+24,8,'normal',[100,100,100]);
  T('Die vertraglich vorgesehenen Kosten werden übernommen',107,y+4,7,'normal',[100,100,100]);
  T('Datum: '+d.datum,107,y+11,9,'bold');
  doc.setLineDashPattern([1,1],0);R(107,y+14,85,14,0.3);doc.setLineDashPattern([],0);
  T('Stempel und Unterschrift',135,y+22,7,'normal',[160,160,160]);y+=32;

  // Was placed via a fixed "y-28" offset that assumed ~28mm of whitespace
  // already sat above this line -- but the line is drawn right where the
  // fixed layout above happens to end, so that offset actually landed the
  // images back up over the "Datum:"/dashed-box area from the PREVIOUS
  // block instead of in fresh space here (same root cause as the
  // Patientenbericht bug this was copied from -- see buildPatientReportPdf).
  // Reserving the space and flowing the line below the images fixes both.
  // Same fix as buildRezeptPdf()/buildPatientReportPdf() (see their own
  // comments): a real round stamp impression squeezed into a 28x20mm box
  // came out tiny/distorted. The two boxes drawn above (R(15,y,90,30) and
  // R(105,y,90,30)) both end above this point -- the full page width is
  // free here, not just the right-hand column those boxes/the dashed
  // placeholder above sit in -- so this can match Rezept's exact,
  // already-legible dimensions/positions instead of being needlessly
  // narrower.
  const sigY=y;
  if(stempelDataUrl){ try{ doc.addImage(stempelDataUrl,'PNG',10,sigY,40,30); }catch(e){} }
  if(sigDataUrl){ try{ doc.addImage(sigDataUrl,'PNG',60,sigY,55,26); }catch(e){} }
  y=sigY+34;
  L(15,y,195,y,0.3);y+=4;
  T('Stempel und Unterschrift des Arztes/der Ärztin',15,y,7,'normal',[100,100,100]);
  // Was x=195 -- overflows the A4 page's right edge for this string length.
  T('DSGVO-konform | '+d.datum,150,y,7,'normal',[150,150,150]);

  return doc;
}
// Downloading is just as much a real referral event as sending via chat
// (a doctor handing the printed/downloaded PDF directly to the patient),
// so it persists the same structured record -- just without a document_id,
// since no PDF gets uploaded to patient_documents on this path.
async function downloadUwPDF(){
  if(typeof window.jspdf==='undefined'){ alert('jsPDF lädt... Bitte nochmal versuchen.'); return; }
  const d = getUwData();
  const doc = buildUeberweisungPdf();
  doc.save(`Überweisung_${d.pNachname}_${d.datum.replace(/\./g,'-')}.pdf`);
  const patientId=await findPatientIdByFullName(d.pName);
  if(patientId){
    const session=currentStaffSession();
    try{
      await createPatientUeberweisung(patientId,{
        kt:d.kt, status:d.status, von:d.von, an:d.an, anAdresse:d.anAdresse, anTel:d.anTel, fach:d.fach, dring:d.dring,
        diag:d.diag, wegen:d.wegen, notes:d.notes, au:d.au==='Ja', rez:d.rez==='Ja',
        datumIso:uwVal('uwDatum'),
      },session?session.username:null,null);
    }catch(e){ console.error('Failed to persist structured Überweisung record after download',e); }
  }
  clearUeberweisungForm();
}
// "Drucken" -- the preview modal used to only offer a PDF download, with no
// way to print the referral directly for a patient who's still in the
// Ordination. Same openPdfAndPrint() (hidden-iframe) pattern as
// printRezept(), and persists the same structured record as
// downloadUwPDF() -- just without a document_id, since nothing gets
// uploaded to patient_documents on this path either.
async function printUwPDF(){
  if(typeof window.jspdf==='undefined'){ alert('jsPDF lädt... Bitte nochmal versuchen.'); return; }
  const d = getUwData();
  const doc = buildUeberweisungPdf();
  openPdfAndPrint(doc.output('bloburl'));
  const patientId=await findPatientIdByFullName(d.pName);
  if(patientId){
    const session=currentStaffSession();
    try{
      await createPatientUeberweisung(patientId,{
        kt:d.kt, status:d.status, von:d.von, an:d.an, anAdresse:d.anAdresse, anTel:d.anTel, fach:d.fach, dring:d.dring,
        diag:d.diag, wegen:d.wegen, notes:d.notes, au:d.au==='Ja', rez:d.rez==='Ja',
        datumIso:uwVal('uwDatum'),
      },session?session.username:null,null);
    }catch(e){ console.error('Failed to persist structured Überweisung record after print',e); }
  }
  clearUeberweisungForm();
}
