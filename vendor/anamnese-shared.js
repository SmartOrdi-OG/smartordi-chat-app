// Shared Anamnese schema, form markup, and serialize/deserialize helpers.
// Used by both the doctor's Kartei "Anamnese" tab and the patient's mandatory
// first-login Anamnese form, so a patient's submitted answers can be
// re-displayed to the doctor using the exact same field structure.
// Keeping the markup here (instead of duplicated per page) guarantees both
// pages render byte-identical fields, which collectAnamneseData/
// applyAnamneseData rely on to round-trip values correctly.

const ANAMNESE_COMMON_HTML = `
  <div style="background:white;border-left:4px solid #0891b2;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,0.06);padding:14px;margin-bottom:12px;">
    <div style="font-size:12px;font-weight:700;color:#0891b2;margin-bottom:10px;">Allergien & Unverträglichkeiten</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;"><input type="checkbox" style="accent-color:#dc2626;">Penizillin</label>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;"><input type="checkbox" style="accent-color:#dc2626;">Aspirin/NSAR</label>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;"><input type="checkbox" style="accent-color:#dc2626;">Latex</label>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;"><input type="checkbox" style="accent-color:#dc2626;">Kontrastmittel</label>
    </div>
    <input class="k-form-input" placeholder="Weitere Allergien..." style="margin-top:4px;">
  </div>
  <div style="background:white;border-left:4px solid #0891b2;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,0.06);padding:14px;margin-bottom:12px;">
    <div style="font-size:12px;font-weight:700;color:#0891b2;margin-bottom:8px;">Aktuelle Medikamente</div>
    <textarea class="k-form-input" rows="2" placeholder="z.B. Metformin 500mg 2x täglich..." style="resize:none;"></textarea>
  </div>
  <div style="background:white;border-left:4px solid #0891b2;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,0.06);padding:14px;margin-bottom:12px;">
    <div style="font-size:12px;font-weight:700;color:#0891b2;margin-bottom:8px;">Frühere Operationen</div>
    <textarea class="k-form-input" rows="2" placeholder="z.B. Appendektomie 2015..." style="resize:none;"></textarea>
  </div>
  <div style="background:white;border-left:4px solid #0891b2;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,0.06);padding:14px;margin-bottom:12px;">
    <div style="font-size:12px;font-weight:700;color:#0891b2;margin-bottom:8px;">Familienanamnese</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;"><input type="checkbox" style="accent-color:#0891b2;">Diabetes</label>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;"><input type="checkbox" style="accent-color:#0891b2;">Herzerkrankung</label>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;"><input type="checkbox" style="accent-color:#0891b2;">Krebserkrankung</label>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;"><input type="checkbox" style="accent-color:#0891b2;">Schlaganfall</label>
    </div>
  </div>
  <div style="background:white;border-left:4px solid #0891b2;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,0.06);padding:14px;margin-bottom:12px;">
    <div style="font-size:12px;font-weight:700;color:#0891b2;margin-bottom:8px;">Sozialanamnese</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div><div class="k-form-label">Raucherstatus</div><select class="k-form-input"><option>Nichtraucher</option><option>Exraucher</option><option>Raucher</option></select></div>
      <div><div class="k-form-label">Alkohol</div><select class="k-form-input"><option>Kein</option><option>Gelegentlich</option><option>Regelmäßig</option></select></div>
      <div><div class="k-form-label">Beruf</div><input class="k-form-input" placeholder="z.B. Lehrer"></div>
      <div><div class="k-form-label">Sport</div><select class="k-form-input"><option>Kein</option><option>Gelegentlich</option><option>Regelmäßig</option></select></div>
    </div>
  </div>
`;

const SPECIALTY_ANAMNESE = {
  'Kinderheilkunde': {
    label: 'Pädiatrie — Kinderheilkunde',
    html: `
      <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:12px;">
        <div style="font-size:12px;font-weight:700;color:#16a34a;margin-bottom:10px;">Geburts- & Entwicklungsanamnese</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
          <div><div class="k-form-label">Geburtsart</div>
          <select class="k-form-input"><option>Spontangeburt</option><option>Kaiserschnitt</option><option>Vakuum/Zange</option></select></div>
          <div><div class="k-form-label">Geburtsgewicht</div><input class="k-form-input" placeholder="z.B. 3.200g"></div>
          <div><div class="k-form-label">Schwangerschaftswoche</div><input class="k-form-input" placeholder="z.B. 39. SSW"></div>
          <div><div class="k-form-label">APGAR Score</div><input class="k-form-input" placeholder="z.B. 9/10/10"></div>
        </div>
        <div class="k-form-label">Ernährung</div>
        <select class="k-form-input" style="margin-bottom:10px;"><option>Gestillt</option><option>Flaschenmilch</option><option>Beides</option><option>Beikost</option></select>
        <div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:6px;">ENTWICKLUNG</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div><div class="k-form-label">Erste Wörter</div><input class="k-form-input" placeholder="z.B. 12 Monate"></div>
          <div><div class="k-form-label">Laufen</div><input class="k-form-input" placeholder="z.B. 14 Monate"></div>
        </div>
      </div>
      <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:12px;">
        <div style="font-size:12px;font-weight:700;color:#16a34a;margin-bottom:8px;">Schule & Entwicklung</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;"><input type="checkbox" style="accent-color:#16a34a;">Lernprobleme</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;"><input type="checkbox" style="accent-color:#16a34a;">ADHS Verdacht</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;"><input type="checkbox" style="accent-color:#16a34a;">Sprachtherapie</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;"><input type="checkbox" style="accent-color:#16a34a;">Ergotherapie</label>
        </div>
      </div>`
  },
  'Gynäkologie': {
    label: 'Gynäkologie & Geburtshilfe',
    html: `
      <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:12px;">
        <div style="font-size:12px;font-weight:700;color:#ec4899;margin-bottom:10px;">Gynäkologische Anamnese</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
          <div><div class="k-form-label">Menarche (erstes Alter)</div><input class="k-form-input" placeholder="z.B. 13 Jahre"></div>
          <div><div class="k-form-label">Zykluslänge</div><input class="k-form-input" placeholder="z.B. 28 Tage"></div>
          <div><div class="k-form-label">Letzte Periode</div><input class="k-form-input" type="date"></div>
          <div><div class="k-form-label">Menopause</div><select class="k-form-input"><option>Nein</option><option>Ja</option><option>Perimenopause</option></select></div>
        </div>
        <div class="k-form-label">Beschwerden</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" style="accent-color:#ec4899;">Dysmenorrhö</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" style="accent-color:#ec4899;">Menorrhagie</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" style="accent-color:#ec4899;">Zwischenblutungen</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" style="accent-color:#ec4899;">Ausfluss</label>
        </div>
      </div>
      <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:12px;">
        <div style="font-size:12px;font-weight:700;color:#ec4899;margin-bottom:8px;">Geburtshilfe</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div><div class="k-form-label">Anzahl Schwangerschaften (G)</div><input class="k-form-input" type="number" min="0" placeholder="0"></div>
          <div><div class="k-form-label">Anzahl Geburten (P)</div><input class="k-form-input" type="number" min="0" placeholder="0"></div>
          <div><div class="k-form-label">Fehlgeburten</div><input class="k-form-input" type="number" min="0" placeholder="0"></div>
          <div><div class="k-form-label">Schwanger aktuell</div><select class="k-form-input"><option>Nein</option><option>Ja</option><option>Unbekannt</option></select></div>
        </div>
      </div>`
  },
  'Kardiologie': {
    label: 'Kardiologie — Herzanamnese',
    html: `
      <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:12px;">
        <div style="font-size:12px;font-weight:700;color:#dc2626;margin-bottom:10px;">❤ Kardiale Beschwerden</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" style="accent-color:#dc2626;">Brustschmerz</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" style="accent-color:#dc2626;">Dyspnoe (Ruhe)</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" style="accent-color:#dc2626;">Dyspnoe (Belastung)</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" style="accent-color:#dc2626;">Palpitationen</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" style="accent-color:#dc2626;">Synkope</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" style="accent-color:#dc2626;">Ödeme (Beine)</label>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div><div class="k-form-label">Blutdruck (systolisch)</div><input class="k-form-input" placeholder="z.B. 130 mmHg"></div>
          <div><div class="k-form-label">Herzfrequenz</div><input class="k-form-input" placeholder="z.B. 72/min"></div>
          <div><div class="k-form-label">Bekannte Herzerkrankung</div><input class="k-form-input" placeholder="z.B. KHK, VHF..."></div>
          <div><div class="k-form-label">Herzschrittmacher</div><select class="k-form-input"><option>Nein</option><option>Ja</option></select></div>
        </div>
      </div>`
  },
  'Neurologie': {
    label: 'Neurologie — Nervenanamnese',
    html: `
      <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:12px;">
        <div style="font-size:12px;font-weight:700;color:#7c3aed;margin-bottom:10px;">Neurologische Beschwerden</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" style="accent-color:#7c3aed;">Kopfschmerzen</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" style="accent-color:#7c3aed;">Migräne</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" style="accent-color:#7c3aed;">Schwindel</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" style="accent-color:#7c3aed;">Taubheitsgefühl</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" style="accent-color:#7c3aed;">Krampfanfälle</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" style="accent-color:#7c3aed;">Gedächtnisprobleme</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" style="accent-color:#7c3aed;">Tremor</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" style="accent-color:#7c3aed;">Sehstörungen</label>
        </div>
        <div class="k-form-label">Bekannte neurologische Erkrankung</div>
        <input class="k-form-input" placeholder="z.B. Epilepsie, MS, Parkinson...">
      </div>`
  },
  'Innere Medizin': {
    label: 'Innere Medizin — Allgemeinanamnese',
    html: `
      <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:12px;">
        <div style="font-size:12px;font-weight:700;color:#0891b2;margin-bottom:10px;">Gastrointestinal & Allgemein</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" style="accent-color:#0891b2;">Appetitlosigkeit</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" style="accent-color:#0891b2;">Gewichtsverlust</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" style="accent-color:#0891b2;">Übelkeit/Erbrechen</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" style="accent-color:#0891b2;">Dysphagie</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" style="accent-color:#0891b2;">Sodbrennen</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" style="accent-color:#0891b2;">Diarrhö</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" style="accent-color:#0891b2;">Obstipation</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" style="accent-color:#0891b2;">Blut im Stuhl</label>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div><div class="k-form-label">BMI / Gewicht</div><input class="k-form-input" placeholder="z.B. 75kg / BMI 24"></div>
          <div><div class="k-form-label">Nüchternblutzucker</div><input class="k-form-input" placeholder="z.B. 95 mg/dl"></div>
        </div>
      </div>`
  },
  'Orthopädie': {
    label: 'Orthopädie & Traumatologie',
    html: `
      <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:12px;">
        <div style="font-size:12px;font-weight:700;color:#f59e0b;margin-bottom:10px;">Orthopädische Anamnese</div>
        <div class="k-form-label">Betroffene Region</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" style="accent-color:#f59e0b;">Wirbelsäule</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" style="accent-color:#f59e0b;">Schulter</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" style="accent-color:#f59e0b;">Knie</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" style="accent-color:#f59e0b;">Hüfte</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" style="accent-color:#f59e0b;">Fuß/Sprunggelenk</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" style="accent-color:#f59e0b;">Hand/Ellenbogen</label>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div><div class="k-form-label">Schmerzcharakter</div>
          <select class="k-form-input"><option>Dauerschmerz</option><option>Belastungsschmerz</option><option>Nachtschmerz</option><option>Bewegungsschmerz</option></select></div>
          <div><div class="k-form-label">Seit wann?</div><input class="k-form-input" placeholder="z.B. 3 Monate"></div>
        </div>
        <div style="margin-top:10px;">
          <div class="k-form-label">Trauma / Unfall</div>
          <textarea class="k-form-input" rows="2" placeholder="z.B. Sturz 2023, Arbeitsunfall..." style="resize:none;"></textarea>
        </div>
        <div style="margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" style="accent-color:#f59e0b;">Physiotherapie laufend</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" style="accent-color:#f59e0b;">Hilfsmittel (Schiene etc.)</label>
        </div>
      </div>`
  }
};

function anamneseSpecialtyInfo(fach){
  const spec = SPECIALTY_ANAMNESE[fach];
  return spec ? { label: spec.label, html: spec.html } : { label: 'Allgemeinanamnese', html: '' };
}

// Derives a stable storage key for a form field from its nearby label text,
// so the exact same key is produced whether the field is being read (patient
// filling it in) or written back (doctor viewing a submitted answer) -- as
// long as both sides render this same shared markup.
function anamneseFieldKey(el){
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
