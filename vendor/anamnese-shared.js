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
      <div><div class="k-form-label" data-i18n="an.common.raucherstatus">Raucherstatus</div><select class="k-form-input" data-key="an.common.raucherstatus"><option value="Nichtraucher" data-i18n="an.common.raucherstatus.nichtraucher">Nichtraucher</option><option value="Exraucher" data-i18n="an.common.raucherstatus.exraucher">Exraucher</option><option value="Raucher" data-i18n="an.common.raucherstatus.raucher">Raucher</option></select></div>
      <div><div class="k-form-label" data-i18n="an.common.alkohol">Alkohol</div><select class="k-form-input" data-key="an.common.alkohol"><option value="Kein" data-i18n="an.common.alkohol.kein">Kein</option><option value="Gelegentlich" data-i18n="an.common.alkohol.gelegentlich">Gelegentlich</option><option value="Regelmäßig" data-i18n="an.common.alkohol.regelmaessig">Regelmäßig</option></select></div>
      <div><div class="k-form-label" data-i18n="an.common.beruf">Beruf</div><input class="k-form-input" data-key="an.common.beruf" placeholder="z.B. Lehrer" data-i18n-ph="an.common.beruf.ph"></div>
      <div><div class="k-form-label" data-i18n="an.common.sport">Sport</div><select class="k-form-input" data-key="an.common.sport"><option value="Kein" data-i18n="an.common.sport.kein">Kein</option><option value="Gelegentlich" data-i18n="an.common.sport.gelegentlich">Gelegentlich</option><option value="Regelmäßig" data-i18n="an.common.sport.regelmaessig">Regelmäßig</option></select></div>
    </div>
  </div>
`;

const SPECIALTY_ANAMNESE = {
  'Kinderheilkunde': {
    label: 'Pädiatrie — Kinderheilkunde',
    titleKey: 'an.specialty.title.kinderheilkunde',
    html: `
      <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:12px;">
        <div style="font-size:12px;font-weight:700;color:#16a34a;margin-bottom:10px;" data-i18n="an.kind.section.geburt">Geburts- & Entwicklungsanamnese</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
          <div><div class="k-form-label" data-i18n="an.kind.geburtsart">Geburtsart</div>
          <select class="k-form-input" data-key="an.kind.geburtsart"><option value="Spontangeburt" data-i18n="an.kind.geburtsart.spontan">Spontangeburt</option><option value="Kaiserschnitt" data-i18n="an.kind.geburtsart.kaiserschnitt">Kaiserschnitt</option><option value="Vakuum/Zange" data-i18n="an.kind.geburtsart.vakuum">Vakuum/Zange</option></select></div>
          <div><div class="k-form-label" data-i18n="an.kind.geburtsgewicht">Geburtsgewicht</div><input class="k-form-input" data-key="an.kind.geburtsgewicht" placeholder="z.B. 3.200g" data-i18n-ph="an.kind.geburtsgewicht.ph"></div>
          <div><div class="k-form-label" data-i18n="an.kind.ssw">Schwangerschaftswoche</div><input class="k-form-input" data-key="an.kind.ssw" placeholder="z.B. 39. SSW" data-i18n-ph="an.kind.ssw.ph"></div>
          <div><div class="k-form-label" data-i18n="an.kind.apgar">APGAR Score</div><input class="k-form-input" data-key="an.kind.apgar" placeholder="z.B. 9/10/10" data-i18n-ph="an.kind.apgar.ph"></div>
        </div>
        <div class="k-form-label" data-i18n="an.kind.ernaehrung">Ernährung</div>
        <select class="k-form-input" data-key="an.kind.ernaehrung" style="margin-bottom:10px;"><option value="Gestillt" data-i18n="an.kind.ernaehrung.gestillt">Gestillt</option><option value="Flaschenmilch" data-i18n="an.kind.ernaehrung.flaschenmilch">Flaschenmilch</option><option value="Beides" data-i18n="an.kind.ernaehrung.beides">Beides</option><option value="Beikost" data-i18n="an.kind.ernaehrung.beikost">Beikost</option></select>
        <div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:6px;" data-i18n="an.kind.section.entwicklung">ENTWICKLUNG</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div><div class="k-form-label" data-i18n="an.kind.erste_woerter">Erste Wörter</div><input class="k-form-input" data-key="an.kind.erste_woerter" placeholder="z.B. 12 Monate" data-i18n-ph="an.kind.erste_woerter.ph"></div>
          <div><div class="k-form-label" data-i18n="an.kind.laufen">Laufen</div><input class="k-form-input" data-key="an.kind.laufen" placeholder="z.B. 14 Monate" data-i18n-ph="an.kind.laufen.ph"></div>
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
      </div>`
  },
  'Gynäkologie': {
    label: 'Gynäkologie & Geburtshilfe',
    titleKey: 'an.specialty.title.gynaekologie',
    html: `
      <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:12px;">
        <div style="font-size:12px;font-weight:700;color:#ec4899;margin-bottom:10px;" data-i18n="an.gyn.section.gyn">Gynäkologische Anamnese</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
          <div><div class="k-form-label" data-i18n="an.gyn.menarche">Menarche (erstes Alter)</div><input class="k-form-input" data-key="an.gyn.menarche" placeholder="z.B. 13 Jahre" data-i18n-ph="an.gyn.menarche.ph"></div>
          <div><div class="k-form-label" data-i18n="an.gyn.zykluslaenge">Zykluslänge</div><input class="k-form-input" data-key="an.gyn.zykluslaenge" placeholder="z.B. 28 Tage" data-i18n-ph="an.gyn.zykluslaenge.ph"></div>
          <div><div class="k-form-label" data-i18n="an.gyn.letzte_periode">Letzte Periode</div><input class="k-form-input" data-key="an.gyn.letzte_periode" type="date"></div>
          <div><div class="k-form-label" data-i18n="an.gyn.menopause">Menopause</div><select class="k-form-input" data-key="an.gyn.menopause"><option value="Nein" data-i18n="an.gyn.menopause.nein">Nein</option><option value="Ja" data-i18n="an.gyn.menopause.ja">Ja</option><option value="Perimenopause" data-i18n="an.gyn.menopause.peri">Perimenopause</option></select></div>
        </div>
        <div class="k-form-label" data-i18n="an.gyn.beschwerden">Beschwerden</div>
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
          <div><div class="k-form-label" data-i18n="an.gyn.gravida">Anzahl Schwangerschaften (G)</div><input class="k-form-input" data-key="an.gyn.gravida" type="number" min="0" placeholder="0"></div>
          <div><div class="k-form-label" data-i18n="an.gyn.para">Anzahl Geburten (P)</div><input class="k-form-input" data-key="an.gyn.para" type="number" min="0" placeholder="0"></div>
          <div><div class="k-form-label" data-i18n="an.gyn.fehlgeburten">Fehlgeburten</div><input class="k-form-input" data-key="an.gyn.fehlgeburten" type="number" min="0" placeholder="0"></div>
          <div><div class="k-form-label" data-i18n="an.gyn.schwanger_aktuell">Schwanger aktuell</div><select class="k-form-input" data-key="an.gyn.schwanger_aktuell"><option value="Nein" data-i18n="an.gyn.schwanger_aktuell.nein">Nein</option><option value="Ja" data-i18n="an.gyn.schwanger_aktuell.ja">Ja</option><option value="Unbekannt" data-i18n="an.gyn.schwanger_aktuell.unbekannt">Unbekannt</option></select></div>
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
          <div><div class="k-form-label" data-i18n="an.card.rr_systolisch">Blutdruck (systolisch)</div><input class="k-form-input" data-key="an.card.rr_systolisch" placeholder="z.B. 130 mmHg" data-i18n-ph="an.card.rr_systolisch.ph"></div>
          <div><div class="k-form-label" data-i18n="an.card.herzfrequenz">Herzfrequenz</div><input class="k-form-input" data-key="an.card.herzfrequenz" placeholder="z.B. 72/min" data-i18n-ph="an.card.herzfrequenz.ph"></div>
          <div><div class="k-form-label" data-i18n="an.card.herzerkrankung_bekannt">Bekannte Herzerkrankung</div><input class="k-form-input" data-key="an.card.herzerkrankung_bekannt" placeholder="z.B. KHK, VHF..." data-i18n-ph="an.card.herzerkrankung_bekannt.ph"></div>
          <div><div class="k-form-label" data-i18n="an.card.schrittmacher">Herzschrittmacher</div><select class="k-form-input" data-key="an.card.schrittmacher"><option value="Nein" data-i18n="an.card.schrittmacher.nein">Nein</option><option value="Ja" data-i18n="an.card.schrittmacher.ja">Ja</option></select></div>
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
        <div class="k-form-label" data-i18n="an.neuro.erkrankung">Bekannte neurologische Erkrankung</div>
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
          <div><div class="k-form-label" data-i18n="an.innere.bmi_gewicht">BMI / Gewicht</div><input class="k-form-input" data-key="an.innere.bmi_gewicht" placeholder="z.B. 75kg / BMI 24" data-i18n-ph="an.innere.bmi_gewicht.ph"></div>
          <div><div class="k-form-label" data-i18n="an.innere.blutzucker">Nüchternblutzucker</div><input class="k-form-input" data-key="an.innere.blutzucker" placeholder="z.B. 95 mg/dl" data-i18n-ph="an.innere.blutzucker.ph"></div>
        </div>
      </div>`
  },
  'Orthopädie': {
    label: 'Orthopädie & Traumatologie',
    titleKey: 'an.specialty.title.orthopaedie',
    html: `
      <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:12px;">
        <div style="font-size:12px;font-weight:700;color:#f59e0b;margin-bottom:10px;" data-i18n="an.ortho.section.anamnese">Orthopädische Anamnese</div>
        <div class="k-form-label" data-i18n="an.ortho.region">Betroffene Region</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.ortho.wirbelsaeule" style="accent-color:#f59e0b;"><span data-i18n="an.ortho.wirbelsaeule">Wirbelsäule</span></label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.ortho.schulter" style="accent-color:#f59e0b;"><span data-i18n="an.ortho.schulter">Schulter</span></label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.ortho.knie" style="accent-color:#f59e0b;"><span data-i18n="an.ortho.knie">Knie</span></label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.ortho.huefte" style="accent-color:#f59e0b;"><span data-i18n="an.ortho.huefte">Hüfte</span></label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.ortho.fuss" style="accent-color:#f59e0b;"><span data-i18n="an.ortho.fuss">Fuß/Sprunggelenk</span></label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-key="an.ortho.hand" style="accent-color:#f59e0b;"><span data-i18n="an.ortho.hand">Hand/Ellenbogen</span></label>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div><div class="k-form-label" data-i18n="an.ortho.schmerzcharakter">Schmerzcharakter</div>
          <select class="k-form-input" data-key="an.ortho.schmerzcharakter"><option value="Dauerschmerz" data-i18n="an.ortho.schmerzcharakter.dauerschmerz">Dauerschmerz</option><option value="Belastungsschmerz" data-i18n="an.ortho.schmerzcharakter.belastungsschmerz">Belastungsschmerz</option><option value="Nachtschmerz" data-i18n="an.ortho.schmerzcharakter.nachtschmerz">Nachtschmerz</option><option value="Bewegungsschmerz" data-i18n="an.ortho.schmerzcharakter.bewegungsschmerz">Bewegungsschmerz</option></select></div>
          <div><div class="k-form-label" data-i18n="an.ortho.seit_wann">Seit wann?</div><input class="k-form-input" data-key="an.ortho.seit_wann" placeholder="z.B. 3 Monate" data-i18n-ph="an.ortho.seit_wann.ph"></div>
        </div>
        <div style="margin-top:10px;">
          <div class="k-form-label" data-i18n="an.ortho.trauma">Trauma / Unfall</div>
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
