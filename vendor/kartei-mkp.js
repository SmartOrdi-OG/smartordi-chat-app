// Kartei "MKP" (Mutter-Kind-Pass) tab -- extracted out of doctor.html's own
// inline <script> into its own file, same reasoning/pattern as
// vendor/kartei-visits.js (VISITS/Verlauf tab): doctor.html had grown into
// one huge script mixing dozens of unrelated features together. No behavior
// change here -- every function/constant below is moved verbatim; doctor.html
// loads this file before its own inline <script> so every global here
// (MKP_EXAMS, renderKarteiMkp, etc.) is still available exactly as before to
// onclick="..." attributes and other code in doctor.html itself
// (findPatientIdByFullName/findPatientByFullName/getMkpExamsForPatient/
// saveMkpExam come from vendor/patient-data.js; escapeHtml/currentStaffSession/
// showToast stay in doctor.html).

// ══ MKP (Mutter-Kind-Pass) -- staff-only digital copy of the 13 standard
// Austrian pediatric checkups, supabase/phase4_mkp_untersuchungen.sql.
// Field lists transcribed from the real booklet; stored as one jsonb blob
// per exam (mkp_untersuchungen.data) since the field set varies wildly
// per exam (5 to 30+ fields) -- modeling one rigid DB column per field
// across 13 different exam types isn't worth it. Birth-day exams (U1)
// happen at the hospital and pregnancy exams are out of scope entirely --
// this only covers the pediatrician's own 13 checkups.
// Field types: num (number input), text (short text), textarea,
// yn (Ja/Nein toggle), status (Auffällig/Unauffällig toggle), check
// (single checkbox).
const MKP_EXAMS=[
  {key:'lw4_7_allgemein', title:'Allgemeine Untersuchung', ageLabel:'4.–7. Lebenswoche', minDay:28, maxDay:49, fields:[
    {id:'gewicht',label:'Körpergewicht (g)',type:'num'},
    {id:'laenge',label:'Körperlänge (cm)',type:'num'},
    {id:'kopfumfang',label:'Kopfumfang (cm)',type:'num'},
    {id:'stillen',label:'Stillen',type:'yn'},
    {id:'ernaehrung_altersgemaess',label:'Ernährung altersgemäß',type:'yn'},
    {id:'vitamin_d',label:'Rachitisprophylaxe: Vitamin D täglich',type:'yn'},
    {id:'vitamin_k',label:'Orale Vitamin-K-Prophylaxe wiederholt',type:'yn'},
    {id:'trinkschwierigkeiten',label:'Trinkschwierigkeiten',type:'yn'},
    {id:'gedeihstoerung',label:'Gedeihstörung',type:'yn'},
    {id:'erkrankung',label:'Zwischenzeitliche Erkrankung',type:'yn'},
    {id:'erbrechen',label:'Erbrechen',type:'yn'},
    {id:'krampfanfaelle',label:'Krampfanfälle',type:'yn'},
    {id:'rueckenlage',label:'Rückenlage: Spontanhaltung',type:'status'},
    {id:'bauchlage',label:'Bauchlage: Kopfheben und Seitwärtsdrehen',type:'status'},
    {id:'reagiert_reize',label:'Reagiert auf Reize',type:'status'},
    {id:'fixiert',label:'Fixiert',type:'status'},
    {id:'allgemeinzustand',label:'Allgemeinzustand',type:'status'},
    {id:'ernaehrungszustand',label:'Ernährungszustand',type:'status'},
    {id:'entwicklungsstand',label:'Entwicklungsstand',type:'status'},
    {id:'augen',label:'Augen: brechende Medien',type:'status'},
    {id:'organbefunde',label:'Sonstige Organbefunde',type:'status'},
    {id:'diagnose',label:'Diagnose',type:'textarea'},
  ]},
  {key:'lw6_8_huefte', title:'Hüftultraschalluntersuchung', ageLabel:'6.–8. Lebenswoche', minDay:42, maxDay:56, fields:[
    {id:'typ_rechts',label:'Typ rechts',type:'text'},
    {id:'typ_links',label:'Typ links',type:'text'},
    {id:'behandlungsindikation',label:'Behandlungsindikation',type:'check'},
    {id:'therapie',label:'Therapie',type:'text'},
    {id:'kontrolle_wochen',label:'Kontrolle in (Wochen)',type:'num'},
  ]},
  {key:'lw4_7_orthopaedisch', title:'Orthopädische Untersuchung', ageLabel:'4.–7. Lebenswoche', minDay:28, maxDay:49, fields:[
    {id:'fam_huefte',label:'Familienanamnese: Hüfte auffällig',type:'yn'},
    {id:'fam_fuesse',label:'Familienanamnese: Füße auffällig',type:'yn'},
    {id:'fam_wirbels',label:'Familienanamnese: Wirbelsäule auffällig',type:'yn'},
    {id:'fam_sonst',label:'Familienanamnese: Sonstiges auffällig',type:'yn'},
    {id:'gestationsalter',label:'Gestationsalter (Wochen)',type:'num'},
    {id:'beckenendlage',label:'Beckenendlage',type:'yn'},
    {id:'mehrling',label:'Mehrling',type:'yn'},
    {id:'spontanmotorik',label:'Spontanmotorik',type:'status'},
    {id:'schaedel',label:'Schädel',type:'status'},
    {id:'hals',label:'Hals (Schiefhals)',type:'status'},
    {id:'wirbelsaeule',label:'Wirbelsäule',type:'status'},
    {id:'thorax',label:'Thorax',type:'status'},
    {id:'beweglichkeit',label:'Beweglichkeit der Extremitäten',type:'status'},
    {id:'obere_extremitaeten',label:'Obere Extremitäten',type:'status'},
    {id:'huefte_rechts',label:'Hüfte rechts (locker/Spreizhemmung/Ortolani)',type:'text'},
    {id:'huefte_links',label:'Hüfte links (locker/Spreizhemmung/Ortolani)',type:'text'},
    {id:'laengendifferenz',label:'Längendifferenz',type:'status'},
    {id:'fussstellung',label:'Fußstellung (Hacken-/Knick-/Sichel-/Kletter-/Klumpfuß)',type:'status'},
    {id:'ober_unterschenkel',label:'Ober-, Unterschenkel',type:'status'},
    {id:'fuesse',label:'Füße',type:'status'},
    {id:'sonstiges',label:'Sonstiges',type:'textarea'},
    {id:'diagnose',label:'Diagnose',type:'textarea'},
    {id:'behandlungsindikation',label:'Behandlungsindikation',type:'check'},
    {id:'in_behandlung',label:'Dzt. in Behandlung',type:'check'},
    {id:'kontrolle_dringend',label:'Orthopädische Kontrolle dringend empfohlen',type:'check'},
  ]},
  {key:'mo3_5_allgemein', title:'Allgemeine Untersuchung', ageLabel:'3.–5. Lebensmonat', minDay:90, maxDay:150, fields:[
    {id:'gewicht',label:'Körpergewicht (g)',type:'num'},
    {id:'laenge',label:'Körperlänge (cm)',type:'num'},
    {id:'kopfumfang',label:'Kopfumfang (cm)',type:'num'},
    {id:'stillen',label:'Stillen',type:'yn'},
    {id:'ernaehrung_altersgemaess',label:'Ernährung altersgemäß',type:'yn'},
    {id:'vitamin_d',label:'Rachitisprophylaxe: Vitamin D täglich',type:'yn'},
    {id:'ernaehrungsschwierigkeiten',label:'Ernährungsschwierigkeiten',type:'yn'},
    {id:'erkrankung',label:'Zwischenzeitliche Erkrankung',type:'yn'},
    {id:'greifbewegungen',label:'Greifbewegungen',type:'status'},
    {id:'reaktion_licht',label:'Reaktion auf Licht/Bewegung',type:'status'},
    {id:'strabismus',label:'Strabismus',type:'status'},
    {id:'reaktion_geraeusche',label:'Reaktion auf Geräusche',type:'status'},
    {id:'hebt_kopf',label:'Hebt Kopf in Bauchlage bis 90°',type:'status'},
    {id:'oberkoerper',label:'Oberkörper in Bauchlage auf Arme gestützt',type:'status'},
    {id:'dreht_sich',label:'Dreht sich um',type:'status'},
    {id:'spreizhemmung',label:'Spreizhemmung',type:'status'},
    {id:'allgemeinzustand',label:'Allgemeinzustand',type:'status'},
    {id:'ernaehrungszustand',label:'Ernährungszustand',type:'status'},
    {id:'entwicklungsstand',label:'Entwicklungsstand',type:'status'},
    {id:'augen',label:'Augen: brechende Medien',type:'status'},
    {id:'organbefunde',label:'Sonstige Organbefunde',type:'status'},
    {id:'diagnose',label:'Diagnose',type:'textarea'},
  ]},
  {key:'mo7_9_allgemein', title:'Allgemeine Untersuchung', ageLabel:'7.–9. Lebensmonat', minDay:210, maxDay:270, fields:[
    {id:'gewicht',label:'Körpergewicht (g)',type:'num'},
    {id:'laenge',label:'Körperlänge (cm)',type:'num'},
    {id:'kopfumfang',label:'Kopfumfang (cm)',type:'num'},
    {id:'ernaehrung_altersgemaess',label:'Ernährung altersgemäß',type:'yn'},
    {id:'vitamin_d',label:'Rachitisprophylaxe: Vitamin D täglich',type:'yn'},
    {id:'fluorid',label:'Fluoridprophylaxe',type:'yn'},
    {id:'ernaehrungsschwierigkeiten',label:'Ernährungsschwierigkeiten',type:'yn'},
    {id:'erkrankung',label:'Zwischenzeitliche Erkrankung',type:'yn'},
    {id:'sitzt_frei',label:'Sitzt frei',type:'status'},
    {id:'krabbeln',label:'Krabbeln',type:'status'},
    {id:'stehbereitschaft',label:'Stehbereitschaft',type:'status'},
    {id:'daumen_finger',label:'Daumen-Finger-Greifen',type:'status'},
    {id:'sprachlaute',label:'Imitiert Sprachlaute',type:'status'},
    {id:'sozialer_kontakt',label:'Sozialer Kontakt gut',type:'status'},
    {id:'strabismus',label:'Strabismus',type:'status'},
    {id:'allgemeinzustand',label:'Allgemeinzustand',type:'status'},
    {id:'ernaehrungszustand',label:'Ernährungszustand',type:'status'},
    {id:'entwicklungsstand',label:'Entwicklungsstand',type:'status'},
    {id:'organbefunde',label:'Organbefunde',type:'status'},
    {id:'gebiss',label:'Gebiss',type:'status'},
    {id:'diagnose',label:'Diagnose',type:'textarea'},
  ]},
  {key:'mo7_9_hno', title:'HNO-Untersuchung', ageLabel:'7.–9. Lebensmonat', minDay:210, maxDay:270, fields:[
    {id:'risikofaktoren',label:'Risikofaktoren in der Anamnese',type:'yn'},
    {id:'erschrickt',label:'Erschrickt bei plötzlichen lauten Geräuschen',type:'yn'},
    {id:'reagiert_geraeusche',label:'Reagiert auf Geräusche (Türklingel, Telefon, Spielzeug)',type:'yn'},
    {id:'schlaeft_weiter',label:'Schläft weiter bei ungewöhnlichem Lärm',type:'yn'},
    {id:'reagiert_zurufe',label:'Reagiert auf Zurufe',type:'yn'},
    {id:'laesst_beruhigen',label:'Lässt sich durch Ansprechen beruhigen',type:'yn'},
    {id:'lallende_laute',label:'Bringt lallende Laute hervor',type:'yn'},
    {id:'melodisch',label:'Klingen diese Laute melodisch',type:'yn'},
    {id:'ohr',label:'Ohr (Muschel, Gehörgang, Trommelfell)',type:'status'},
    {id:'nase',label:'Nase',type:'status'},
    {id:'mund_rachen',label:'Mund, Rachen',type:'status'},
    {id:'hoerreaktion_re',label:'Hörreaktion re. (laut/mittellaut/leise)',type:'text'},
    {id:'hoerreaktion_li',label:'Hörreaktion li. (laut/mittellaut/leise)',type:'text'},
    {id:'diagnose',label:'Diagnose',type:'textarea'},
    {id:'kontrolle_dringend',label:'Fachärztliche Kontrolle dringend empfohlen',type:'check'},
  ]},
  {key:'mo10_14_allgemein', title:'Allgemeine Untersuchung', ageLabel:'10.–14. Lebensmonat', minDay:300, maxDay:420, fields:[
    {id:'gewicht',label:'Körpergewicht (g)',type:'num'},
    {id:'laenge',label:'Körperlänge (cm)',type:'num'},
    {id:'kopfumfang',label:'Kopfumfang (cm)',type:'num'},
    {id:'ernaehrung_altersgemaess',label:'Ernährung altersgemäß',type:'yn'},
    {id:'fluorid',label:'Fluoridprophylaxe',type:'yn'},
    {id:'ernaehrungsschwierigkeiten',label:'Ernährungsschwierigkeiten',type:'yn'},
    {id:'erkrankung',label:'Zwischenzeitliche Erkrankung',type:'yn'},
    {id:'sprachentwicklung',label:'Sprachentwicklung altersgemäß',type:'yn'},
    {id:'reagiert_namen',label:'Reagiert auf Rufen seines Namens',type:'yn'},
    {id:'wiederholt',label:'Wiederholt immer dieselben Laute/Silben/Worte/Tätigkeiten',type:'yn'},
    {id:'aufstehen',label:'Aufstehen',type:'status'},
    {id:'stehen_halten',label:'Stehen mit Halten',type:'status'},
    {id:'stehen_frei',label:'Stehen frei',type:'status'},
    {id:'gehen_frei',label:'Gehen frei',type:'status'},
    {id:'allgemeinzustand',label:'Allgemeinzustand',type:'status'},
    {id:'ernaehrungszustand',label:'Ernährungszustand',type:'status'},
    {id:'motorische_entwicklung',label:'Motorische Entwicklung',type:'status'},
    {id:'sozialentwicklung',label:'Sozialentwicklung',type:'status'},
    {id:'psychische_entwicklung',label:'Psychische Entwicklung',type:'status'},
    {id:'organbefunde',label:'Organbefunde',type:'status'},
    {id:'genitale',label:'Genitale',type:'status'},
    {id:'gebiss',label:'Gebiss',type:'status'},
    {id:'diagnose',label:'Diagnose',type:'textarea'},
    {id:'mmr_vorhanden',label:'MMR-Impfung vorhanden',type:'check'},
  ]},
  {key:'mo10_14_augen', title:'Augenuntersuchung', ageLabel:'10.–14. Lebensmonat', minDay:300, maxDay:420, fields:[
    {id:'risikofaktoren',label:'Risikofaktoren in der Anamnese',type:'yn'},
    {id:'missbildungen',label:'Missbildungen',type:'status'},
    {id:'aeussere_augenanteile',label:'Auffälligkeiten an äußeren Augenanteilen',type:'status'},
    {id:'hornhaut_linse',label:'Auffälligkeiten an Hornhaut und Linse',type:'status'},
    {id:'parallelstand',label:'Parallelstand der Augen',type:'status'},
    {id:'bulbusmotilitaet',label:'Freie Bulbusmotilität',type:'status'},
    {id:'fixation',label:'Fixation',type:'status'},
    {id:'diagnose',label:'Diagnose',type:'textarea'},
    {id:'kontrolle_dringend',label:'Fachärztliche Kontrolle dringend empfohlen',type:'check'},
  ]},
  {key:'mo22_26_allgemein', title:'Allgemeine Untersuchung', ageLabel:'22.–26. Lebensmonat', minDay:660, maxDay:780, fields:[
    {id:'gewicht',label:'Körpergewicht (g)',type:'num'},
    {id:'laenge',label:'Körperlänge (cm)',type:'num'},
    {id:'kopfumfang',label:'Kopfumfang (cm)',type:'num'},
    {id:'fluorid',label:'Fluoridprophylaxe',type:'yn'},
    {id:'verhaltensauffaelligkeiten',label:'Verhaltensauffälligkeiten',type:'yn'},
    {id:'zieht_zurueck',label:'Zieht sich öfters zurück',type:'yn'},
    {id:'als_ob_spiele',label:'Spielt "Als-Ob-Spiele" (z.B. Puppe füttern)',type:'yn'},
    {id:'erkrankung',label:'Zwischenzeitliche Erkrankung',type:'yn'},
    {id:'sprachentwicklung',label:'Sprachentwicklung altersgemäß',type:'yn'},
    {id:'allgemeinzustand',label:'Allgemeinzustand',type:'status'},
    {id:'ernaehrungszustand',label:'Ernährungszustand',type:'status'},
    {id:'motorische_entwicklung',label:'Motorische Entwicklung',type:'status'},
    {id:'psychische_entwicklung',label:'Psychische Entwicklung',type:'status'},
    {id:'sozialentwicklung',label:'Sozialentwicklung',type:'status'},
    {id:'ohren',label:'Ohren, Trommelfell',type:'status'},
    {id:'organbefunde',label:'Sonstige Organbefunde',type:'status'},
    {id:'gebiss',label:'Gebiss',type:'status'},
    {id:'diagnose',label:'Diagnose',type:'textarea'},
    {id:'mmr_2dosen',label:'MMR-Impfungen (2 Dosen) vorhanden',type:'check'},
  ]},
  {key:'mo22_26_augen', title:'Augenuntersuchung', ageLabel:'22.–26. Lebensmonat', minDay:660, maxDay:780, fields:[
    {id:'vorerkrankungen',label:'Anamnese: Vorerkrankungen',type:'yn'},
    {id:'lichtempfindlichkeit',label:'Lichtempfindlichkeit',type:'yn'},
    {id:'aeussere_augenanteile',label:'Äußere Augenanteile',type:'status'},
    {id:'bulbusstellung',label:'Bulbusstellung',type:'status'},
    {id:'bulbusmotilitaet',label:'Bulbusmotilität',type:'status'},
    {id:'cover_test',label:'Cover-Test (Heterophorie)',type:'status'},
    {id:'konvergenzpruefung',label:'Konvergenzprüfung',type:'status'},
    {id:'brechende_medien',label:'Brechende Medien (Spaltlampe)',type:'status'},
    {id:'fundus',label:'Fundus',type:'status'},
    {id:'visus',label:'Visus',type:'status'},
    {id:'fixation',label:'Fixation (zentral/parazentral/peripher)',type:'text'},
    {id:'skiaskopie_re',label:'Skiaskopie re. Auge (Emmetropie/Hyperopie/Myopie/Astigmatismus)',type:'text'},
    {id:'skiaskopie_li',label:'Skiaskopie li. Auge',type:'text'},
    {id:'anisometropie',label:'Anisometropie',type:'check'},
    {id:'schielen',label:'Wenn Schielen vorliegt (Begleit-/Lähmungsschielen)',type:'text'},
    {id:'heterophorie',label:'Heterophorie (alternierend/nach oben/außen/innen/einseitig)',type:'text'},
    {id:'amblyopie',label:'Amblyopie',type:'check'},
    {id:'diagnose',label:'Diagnose',type:'textarea'},
    {id:'kontrolle_dringend',label:'Fachärztliche Kontrolle dringend empfohlen',type:'check'},
  ]},
  {key:'mo34_38_allgemein', title:'Allgemeine Untersuchung', ageLabel:'34.–38. Lebensmonat', minDay:1020, maxDay:1140, fields:[
    {id:'gewicht',label:'Körpergewicht (g)',type:'num'},
    {id:'laenge',label:'Körperlänge (cm)',type:'num'},
    {id:'kopfumfang',label:'Kopfumfang (cm)',type:'num'},
    {id:'fluorid',label:'Fluoridprophylaxe',type:'yn'},
    {id:'verhaltensauffaelligkeiten',label:'Verhaltensauffälligkeiten',type:'yn'},
    {id:'erkrankung',label:'Zwischenzeitliche Erkrankung',type:'yn'},
    {id:'sprachentwicklung',label:'Sprachentwicklung altersgemäß',type:'yn'},
    {id:'allgemeinzustand',label:'Allgemeinzustand',type:'status'},
    {id:'ernaehrungszustand',label:'Ernährungszustand',type:'status'},
    {id:'motorische_entwicklung',label:'Motorische Entwicklung',type:'status'},
    {id:'psychische_entwicklung',label:'Psychische Entwicklung',type:'status'},
    {id:'sozialentwicklung',label:'Sozialentwicklung',type:'status'},
    {id:'augen',label:'Augen',type:'status'},
    {id:'ohren',label:'Ohren',type:'status'},
    {id:'organbefunde',label:'Sonstige Organbefunde',type:'status'},
    {id:'gebiss',label:'Gebiss',type:'status'},
    {id:'blutdruck',label:'Blutdruck',type:'text'},
    {id:'diagnose',label:'Diagnose',type:'textarea'},
  ]},
  {key:'mo46_50_allgemein', title:'Allgemeine Untersuchung', ageLabel:'46.–50. Lebensmonat', minDay:1380, maxDay:1500, fields:[
    {id:'gewicht',label:'Körpergewicht (g)',type:'num'},
    {id:'laenge',label:'Körperlänge (cm)',type:'num'},
    {id:'kopfumfang',label:'Kopfumfang (cm)',type:'num'},
    {id:'fluorid',label:'Fluoridprophylaxe',type:'yn'},
    {id:'verhaltensauffaelligkeiten',label:'Verhaltensauffälligkeiten',type:'yn'},
    {id:'erkrankung',label:'Zwischenzeitliche Erkrankung',type:'yn'},
    {id:'sprachentwicklung',label:'Sprachentwicklung altersgemäß',type:'yn'},
    {id:'allgemeinzustand',label:'Allgemeinzustand',type:'status'},
    {id:'ernaehrungszustand',label:'Ernährungszustand',type:'status'},
    {id:'motorische_entwicklung',label:'Motorische Entwicklung',type:'status'},
    {id:'psychische_entwicklung',label:'Psychische Entwicklung',type:'status'},
    {id:'sozialentwicklung',label:'Sozialentwicklung',type:'status'},
    {id:'augen',label:'Augen',type:'status'},
    {id:'ohren',label:'Ohren',type:'status'},
    {id:'organbefunde',label:'Sonstige Organbefunde',type:'status'},
    {id:'gebiss',label:'Gebiss',type:'status'},
    {id:'blutdruck',label:'Blutdruck',type:'text'},
    {id:'diagnose',label:'Diagnose',type:'textarea'},
  ]},
  {key:'mo58_62_allgemein', title:'Allgemeine Untersuchung', ageLabel:'58.–62. Lebensmonat', minDay:1740, maxDay:1860, fields:[
    {id:'gewicht',label:'Körpergewicht (g)',type:'num'},
    {id:'laenge',label:'Körperlänge (cm)',type:'num'},
    {id:'kopfumfang',label:'Kopfumfang (cm)',type:'num'},
    {id:'motorische_faehigkeiten',label:'Motorische Fähigkeiten altersgemäß',type:'yn'},
    {id:'kognitive_faehigkeiten',label:'Kognitive Fähigkeiten altersgemäß',type:'yn'},
    {id:'sprachentwicklung',label:'Sprachentwicklung altersgemäß',type:'yn'},
    {id:'verhaltensauffaelligkeiten',label:'Verhaltensauffälligkeiten',type:'yn'},
    {id:'erkrankungen',label:'Zwischenzeitliche Erkrankungen',type:'yn'},
    {id:'fluorid',label:'Fluoridprophylaxe',type:'yn'},
    {id:'zahnpflege',label:'Zahnpflege',type:'yn'},
    {id:'allgemeinzustand',label:'Allgemeinzustand',type:'status'},
    {id:'ernaehrungszustand',label:'Ernährungszustand',type:'status'},
    {id:'koerperliche_haltung',label:'Körperliche Haltung',type:'status'},
    {id:'kognitive_entwicklung',label:'Kognitive Entwicklung',type:'status'},
    {id:'motorische_entwicklung',label:'Motorische Entwicklung',type:'status'},
    {id:'psychosoziale_entwicklung',label:'Psychosoziale Entwicklung',type:'status'},
    {id:'augen',label:'Augen',type:'status'},
    {id:'ohren',label:'Ohren',type:'status'},
    {id:'gebiss',label:'Gebiss',type:'status'},
    {id:'organbefunde',label:'Sonstige Organbefunde',type:'status'},
    {id:'blutdruck',label:'Blutdruck',type:'text'},
    {id:'diagnose',label:'Diagnose',type:'textarea'},
  ]},
];
let mkpCurrentPatientId=null;
let mkpCurrentRecords=[];
let mkpCurrentExamKey=null;
function mkpAgeDays(dob){
  if(!dob) return null;
  const ms=new Date()-new Date(dob+'T00:00:00');
  return Math.floor(ms/86400000);
}
function mkpStatusFor(exam,record,ageDays){
  if(record&&record.completed_at) return {label:'Erledigt',cls:'done'};
  if(ageDays==null) return {label:'—',cls:'upcoming'};
  if(ageDays>=exam.minDay) return {label:'Fällig',cls:'due'};
  return {label:'Noch nicht fällig',cls:'upcoming'};
}
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
