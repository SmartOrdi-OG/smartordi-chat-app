// Data-driven port of vendor/anamnese-shared.js's ANAMNESE_COMMON_HTML,
// ANAMNESE_GESUNDHEITSFRAGEBOGEN_HTML and SPECIALTY_ANAMNESE -- same
// fields, same German labels/option text, same data-key strings (critical:
// doctor.html's Kartei "Anamnese" tab, vendor/kartei-anamnese.js, reads a
// patient's submitted answers by these exact keys, so they must match
// byte-for-byte). Expressed as plain data instead of inline-styled HTML
// strings so AnamneseScreen.jsx can render it with this portal's own
// (not doctor.html's Kartei) visual language, generically.
//
// Block shapes a section's `blocks` array can contain:
//   { kind: 'checkboxes', items: [{ key, label }] }
//   { kind: 'text' | 'textarea', key, label, placeholder, inputType? }
//   { kind: 'select', key, label, options: [{ value, label }] }
//   { kind: 'grid', fields: [ <text|select|textarea field, as above> ] }
//   { kind: 'subheader', label }

export const ANAMNESE_COMMON_SECTIONS = [
  {
    title: 'Allergien & Unverträglichkeiten',
    blocks: [
      { kind: 'checkboxes', items: [
        { key: 'an.common.allergie.penizillin', label: 'Penizillin' },
        { key: 'an.common.allergie.aspirin', label: 'Aspirin/NSAR' },
        { key: 'an.common.allergie.latex', label: 'Latex' },
        { key: 'an.common.allergie.kontrastmittel', label: 'Kontrastmittel' },
      ] },
      { kind: 'text', key: 'an.common.allergie.weitere', placeholder: 'Weitere Allergien...' },
    ],
  },
  {
    title: 'Aktuelle Medikamente',
    blocks: [
      { kind: 'textarea', key: 'an.common.medikamente', placeholder: 'z.B. Metformin 500mg 2x täglich...' },
    ],
  },
  {
    title: 'Frühere Operationen',
    blocks: [
      { kind: 'textarea', key: 'an.common.operationen', placeholder: 'z.B. Appendektomie 2015...' },
    ],
  },
  {
    title: 'Familienanamnese',
    blocks: [
      { kind: 'checkboxes', items: [
        { key: 'an.common.familie.diabetes', label: 'Diabetes' },
        { key: 'an.common.familie.herz', label: 'Herzerkrankung' },
        { key: 'an.common.familie.krebs', label: 'Krebserkrankung' },
        { key: 'an.common.familie.schlaganfall', label: 'Schlaganfall' },
      ] },
    ],
  },
  {
    title: 'Sozialanamnese',
    blocks: [
      { kind: 'grid', fields: [
        { kind: 'select', key: 'an.common.raucherstatus', label: 'Raucherstatus', options: [
          { value: 'Nichtraucher', label: 'Nichtraucher' }, { value: 'Exraucher', label: 'Exraucher' }, { value: 'Raucher', label: 'Raucher' },
        ] },
        { kind: 'select', key: 'an.common.alkohol', label: 'Alkohol', options: [
          { value: 'Kein', label: 'Kein' }, { value: 'Gelegentlich', label: 'Gelegentlich' }, { value: 'Regelmäßig', label: 'Regelmäßig' },
        ] },
        { kind: 'text', key: 'an.common.beruf', label: 'Beruf', placeholder: 'z.B. Lehrer' },
        { kind: 'select', key: 'an.common.sport', label: 'Sport', options: [
          { value: 'Kein', label: 'Kein' }, { value: 'Gelegentlich', label: 'Gelegentlich' }, { value: 'Regelmäßig', label: 'Regelmäßig' },
        ] },
      ] },
    ],
  },
];

// Gesundheitsfragebogen -- 24 Ja/Nein screening questions, 1:1 from the
// BVAEB Anamnesebogen (dental-only questions deliberately excluded, see
// vendor/anamnese-shared.js's own header comment). Only shown for
// Allgemeinmedizin + Kinderheilkunde, same as the original.
export const ANAMNESE_GFB_QUESTIONS = [
  { key: 'an.gfb.medikamente', question: 'Nehmen Sie Medikamente ein?', followupPlaceholder: 'Wenn ja, welche?' },
  { key: 'an.gfb.injektionen', question: 'Bekommen Sie regelmäßig Injektionen?', followupPlaceholder: 'Wenn ja, welche?' },
  { key: 'an.gfb.allergie', question: 'Leiden Sie an einer Allergie oder Medikamentenunverträglichkeit?', followupPlaceholder: 'Wenn ja, an welcher?' },
  { key: 'an.gfb.infektion', question: 'Leiden oder litten Sie an einer Infektionskrankheit (z.B. Hepatitis, Tuberkulose, HIV/AIDS)?', followupPlaceholder: 'Wenn ja, an welcher?' },
  { key: 'an.gfb.diabetes', question: 'Leiden oder litten Sie an Diabetes mellitus (Zuckerkrankheit)?' },
  { key: 'an.gfb.osteoporose', question: 'Leiden oder litten Sie an Osteoporose?' },
  { key: 'an.gfb.schwanger', question: 'Sind Sie oder könnten Sie schwanger sein?' },
  { key: 'an.gfb.stillen', question: 'Stillen Sie derzeit?' },
  { key: 'an.gfb.epilepsie', question: 'Leiden oder litten Sie an Epilepsie?' },
  { key: 'an.gfb.blutungsneigung', question: 'Haben Sie eine angeborene Blutungsneigung oder nehmen Sie blutverdünnende Medikamente ein?', followupPlaceholder: 'Wenn ja, welche?' },
  { key: 'an.gfb.atemwege', question: 'Leiden oder litten Sie an einer Atemwegserkrankung (z.B. Asthma, COPD)?', followupPlaceholder: 'Wenn ja, an welcher?' },
  { key: 'an.gfb.rauchen', question: 'Rauchen Sie?', followupPlaceholder: 'Wenn ja, wieviel pro Tag?' },
  { key: 'an.gfb.herzkreislauf', question: 'Haben Sie eine Erkrankung des Herz-Kreislauf-Systems?', followupPlaceholder: 'Wenn ja, welche?' },
  { key: 'an.gfb.schrittmacher', question: 'Tragen Sie einen Herzschrittmacher?' },
  { key: 'an.gfb.augen', question: 'Haben Sie eine Erkrankung der Augen (z.B. Glaukom)?', followupPlaceholder: 'Wenn ja, welche?' },
  { key: 'an.gfb.schilddruese', question: 'Haben Sie eine Erkrankung der Schilddrüse?', followupPlaceholder: 'Wenn ja, welche?' },
  { key: 'an.gfb.nieren', question: 'Haben Sie eine Erkrankung der Nieren?', followupPlaceholder: 'Wenn ja, welche?' },
  { key: 'an.gfb.verdauung', question: 'Haben Sie eine Erkrankung der Verdauungsorgane?', followupPlaceholder: 'Wenn ja, welche?' },
  { key: 'an.gfb.tumor', question: 'Haben oder hatten Sie eine Tumorerkrankung/Chemo- oder Strahlentherapie?', followupPlaceholder: 'Wenn ja, wann?' },
  { key: 'an.gfb.operation', question: 'Hatten Sie kürzlich eine Operation?', followupPlaceholder: 'Wenn ja, welche?' },
  { key: 'an.gfb.autoimmun', question: 'Leiden Sie an einer Autoimmunerkrankung?', followupPlaceholder: 'Wenn ja, an welcher?' },
  { key: 'an.gfb.immunschwaeche', question: 'Haben Sie eine Immunschwäche?' },
  { key: 'an.gfb.psychisch', question: 'Leiden Sie an einer Erkrankung des Nervensystems oder liegt eine psychische Erkrankung vor?', followupPlaceholder: 'Wenn ja, welche?' },
  { key: 'an.gfb.schlaganfall', question: 'Hatten Sie im vergangenen Jahr einen Schlaganfall?' },
];

const GFB_SECTION = { title: 'Gesundheitsfragebogen', gfb: true };

export const SPECIALTY_ANAMNESE = {
  'Kinderheilkunde': {
    label: 'Pädiatrie — Kinderheilkunde',
    sections: [
      {
        title: 'Geburts- & Entwicklungsanamnese',
        blocks: [
          { kind: 'grid', fields: [
            { kind: 'select', key: 'an.kind.geburtsart', label: 'Geburtsart', options: [
              { value: 'Spontangeburt', label: 'Spontangeburt' }, { value: 'Kaiserschnitt', label: 'Kaiserschnitt' }, { value: 'Vakuum/Zange', label: 'Vakuum/Zange' },
            ] },
            { kind: 'text', key: 'an.kind.geburtsgewicht', label: 'Geburtsgewicht', placeholder: 'z.B. 3.200g' },
            { kind: 'text', key: 'an.kind.ssw', label: 'Schwangerschaftswoche', placeholder: 'z.B. 39. SSW' },
            { kind: 'text', key: 'an.kind.apgar', label: 'APGAR Score', placeholder: 'z.B. 9/10/10' },
          ] },
          { kind: 'select', key: 'an.kind.ernaehrung', label: 'Ernährung', options: [
            { value: 'Gestillt', label: 'Gestillt' }, { value: 'Flaschenmilch', label: 'Flaschenmilch' }, { value: 'Beides', label: 'Beides' }, { value: 'Beikost', label: 'Beikost' },
          ] },
          { kind: 'subheader', label: 'Entwicklung' },
          { kind: 'grid', fields: [
            { kind: 'text', key: 'an.kind.erste_woerter', label: 'Erste Wörter', placeholder: 'z.B. 12 Monate' },
            { kind: 'text', key: 'an.kind.laufen', label: 'Laufen', placeholder: 'z.B. 14 Monate' },
          ] },
        ],
      },
      {
        title: 'Schule & Entwicklung',
        blocks: [
          { kind: 'checkboxes', items: [
            { key: 'an.kind.lernprobleme', label: 'Lernprobleme' },
            { key: 'an.kind.adhs', label: 'ADHS Verdacht' },
            { key: 'an.kind.sprachtherapie', label: 'Sprachtherapie' },
            { key: 'an.kind.ergotherapie', label: 'Ergotherapie' },
          ] },
        ],
      },
      GFB_SECTION,
    ],
  },
  'Allgemeinmedizin': {
    label: 'Allgemeinmedizin',
    sections: [GFB_SECTION],
  },
  'Gynäkologie': {
    label: 'Gynäkologie & Geburtshilfe',
    sections: [
      {
        title: 'Gynäkologische Anamnese',
        blocks: [
          { kind: 'grid', fields: [
            { kind: 'text', key: 'an.gyn.menarche', label: 'Menarche (erstes Alter)', placeholder: 'z.B. 13 Jahre' },
            { kind: 'text', key: 'an.gyn.zykluslaenge', label: 'Zykluslänge', placeholder: 'z.B. 28 Tage' },
            { kind: 'text', key: 'an.gyn.letzte_periode', label: 'Letzte Periode', inputType: 'date' },
            { kind: 'select', key: 'an.gyn.menopause', label: 'Menopause', options: [
              { value: 'Nein', label: 'Nein' }, { value: 'Ja', label: 'Ja' }, { value: 'Perimenopause', label: 'Perimenopause' },
            ] },
          ] },
          { kind: 'subheader', label: 'Beschwerden' },
          { kind: 'checkboxes', items: [
            { key: 'an.gyn.dysmenorrhoe', label: 'Dysmenorrhö' },
            { key: 'an.gyn.menorrhagie', label: 'Menorrhagie' },
            { key: 'an.gyn.zwischenblutungen', label: 'Zwischenblutungen' },
            { key: 'an.gyn.ausfluss', label: 'Ausfluss' },
          ] },
        ],
      },
      {
        title: 'Geburtshilfe',
        blocks: [
          { kind: 'grid', fields: [
            { kind: 'text', key: 'an.gyn.gravida', label: 'Anzahl Schwangerschaften (G)', inputType: 'number', placeholder: '0' },
            { kind: 'text', key: 'an.gyn.para', label: 'Anzahl Geburten (P)', inputType: 'number', placeholder: '0' },
            { kind: 'text', key: 'an.gyn.fehlgeburten', label: 'Fehlgeburten', inputType: 'number', placeholder: '0' },
            { kind: 'select', key: 'an.gyn.schwanger_aktuell', label: 'Schwanger aktuell', options: [
              { value: 'Nein', label: 'Nein' }, { value: 'Ja', label: 'Ja' }, { value: 'Unbekannt', label: 'Unbekannt' },
            ] },
          ] },
        ],
      },
    ],
  },
  'Kardiologie': {
    label: 'Kardiologie — Herzanamnese',
    sections: [
      {
        title: 'Kardiale Beschwerden',
        blocks: [
          { kind: 'checkboxes', items: [
            { key: 'an.card.brustschmerz', label: 'Brustschmerz' },
            { key: 'an.card.dyspnoe_ruhe', label: 'Dyspnoe (Ruhe)' },
            { key: 'an.card.dyspnoe_belastung', label: 'Dyspnoe (Belastung)' },
            { key: 'an.card.palpitationen', label: 'Palpitationen' },
            { key: 'an.card.synkope', label: 'Synkope' },
            { key: 'an.card.oedeme', label: 'Ödeme (Beine)' },
          ] },
          { kind: 'grid', fields: [
            { kind: 'text', key: 'an.card.rr_systolisch', label: 'Blutdruck (systolisch)', placeholder: 'z.B. 130 mmHg' },
            { kind: 'text', key: 'an.card.herzfrequenz', label: 'Herzfrequenz', placeholder: 'z.B. 72/min' },
            { kind: 'text', key: 'an.card.herzerkrankung_bekannt', label: 'Bekannte Herzerkrankung', placeholder: 'z.B. KHK, VHF...' },
            { kind: 'select', key: 'an.card.schrittmacher', label: 'Herzschrittmacher', options: [
              { value: 'Nein', label: 'Nein' }, { value: 'Ja', label: 'Ja' },
            ] },
          ] },
        ],
      },
    ],
  },
  'Neurologie': {
    label: 'Neurologie — Nervenanamnese',
    sections: [
      {
        title: 'Neurologische Beschwerden',
        blocks: [
          { kind: 'checkboxes', items: [
            { key: 'an.neuro.kopfschmerzen', label: 'Kopfschmerzen' },
            { key: 'an.neuro.migraene', label: 'Migräne' },
            { key: 'an.neuro.schwindel', label: 'Schwindel' },
            { key: 'an.neuro.taubheit', label: 'Taubheitsgefühl' },
            { key: 'an.neuro.krampfanfaelle', label: 'Krampfanfälle' },
            { key: 'an.neuro.gedaechtnis', label: 'Gedächtnisprobleme' },
            { key: 'an.neuro.tremor', label: 'Tremor' },
            { key: 'an.neuro.sehstoerungen', label: 'Sehstörungen' },
          ] },
          { kind: 'text', key: 'an.neuro.erkrankung', label: 'Bekannte neurologische Erkrankung', placeholder: 'z.B. Epilepsie, MS, Parkinson...' },
        ],
      },
    ],
  },
  'Innere Medizin': {
    label: 'Innere Medizin — Allgemeinanamnese',
    sections: [
      {
        title: 'Gastrointestinal & Allgemein',
        blocks: [
          { kind: 'checkboxes', items: [
            { key: 'an.innere.appetitlosigkeit', label: 'Appetitlosigkeit' },
            { key: 'an.innere.gewichtsverlust', label: 'Gewichtsverlust' },
            { key: 'an.innere.uebelkeit_erbrechen', label: 'Übelkeit/Erbrechen' },
            { key: 'an.innere.dysphagie', label: 'Dysphagie' },
            { key: 'an.innere.sodbrennen', label: 'Sodbrennen' },
            { key: 'an.innere.diarrhoe', label: 'Diarrhö' },
            { key: 'an.innere.obstipation', label: 'Obstipation' },
            { key: 'an.innere.blut_stuhl', label: 'Blut im Stuhl' },
          ] },
          { kind: 'grid', fields: [
            { kind: 'text', key: 'an.innere.bmi_gewicht', label: 'BMI / Gewicht', placeholder: 'z.B. 75kg / BMI 24' },
            { kind: 'text', key: 'an.innere.blutzucker', label: 'Nüchternblutzucker', placeholder: 'z.B. 95 mg/dl' },
          ] },
        ],
      },
    ],
  },
  'Orthopädie': {
    label: 'Orthopädie & Traumatologie',
    sections: [
      {
        title: 'Orthopädische Anamnese',
        blocks: [
          { kind: 'checkboxes', label: 'Betroffene Region', items: [
            { key: 'an.ortho.wirbelsaeule', label: 'Wirbelsäule' },
            { key: 'an.ortho.schulter', label: 'Schulter' },
            { key: 'an.ortho.knie', label: 'Knie' },
            { key: 'an.ortho.huefte', label: 'Hüfte' },
            { key: 'an.ortho.fuss', label: 'Fuß/Sprunggelenk' },
            { key: 'an.ortho.hand', label: 'Hand/Ellenbogen' },
          ] },
          { kind: 'grid', fields: [
            { kind: 'select', key: 'an.ortho.schmerzcharakter', label: 'Schmerzcharakter', options: [
              { value: 'Dauerschmerz', label: 'Dauerschmerz' }, { value: 'Belastungsschmerz', label: 'Belastungsschmerz' },
              { value: 'Nachtschmerz', label: 'Nachtschmerz' }, { value: 'Bewegungsschmerz', label: 'Bewegungsschmerz' },
            ] },
            { kind: 'text', key: 'an.ortho.seit_wann', label: 'Seit wann?', placeholder: 'z.B. 3 Monate' },
          ] },
          { kind: 'textarea', key: 'an.ortho.trauma', label: 'Trauma / Unfall', placeholder: 'z.B. Sturz 2023, Arbeitsunfall...' },
          { kind: 'checkboxes', items: [
            { key: 'an.ortho.physio_laufend', label: 'Physiotherapie laufend' },
            { key: 'an.ortho.hilfsmittel', label: 'Hilfsmittel (Schiene etc.)' },
          ] },
        ],
      },
    ],
  },
};

// Mirrors anamneseSpecialtyInfo() -- resolves which specialty sections a
// practice's Fachrichtung gets. An unrecognized/unset Fach gets no
// specialty sections at all (same as the original's
// `{ label: 'Allgemeinanamnese', ..., html: '' }` fallback) -- only the
// common sections above are shown for it.
export function anamneseSpecialtyInfo(fach) {
  return SPECIALTY_ANAMNESE[fach] || { label: 'Allgemeinanamnese', sections: [] };
}
