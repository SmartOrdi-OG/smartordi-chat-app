// Shared Anamnese schema, form markup, and serialize/deserialize helpers.
// Used by both the doctor's Kartei "Anamnese" tab and the patient's mandatory
// first-login Anamnese form, so a patient's submitted answers can be
// re-displayed to the doctor using the exact same field structure.
// Keeping the markup here (instead of duplicated per page) guarantees both
// pages render byte-identical fields, which collectAnamneseData/
// applyAnamneseData rely on to round-trip values correctly.
//
// IMPORTANT: every input/select/textarea below carries a stable data-key
// attribute (e.g. data-key="common.allergie.penizillin"). collectAnamneseData/
// applyAnamneseData read that attribute as the storage key -- NOT the visible
// label text. This is what lets patient.html show these fields translated
// (via data-i18n on the label/checkbox text, applied through the shared
// applyI18n() from vendor/i18n-patient.js) while doctor.html always renders
// the same markup untranslated (in German) and still finds the exact same
// keys in a submitted patient's data. Never derive a storage key from
// display text for this form -- that was the bug this data-key scheme fixes.
// Select <option> values are likewise always the literal German option text
// (hardcoded value="..."), independent of whatever data-i18n rewrites the
// option's visible textContent to.

const ANAMNESE_COMMON_HTML = `
  <div style="background:white;border-left:4px solid #0891b2;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,0.06);padding:14px;margin-bottom:12px;">
    <div style="font-size:12px;font-weight:700;color:#0891b2;margin-bottom:10px;" data-i18n="an.common.section.allergien">Allergien & Unverträglichkeiten</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;"><input type="checkbox" data-key="an.common.allergie.penizillin" style="accent-color:#dc2626;"><span data-i18n="an.common.allergie.penizillin">Penizillin</span></label>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;"><input type="checkbox" data-key="an.common.allergie.aspirin" style="accent-color:#dc2626;"><span data-i18n="an.common.allergie.aspirin">Aspirin/NSAR</span></label>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;"><input type="checkbox" data-key="an.common.allergie.latex" style="accent-color:#dc2626;"><span data-i18n="an.common.allergie.latex">Latex</span></label>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;"><input type="checkbox" data-key="an.common.allergie.kontrastmittel" style="accent-color:#dc2626;"><span data-i18n="an.common.allergie.kontrastmittel">Kontrastmittel</span></label>
    </div>
    <input class="k-form-input" data-key="an.common.allergie.weitere" placeholder="Weitere Allergien..." data-i18n-ph="an.common.allergie.weitere.ph" style="margin-top:4px;">
  </div>
  <div style="background:white;border-left:4px solid #0891b2;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,0.06);padding:14px;margin-bottom:12px;">
    <div style="font-size:12px;font-weight:700;color:#0891b2;margin-bottom:8px;" data-i18n="an.common.section.medikamente">Aktuelle Medikamente</div>
    <textarea class="k-form-input" data-key="an.common.medikamente" rows="2" placeholder="z.B. Metformin 500mg 2x täglich..." data-i18n-ph="an.common.medikamente.ph" style="resize:none;"></textarea>
  </div>
  <div style="background:white;border-left:4px solid #0891b2;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,0.06);padding:14px;margin-bottom:12px;">
    <div style="font-size:12px;font-weight:700;color:#0891b2;margin-bottom:8px;" data-i18n="an.common.section.operationen">Frühere Operationen</div>
    <textarea class="k-form-input" data-key="an.common.operationen" rows="2" placeholder="z.B. Appendektomie 2015..." data-i18n-ph="an.common.operationen.ph" style="resize:none;"></textarea>
  </div>
  <div style="background:white;border-left:4px solid #0891b2;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,0.06);padding:14px;margin-bottom:12px;">
    <div style="font-size:12px;font-weight:700;color:#0891b2;margin-bottom:8px;" data-i18n="an.common.section.familie">Familienanamnese</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;"><input type="checkbox" data-key="an.common.familie.diabetes" style="accent-color:#0891b2;"><span data-i18n="an.common.familie.diabetes">Diabetes</span></label>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;"><input type="checkbox" data-key="an.common.familie.herz" style="accent-color:#0891b2;"><span data-i18n="an.common.familie.herz">Herzerkrankung</span></label>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;"><input type="checkbox" data-key="an.common.familie.krebs" style="accent-color:#0891b2;"><span data-i18n="an.common.familie.krebs">Krebserkrankung</span></label>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;"><input type="checkbox" data-key="an.common.familie.schlaganfall" style="accent-color:#0891b2;"><span data-i18n="an.common.familie.schlaganfall">Schlaganfall</span></label>
    </div>
  </div>
  <div style="background:white;border-left:4px solid #0891b2;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,0.06);padding:14px;margin-bottom:12px;">
    <div style="font-size:12px;font-weight:700;color:#0891b2;margin-bottom:8px;" data-i18n="an.common.section.sozial">Sozialanamnese</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div><div class="k-form-label k-form-label-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/></svg><span data-i18n="an.common.raucherstatus">Raucherstatus</span></div><select class="k-form-input" data-key="an.common.raucherstatus"><option value="Nichtraucher" data-i18n="an.common.raucherstatus.nichtraucher">Nichtraucher</option><option value="Exraucher" data-i18n="an.common.raucherstatus.exraucher">Exraucher</option><option value="Raucher" data-i18n="an.common.raucherstatus.raucher">Raucher</option></select></div>
      <div><div class="k-form-label k-form-label-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg><span data-i18n="an.common.alkohol">Alkohol</span></div><select class="k-form-input" data-key="an.common.alkohol"><option value="Kein" data-i18n="an.common.alkohol.kein">Kein</option><option value="Gelegentlich" data-i18n="an.common.alkohol.gelegentlich">Gelegentlich</option><option value="Regelmäßig" data-i18n="an.common.alkohol.regelmaessig">Regelmäßig</option></select></div>
      <div><div class="k-form-label k-form-label-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg><span data-i18n="an.common.beruf">Beruf</span></div><input class="k-form-input" data-key="an.common.beruf" placeholder="z.B. Lehrer" data-i18n-ph="an.common.beruf.ph"></div>
      <div><div class="k-form-label k-form-label-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg><span data-i18n="an.common.sport">Sport</span></div><select class="k-form-input" data-key="an.common.sport"><option value="Kein" data-i18n="an.common.sport.kein">Kein</option><option value="Gelegentlich" data-i18n="an.common.sport.gelegentlich">Gelegentlich</option><option value="Regelmäßig" data-i18n="an.common.sport.regelmaessig">Regelmäßig</option></select></div>
    </div>
  </div>
`;

// Gesundheitsfragebogen -- 24 Ja/Nein-Screeningfragen (Medikamente, Vorerkrankungen,
// Schwangerschaft, Rauchen usw.), 1:1 übernommen aus dem BVAEB-Anamnesebogen, auf
// ausdrücklichen Wunsch aber NUR für Allgemeinmedizin + Kinderheilkunde eingebunden
// (siehe SPECIALTY_ANAMNESE unten) -- die 3 rein zahnmedizinischen Fragen des
// Originalbogens (Grund des Besuchs, letzte Kontrolle, Zahnfleischbluten) sind
// bewusst NICHT übernommen, da es hier kein Zahnmedizin-Fachrichtung gibt.
// Jede Frage ist ein <select> (Nein/Ja, gleiche Konvention wie z.B.
// an.card.schrittmacher weiter unten) statt einer Checkbox, weil eine unbeantwortete
// Checkbox nicht von einem echten "Nein" unterscheidbar wäre -- hier ist "Nein" die
// Voreinstellung wie im Papierbogen auch. anGfbSync()/anGfbSyncAll() (unten in dieser
// Datei) blenden das zugehörige "Wenn ja, ..."-Freitextfeld nur ein, wenn "Ja"
// gewählt ist -- inklusive beim Laden bereits gespeicherter Antworten (applyAnamneseData
// setzt nur .value, nicht die Sichtbarkeit -- siehe loadAnamneseForPatient()).
function anGfbRow(key, question, followupPlaceholderKey, followupPlaceholderText){
  const followup = followupPlaceholderKey ? `
      <input class="k-form-input gfb-wennja" data-key="${key}.detail" placeholder="${followupPlaceholderText}" data-i18n-ph="${followupPlaceholderKey}" style="display:none;margin-top:6px;">` : '';
  return `
    <div class="gfb-q" style="padding:7px 0;border-bottom:1px solid #f1f5f9;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
        <span style="font-size:12px;color:#334155;flex:1;" data-i18n="${key}">${question}</span>
        <select class="k-form-input" data-key="${key}" style="width:84px;flex-shrink:0;" onchange="anGfbSync(this)">
          <option value="Nein" data-i18n="an.gfb.nein">Nein</option>
          <option value="Ja" data-i18n="an.gfb.ja">Ja</option>
        </select>
      </div>${followup}
    </div>`;
}
const ANAMNESE_GESUNDHEITSFRAGEBOGEN_HTML = `
  <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:12px;">
    <div style="font-size:12px;font-weight:700;color:#4f46e5;margin-bottom:6px;" data-i18n="an.gfb.section.title">Gesundheitsfragebogen</div>
    ${anGfbRow('an.gfb.medikamente','Nehmen Sie Medikamente ein?','an.gfb.medikamente.detail.ph','Wenn ja, welche?')}
    ${anGfbRow('an.gfb.injektionen','Bekommen Sie regelmäßig Injektionen?','an.gfb.injektionen.detail.ph','Wenn ja, welche?')}
    ${anGfbRow('an.gfb.allergie','Leiden Sie an einer Allergie oder Medikamentenunverträglichkeit?','an.gfb.allergie.detail.ph','Wenn ja, an welcher?')}
    ${anGfbRow('an.gfb.infektion','Leiden oder litten Sie an einer Infektionskrankheit (z.B. Hepatitis, Tuberkulose, HIV/AIDS)?','an.gfb.infektion.detail.ph','Wenn ja, an welcher?')}
    ${anGfbRow('an.gfb.diabetes','Leiden oder litten Sie an Diabetes mellitus (Zuckerkrankheit)?')}
    ${anGfbRow('an.gfb.osteoporose','Leiden oder litten Sie an Osteoporose?')}
    ${anGfbRow('an.gfb.schwanger','Sind Sie oder könnten Sie schwanger sein?')}
    ${anGfbRow('an.gfb.stillen','Stillen Sie derzeit?')}
    ${anGfbRow('an.gfb.epilepsie','Leiden oder litten Sie an Epilepsie?')}
    ${anGfbRow('an.gfb.blutungsneigung','Haben Sie eine angeborene Blutungsneigung oder nehmen Sie blutverdünnende Medikamente ein?','an.gfb.blutungsneigung.detail.ph','Wenn ja, welche?')}
    ${anGfbRow('an.gfb.atemwege','Leiden oder litten Sie an einer Atemwegserkrankung (z.B. Asthma, COPD)?','an.gfb.atemwege.detail.ph','Wenn ja, an welcher?')}
    ${anGfbRow('an.gfb.rauchen','Rauchen Sie?','an.gfb.rauchen.detail.ph','Wenn ja, wieviel pro Tag?')}
    ${anGfbRow('an.gfb.herzkreislauf','Haben Sie eine Erkrankung des Herz-Kreislauf-Systems?','an.gfb.herzkreislauf.detail.ph','Wenn ja, welche?')}
    ${anGfbRow('an.gfb.schrittmacher','Tragen Sie einen Herzschrittmacher?')}
    ${anGfbRow('an.gfb.augen','Haben Sie eine Erkrankung der Augen (z.B. Glaukom)?','an.gfb.augen.detail.ph','Wenn ja, welche?')}
    ${anGfbRow('an.gfb.schilddruese','Haben Sie eine Erkrankung der Schilddrüse?','an.gfb.schilddruese.detail.ph','Wenn ja, welche?')}
    ${anGfbRow('an.gfb.nieren','Haben Sie eine Erkrankung der Nieren?','an.gfb.nieren.detail.ph','Wenn ja, welche?')}
    ${anGfbRow('an.gfb.verdauung','Haben Sie eine Erkrankung der Verdauungsorgane?','an.gfb.verdauung.detail.ph','Wenn ja, welche?')}
    ${anGfbRow('an.gfb.tumor','Haben oder hatten Sie eine Tumorerkrankung/Chemo- oder Strahlentherapie?','an.gfb.tumor.detail.ph','Wenn ja, wann?')}
    ${anGfbRow('an.gfb.operation','Hatten Sie kürzlich eine Operation?','an.gfb.operation.detail.ph','Wenn ja, welche?')}
    ${anGfbRow('an.gfb.autoimmun','Leiden Sie an einer Autoimmunerkrankung?','an.gfb.autoimmun.detail.ph','Wenn ja, an welcher?')}
    ${anGfbRow('an.gfb.immunschwaeche','Haben Sie eine Immunschwäche?')}
    ${anGfbRow('an.gfb.psychisch','Leiden Sie an einer Erkrankung des Nervensystems oder liegt eine psychische Erkrankung vor?','an.gfb.psychisch.detail.ph','Wenn ja, welche?')}
    ${anGfbRow('an.gfb.schlaganfall','Hatten Sie im vergangenen Jahr einen Schlaganfall?')}
  </div>
`;
// Reveals/hides one question's "Wenn ja, ..." field based on its own select's value --
// bound via onchange="anGfbSync(this)" on every <select> ANAMNESE_GESUNDHEITSFRAGEBOGEN_HTML
// renders. Scoped via .closest('.gfb-q') rather than a fixed DOM offset so row markup can
// change without this breaking.
function anGfbSync(selectEl){
  const q = selectEl.closest('.gfb-q');
  const field = q && q.querySelector('.gfb-wennja');
  if(field) field.style.display = selectEl.value === 'Ja' ? 'block' : 'none';
}
// Re-syncs every Gesundheitsfragebogen field's visibility against its current (just-loaded)
// value -- needed after applyAnamneseData() populates a returning patient's saved "Ja"
// answers, since that only sets .value, never the sibling field's display:none.
function anGfbSyncAll(root){
  if(!root) return;
  root.querySelectorAll('.gfb-q select').forEach(anGfbSync);
}

// Doctor-side "highlights" helper: returns only the Gesundheitsfragebogen
// rows currently answered "Ja" (with their "Wenn ja, ..." detail text, if
// filled in) -- used by kartei-anamnese.js for the Kartei's collapsed-bar
// highlights line and its "Nur Ja-Antworten anzeigen" filter, so a doctor
// can see what actually needs attention without reading all 24 rows every
// time. Kept here (not kartei-anamnese.js) since it's pure data extraction
// over this same shared markup, same role as collectAnamneseSummaryLines()
// plays for the PDF report -- but that one includes every non-empty field
// (every Gesundheitsfragebogen select always has a value, "Nein" included),
// so it can't answer "which ones are actually flagged" the way this does.
function collectGfbAuffaelligkeiten(root){
  if(!root) return [];
  const out=[];
  root.querySelectorAll('.gfb-q').forEach(q=>{
    const select=q.querySelector('select');
    if(!select||select.value!=='Ja') return;
    const label=q.querySelector('span[data-i18n]');
    const question=(label?label.textContent:'').trim();
    if(!question) return;
    const detailField=q.querySelector('.gfb-wennja');
    const detail=(detailField?detailField.value:'').trim();
    out.push(detail?question+' — '+detail:question);
  });
  return out;
}

const SPECIALTY_ANAMNESE = {
  'Kinderheilkunde': {
    label: 'Pädiatrie — Kinderheilkunde',
    titleKey: 'an.specialty.title.kinderheilkunde',
    html: `
      <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:12px;">
        <div style="font-size:12px;font-weight:700;color:#16a34a;margin-bottom:10px;" data-i18n="an.kind.section.geburt">Geburts- & Entwicklungsanamnese</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
          <div><div class="k-form-label k-form-label-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg><span data-i18n="an.kind.geburtsart">Geburtsart</span></div>
          <select class="k-form-input" data-key="an.kind.geburtsart"><option value="Spontangeburt" data-i18n="an.kind.geburtsart.spontan">Spontangeburt</option><option value="Kaiserschnitt" data-i18n="an.kind.geburtsart.kaiserschnitt">Kaiserschnitt</option><option value="Vakuum/Zange" data-i18n="an.kind.geburtsart.vakuum">Vakuum/Zange</option></select></div>
          <div><div class="k-form-label k-form-label-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg><span data-i18n="an.kind.geburtsgewicht">Geburtsgewicht</span></div><input class="k-form-input" data-key="an.kind.geburtsgewicht" placeholder="z.B. 3.200g" data-i18n-ph="an.kind.geburtsgewicht.ph"></div>
          <div><div class="k-form-label k-form-label-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><span data-i18n="an.kind.ssw">Schwangerschaftswoche</span></div><input class="k-form-input" data-key="an.kind.ssw" placeholder="z.B. 39. SSW" data-i18n-ph="an.kind.ssw.ph"></div>
          <div><div class="k-form-label k-form-label-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg><span data-i18n="an.kind.apgar">APGAR Score</span></div><input class="k-form-input" data-key="an.kind.apgar" placeholder="z.B. 9/10/10" data-i18n-ph="an.kind.apgar.ph"></div>
        </div>
        <div class="k-form-label k-form-label-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg><span data-i18n="an.kind.ernaehrung">Ernährung</span></div>
        <select class="k-form-input" data-key="an.kind.ernaehrung" style="margin-bottom:10px;"><option value="Gestillt" data-i18n="an.kind.ernaehrung.gestillt">Gestillt</option><option value="Flaschenmilch" data-i18n="an.kind.ernaehrung.flaschenmilch">Flaschenmilch</option><option value="Beides" data-i18n="an.kind.ernaehrung.beides">Beides</option><option value="Beikost" data-i18n="an.kind.ernaehrung.beikost">Beikost</option></select>
        <div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:6px;" data-i18n="an.kind.section.entwicklung">ENTWICKLUNG</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div><div class="k-form-label k-form-label-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg><span data-i18n="an.kind.erste_woerter">Erste Wörter</span></div><input class="k-form-input" data-key="an.kind.erste_woerter" placeholder="z.B. 12 Monate" data-i18n-ph="an.kind.erste_woerter.ph"></div>
          <div><div class="k-form-label k-form-label-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg><span data-i18n="an.kind.laufen">Laufen</span></div><input class="k-form-input" data-key="an.kind.laufen" placeholder="z.B. 14 Monate" data-i18n-ph="an.kind.laufen.ph"></div>
        </div>
      </div>
      <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:12px;">
        <div style="font-size:12px;font-weight:700;color:#16a34a;margin-bottom:8px;" data-i18n="an.kind.section.schule">Schule & Entwicklung</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;"><input type="checkbox" data-key="an.kind.lernprobleme" style="accent-color:#16a34a;"><span data-i18n="an.kind.lernprobleme">Lernprobleme</span></label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;"><input type="checkbox" data-key="an.kind.adhs" style="accent-color:#16a34a;"><span data-i18n="an.kind.adhs">ADHS Verdacht</span></label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;"><input type="checkbox" data-key="an.kind.sprachtherapie" style="accent-color:#16a34a;"><span data-i18n="an.kind.sprachtherapie">Sprachtherapie</span></label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;"><input type="checkbox" data-key="an.kind.ergotherapie" style="accent-color:#16a34a;"><span data-i18n="an.kind.ergotherapie">Ergotherapie</span></label>
        </div>
      </div>
      ${ANAMNESE_GESUNDHEITSFRAGEBOGEN_HTML}`
  },
  'Allgemeinmedizin': {
    label: 'Allgemeinmedizin',
    titleKey: 'an.specialty.title.allgemeinmedizin',
    html: ANAMNESE_GESUNDHEITSFRAGEBOGEN_HTML
  },
  'Gynäkologie': {
    label: 'Gynäkologie & Geburtshilfe',
    titleKey: 'an.specialty.title.gynaekologie',
    html: `
      <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:12px;">
        <div style="font-size:12px;font-weight:700;color:#ec4899;margin-bottom:10px;" data-i18n="an.gyn.section.gyn">Gynäkologische Anamnese</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
          <div><div class="k-form-label k-form-label-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><span data-i18n="an.gyn.menarche">Menarche (erstes Alter)</span></div><input class="k-form-input" data-key="an.gyn.menarche" placeholder="z.B. 13 Jahre" data-i18n-ph="an.gyn.menarche.ph"></div>
          <div><div class="k-form-label k-form-label-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><span data-i18n="an.gyn.zykluslaenge">Zykluslänge</span></div><input class="k-form-input" data-key="an.gyn.zykluslaenge" placeholder="z.B. 28 Tage" data-i18n-ph="an.gyn.zykluslaenge.ph"></div>
          <div><div class="k-form-label k-form-label-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><span data-i18n="an.gyn.letzte_periode">Letzte Periode</span></div><input class="k-form-input" data-key="an.gyn.letzte_periode" type="date"></div>
          <div><div class="k-form-label k-form-label-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg><span data-i18n="an.gyn.menopause">Menopause</span></div><select class="k-form-input" data-key="an.gyn.menopause"><option value="Nein" data-i18n="an.gyn.menopause.nein">Nein</option><option value="Ja" data-i18n="an.gyn.menopause.ja">Ja</option><option value="Perimenopause" data-i18n="an.gyn.menopause.peri">Perimenopause</option></select></div>
        </div>
        <div class="k-form-label k-form-label-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><span data-i18n="an.gyn.beschwerden">Beschwerden</span></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.gyn.dysmenorrhoe" style="accent-color:#ec4899;"><span data-i18n="an.gyn.dysmenorrhoe">Dysmenorrhö</span></label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.gyn.menorrhagie" style="accent-color:#ec4899;"><span data-i18n="an.gyn.menorrhagie">Menorrhagie</span></label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.gyn.zwischenblutungen" style="accent-color:#ec4899;"><span data-i18n="an.gyn.zwischenblutungen">Zwischenblutungen</span></label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.gyn.ausfluss" style="accent-color:#ec4899;"><span data-i18n="an.gyn.ausfluss">Ausfluss</span></label>
        </div>
      </div>
      <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:12px;">
        <div style="font-size:12px;font-weight:700;color:#ec4899;margin-bottom:8px;" data-i18n="an.gyn.section.geburtshilfe">Geburtshilfe</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div><div class="k-form-label k-form-label-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg><span data-i18n="an.gyn.gravida">Anzahl Schwangerschaften (G)</span></div><input class="k-form-input" data-key="an.gyn.gravida" type="number" min="0" placeholder="0"></div>
          <div><div class="k-form-label k-form-label-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg><span data-i18n="an.gyn.para">Anzahl Geburten (P)</span></div><input class="k-form-input" data-key="an.gyn.para" type="number" min="0" placeholder="0"></div>
          <div><div class="k-form-label k-form-label-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg><span data-i18n="an.gyn.fehlgeburten">Fehlgeburten</span></div><input class="k-form-input" data-key="an.gyn.fehlgeburten" type="number" min="0" placeholder="0"></div>
          <div><div class="k-form-label k-form-label-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg><span data-i18n="an.gyn.schwanger_aktuell">Schwanger aktuell</span></div><select class="k-form-input" data-key="an.gyn.schwanger_aktuell"><option value="Nein" data-i18n="an.gyn.schwanger_aktuell.nein">Nein</option><option value="Ja" data-i18n="an.gyn.schwanger_aktuell.ja">Ja</option><option value="Unbekannt" data-i18n="an.gyn.schwanger_aktuell.unbekannt">Unbekannt</option></select></div>
        </div>
      </div>`
  },
  'Kardiologie': {
    label: 'Kardiologie — Herzanamnese',
    titleKey: 'an.specialty.title.kardiologie',
    html: `
      <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:12px;">
        <div style="font-size:12px;font-weight:700;color:#dc2626;margin-bottom:10px;" data-i18n="an.card.section.beschwerden">❤ Kardiale Beschwerden</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.card.brustschmerz" style="accent-color:#dc2626;"><span data-i18n="an.card.brustschmerz">Brustschmerz</span></label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.card.dyspnoe_ruhe" style="accent-color:#dc2626;"><span data-i18n="an.card.dyspnoe_ruhe">Dyspnoe (Ruhe)</span></label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.card.dyspnoe_belastung" style="accent-color:#dc2626;"><span data-i18n="an.card.dyspnoe_belastung">Dyspnoe (Belastung)</span></label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.card.palpitationen" style="accent-color:#dc2626;"><span data-i18n="an.card.palpitationen">Palpitationen</span></label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.card.synkope" style="accent-color:#dc2626;"><span data-i18n="an.card.synkope">Synkope</span></label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.card.oedeme" style="accent-color:#dc2626;"><span data-i18n="an.card.oedeme">Ödeme (Beine)</span></label>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div><div class="k-form-label k-form-label-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg><span data-i18n="an.card.rr_systolisch">Blutdruck (systolisch)</span></div><input class="k-form-input" data-key="an.card.rr_systolisch" placeholder="z.B. 130 mmHg" data-i18n-ph="an.card.rr_systolisch.ph"></div>
          <div><div class="k-form-label k-form-label-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg><span data-i18n="an.card.herzfrequenz">Herzfrequenz</span></div><input class="k-form-input" data-key="an.card.herzfrequenz" placeholder="z.B. 72/min" data-i18n-ph="an.card.herzfrequenz.ph"></div>
          <div><div class="k-form-label k-form-label-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg><span data-i18n="an.card.herzerkrankung_bekannt">Bekannte Herzerkrankung</span></div><input class="k-form-input" data-key="an.card.herzerkrankung_bekannt" placeholder="z.B. KHK, VHF..." data-i18n-ph="an.card.herzerkrankung_bekannt.ph"></div>
          <div><div class="k-form-label k-form-label-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg><span data-i18n="an.card.schrittmacher">Herzschrittmacher</span></div><select class="k-form-input" data-key="an.card.schrittmacher"><option value="Nein" data-i18n="an.card.schrittmacher.nein">Nein</option><option value="Ja" data-i18n="an.card.schrittmacher.ja">Ja</option></select></div>
        </div>
      </div>`
  },
  'Neurologie': {
    label: 'Neurologie — Nervenanamnese',
    titleKey: 'an.specialty.title.neurologie',
    html: `
      <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:12px;">
        <div style="font-size:12px;font-weight:700;color:#7c3aed;margin-bottom:10px;" data-i18n="an.neuro.section.beschwerden">Neurologische Beschwerden</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.neuro.kopfschmerzen" style="accent-color:#7c3aed;"><span data-i18n="an.neuro.kopfschmerzen">Kopfschmerzen</span></label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.neuro.migraene" style="accent-color:#7c3aed;"><span data-i18n="an.neuro.migraene">Migräne</span></label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.neuro.schwindel" style="accent-color:#7c3aed;"><span data-i18n="an.neuro.schwindel">Schwindel</span></label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.neuro.taubheit" style="accent-color:#7c3aed;"><span data-i18n="an.neuro.taubheit">Taubheitsgefühl</span></label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.neuro.krampfanfaelle" style="accent-color:#7c3aed;"><span data-i18n="an.neuro.krampfanfaelle">Krampfanfälle</span></label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.neuro.gedaechtnis" style="accent-color:#7c3aed;"><span data-i18n="an.neuro.gedaechtnis">Gedächtnisprobleme</span></label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.neuro.tremor" style="accent-color:#7c3aed;"><span data-i18n="an.neuro.tremor">Tremor</span></label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.neuro.sehstoerungen" style="accent-color:#7c3aed;"><span data-i18n="an.neuro.sehstoerungen">Sehstörungen</span></label>
        </div>
        <div class="k-form-label k-form-label-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg><span data-i18n="an.neuro.erkrankung">Bekannte neurologische Erkrankung</span></div>
        <input class="k-form-input" data-key="an.neuro.erkrankung" placeholder="z.B. Epilepsie, MS, Parkinson..." data-i18n-ph="an.neuro.erkrankung.ph">
      </div>`
  },
  'Innere Medizin': {
    label: 'Innere Medizin — Allgemeinanamnese',
    titleKey: 'an.specialty.title.innere',
    html: `
      <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:12px;">
        <div style="font-size:12px;font-weight:700;color:#0891b2;margin-bottom:10px;" data-i18n="an.innere.section.gi">Gastrointestinal & Allgemein</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.innere.appetitlosigkeit" style="accent-color:#0891b2;"><span data-i18n="an.innere.appetitlosigkeit">Appetitlosigkeit</span></label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.innere.gewichtsverlust" style="accent-color:#0891b2;"><span data-i18n="an.innere.gewichtsverlust">Gewichtsverlust</span></label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.innere.uebelkeit_erbrechen" style="accent-color:#0891b2;"><span data-i18n="an.innere.uebelkeit_erbrechen">Übelkeit/Erbrechen</span></label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.innere.dysphagie" style="accent-color:#0891b2;"><span data-i18n="an.innere.dysphagie">Dysphagie</span></label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.innere.sodbrennen" style="accent-color:#0891b2;"><span data-i18n="an.innere.sodbrennen">Sodbrennen</span></label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.innere.diarrhoe" style="accent-color:#0891b2;"><span data-i18n="an.innere.diarrhoe">Diarrhö</span></label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.innere.obstipation" style="accent-color:#0891b2;"><span data-i18n="an.innere.obstipation">Obstipation</span></label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.innere.blut_stuhl" style="accent-color:#0891b2;"><span data-i18n="an.innere.blut_stuhl">Blut im Stuhl</span></label>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div><div class="k-form-label k-form-label-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg><span data-i18n="an.innere.bmi_gewicht">BMI / Gewicht</span></div><input class="k-form-input" data-key="an.innere.bmi_gewicht" placeholder="z.B. 75kg / BMI 24" data-i18n-ph="an.innere.bmi_gewicht.ph"></div>
          <div><div class="k-form-label k-form-label-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg><span data-i18n="an.innere.blutzucker">Nüchternblutzucker</span></div><input class="k-form-input" data-key="an.innere.blutzucker" placeholder="z.B. 95 mg/dl" data-i18n-ph="an.innere.blutzucker.ph"></div>
        </div>
      </div>`
  },
  'Orthopädie': {
    label: 'Orthopädie & Traumatologie',
    titleKey: 'an.specialty.title.orthopaedie',
    html: `
      <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:12px;">
        <div style="font-size:12px;font-weight:700;color:#f59e0b;margin-bottom:10px;" data-i18n="an.ortho.section.anamnese">Orthopädische Anamnese</div>
        <div class="k-form-label k-form-label-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg><span data-i18n="an.ortho.region">Betroffene Region</span></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.ortho.wirbelsaeule" style="accent-color:#f59e0b;"><span data-i18n="an.ortho.wirbelsaeule">Wirbelsäule</span></label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.ortho.schulter" style="accent-color:#f59e0b;"><span data-i18n="an.ortho.schulter">Schulter</span></label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.ortho.knie" style="accent-color:#f59e0b;"><span data-i18n="an.ortho.knie">Knie</span></label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.ortho.huefte" style="accent-color:#f59e0b;"><span data-i18n="an.ortho.huefte">Hüfte</span></label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.ortho.fuss" style="accent-color:#f59e0b;"><span data-i18n="an.ortho.fuss">Fuß/Sprunggelenk</span></label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.ortho.hand" style="accent-color:#f59e0b;"><span data-i18n="an.ortho.hand">Hand/Ellenbogen</span></label>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div><div class="k-form-label k-form-label-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg><span data-i18n="an.ortho.schmerzcharakter">Schmerzcharakter</span></div>
          <select class="k-form-input" data-key="an.ortho.schmerzcharakter"><option value="Dauerschmerz" data-i18n="an.ortho.schmerzcharakter.dauerschmerz">Dauerschmerz</option><option value="Belastungsschmerz" data-i18n="an.ortho.schmerzcharakter.belastungsschmerz">Belastungsschmerz</option><option value="Nachtschmerz" data-i18n="an.ortho.schmerzcharakter.nachtschmerz">Nachtschmerz</option><option value="Bewegungsschmerz" data-i18n="an.ortho.schmerzcharakter.bewegungsschmerz">Bewegungsschmerz</option></select></div>
          <div><div class="k-form-label k-form-label-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><span data-i18n="an.ortho.seit_wann">Seit wann?</span></div><input class="k-form-input" data-key="an.ortho.seit_wann" placeholder="z.B. 3 Monate" data-i18n-ph="an.ortho.seit_wann.ph"></div>
        </div>
        <div style="margin-top:10px;">
          <div class="k-form-label k-form-label-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg><span data-i18n="an.ortho.trauma">Trauma / Unfall</span></div>
          <textarea class="k-form-input" data-key="an.ortho.trauma" rows="2" placeholder="z.B. Sturz 2023, Arbeitsunfall..." data-i18n-ph="an.ortho.trauma.ph" style="resize:none;"></textarea>
        </div>
        <div style="margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.ortho.physio_laufend" style="accent-color:#f59e0b;"><span data-i18n="an.ortho.physio_laufend">Physiotherapie laufend</span></label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.ortho.hilfsmittel" style="accent-color:#f59e0b;"><span data-i18n="an.ortho.hilfsmittel">Hilfsmittel (Schiene etc.)</span></label>
        </div>
      </div>`
  }
};

function anamneseSpecialtyInfo(fach){
  const spec = SPECIALTY_ANAMNESE[fach];
  return spec ? { label: spec.label, titleKey: spec.titleKey, html: spec.html } : { label: 'Allgemeinanamnese', titleKey: 'an.specialty.title.allgemein', html: '' };
}

// Derives the storage key for a form field. Always prefers the stable
// data-key attribute baked into the shared markup above; the text-derivation
// fallback only exists for defensive safety (e.g. a stray field somewhere
// that predates this scheme) and should never be hit for anything rendered
// from ANAMNESE_COMMON_HTML/SPECIALTY_ANAMNESE.
function anamneseFieldKey(el){
  if(el.dataset && el.dataset.key) return el.dataset.key;
  const parentLabel = el.closest('label');
  if(parentLabel) return 'cb:'+parentLabel.textContent.trim().toLowerCase();
  let sib = el.previousElementSibling;
  while(sib && !sib.classList.contains('k-form-label')) sib = sib.previousElementSibling;
  if(sib) return 'f:'+sib.textContent.trim().toLowerCase();
  if(el.placeholder) return 'p:'+el.placeholder.trim().toLowerCase();
  return 't:'+(el.tagName+(el.type||'')).toLowerCase();
}

function collectAnamneseData(root){
  const data = {};
  const counts = {};
  root.querySelectorAll('input,select,textarea').forEach(el=>{
    let key = anamneseFieldKey(el);
    counts[key] = (counts[key]||0)+1;
    if(counts[key] > 1) key = key+'#'+counts[key];
    data[key] = el.type==='checkbox' ? el.checked : el.value;
  });
  return data;
}

function applyAnamneseData(root, data){
  if(!data) return;
  const counts = {};
  root.querySelectorAll('input,select,textarea').forEach(el=>{
    let key = anamneseFieldKey(el);
    counts[key] = (counts[key]||0)+1;
    if(counts[key] > 1) key = key+'#'+counts[key];
    if(!(key in data)) return;
    if(el.type==='checkbox') el.checked = !!data[key];
    else el.value = data[key];
  });
}
