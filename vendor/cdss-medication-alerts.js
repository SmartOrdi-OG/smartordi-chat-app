// First slice of a Clinical Decision Support System (CDSS) for the Rezept
// tab: non-blocking ⚠️ alerts for well-known drug-drug interactions and
// drug/allergy-class matches, scoped ONLY to the medications already in
// doctor.html's own MEDIKAMENTE_LIST (a small, curated, known set -- not an
// open-ended claim to cover every possible medication). The doctor can
// always ignore an alert and save/print/send the Rezept anyway -- this only
// ever informs, never blocks, matching how prescribing decisions actually
// work and avoiding any implication that the app itself is making the
// clinical call.
//
// Deliberately a small, illustrative list of textbook-level interactions
// (NSAR-combinations, NSAR/Kortikosteroid, ACE-Hemmer/Betablocker/NSAR,
// SSRI/NSAR bleeding risk, PPI/L-Thyroxin absorption, additive CNS sedation)
// and penicillin/NSAR allergy-class cross-checks -- NOT a substitute for a
// licensed drug-interaction database (e.g. a real ABDA/Lauer-Taxe feed). See
// TODO.md for the recommendation to license a real database before relying
// on this beyond a first, limited rollout.
//
// Covers every one of doctor.html's MEDIKAMENTE_LIST entries (so every
// medication the Rezept datalist offers is at least recognized here, even
// if -- correctly -- it has no interactions listed against it, like plain
// Paracetamol or Xylometazolin nasal spray).

// Maps a drug's free-text field value (whatever the doctor typed or picked
// from the Rezept datalist, e.g. "Ibuprofen 400mg") to a stable ingredient
// id via substring match, so dosage/spelling variations still match.
const MED_INGREDIENT_KEYWORDS = [
  { id: 'paracetamol', label: 'Paracetamol', match: ['paracetamol'] },
  { id: 'ibuprofen', label: 'Ibuprofen', match: ['ibuprofen'] },
  { id: 'novalgin', label: 'Novalgin (Metamizol)', match: ['novalgin', 'metamizol'] },
  { id: 'diclofenac', label: 'Diclofenac', match: ['diclofenac'] },
  { id: 'prednisolon', label: 'Prednisolon', match: ['prednisolon'] },
  { id: 'cetirizin', label: 'Cetirizin', match: ['cetirizin'] },
  { id: 'loratadin', label: 'Loratadin', match: ['loratadin'] },
  { id: 'desloratadin', label: 'Desloratadin', match: ['desloratadin'] },
  { id: 'aspirin', label: 'Aspirin (ASS)', match: ['aspirin', 'acetylsalicyl'] },
  { id: 'amoxicillin', label: 'Amoxicillin', match: ['amoxicillin'] },
  { id: 'cefuroxim', label: 'Cefuroxim', match: ['cefuroxim'] },
  { id: 'pantoprazol', label: 'Pantoprazol', match: ['pantoprazol'] },
  { id: 'omeprazol', label: 'Omeprazol', match: ['omeprazol'] },
  { id: 'metformin', label: 'Metformin', match: ['metformin'] },
  { id: 'ramipril', label: 'Ramipril', match: ['ramipril'] },
  { id: 'bisoprolol', label: 'Bisoprolol', match: ['bisoprolol'] },
  { id: 'simvastatin', label: 'Simvastatin', match: ['simvastatin'] },
  { id: 'atorvastatin', label: 'Atorvastatin', match: ['atorvastatin'] },
  { id: 'lthyroxin', label: 'L-Thyroxin', match: ['l-thyroxin', 'thyroxin'] },
  { id: 'pregabalin', label: 'Pregabalin', match: ['pregabalin'] },
  { id: 'sertralin', label: 'Sertralin', match: ['sertralin'] },
  { id: 'mirtazapin', label: 'Mirtazapin', match: ['mirtazapin'] },
  { id: 'xylometazolin', label: 'Xylometazolin', match: ['xylometazolin'] },
];

// Symmetric drug-drug interaction pairs (order doesn't matter).
const MED_INTERACTIONS = [
  { a: 'ibuprofen', b: 'diclofenac', note: 'Zwei NSAR gleichzeitig – erhöhtes Risiko für Magen-Darm-Blutungen und Nierenschäden.' },
  { a: 'ibuprofen', b: 'aspirin', note: 'Ibuprofen kann die thrombozytenaggregationshemmende Wirkung von niedrig dosiertem Aspirin abschwächen; zusätzlich erhöhtes Blutungsrisiko.' },
  { a: 'diclofenac', b: 'aspirin', note: 'Zwei NSAR gleichzeitig – erhöhtes Risiko für Magen-Darm-Blutungen.' },
  { a: 'ibuprofen', b: 'ramipril', note: 'NSAR können die blutdrucksenkende Wirkung von ACE-Hemmern abschwächen und das Risiko einer Nierenfunktionsstörung erhöhen.' },
  { a: 'diclofenac', b: 'ramipril', note: 'NSAR können die blutdrucksenkende Wirkung von ACE-Hemmern abschwächen und das Risiko einer Nierenfunktionsstörung erhöhen.' },
  { a: 'aspirin', b: 'ramipril', note: 'NSAR/Aspirin können die blutdrucksenkende Wirkung von ACE-Hemmern abschwächen, insbesondere in höherer Dosierung.' },
  { a: 'ibuprofen', b: 'bisoprolol', note: 'NSAR können die blutdrucksenkende Wirkung von Betablockern abschwächen.' },
  { a: 'diclofenac', b: 'bisoprolol', note: 'NSAR können die blutdrucksenkende Wirkung von Betablockern abschwächen.' },
  { a: 'aspirin', b: 'bisoprolol', note: 'NSAR/Aspirin können die blutdrucksenkende Wirkung von Betablockern abschwächen, insbesondere in höherer Dosierung.' },
  { a: 'ibuprofen', b: 'sertralin', note: 'Kombination von NSAR und SSRI erhöht das Risiko für Magen-Darm-Blutungen.' },
  { a: 'diclofenac', b: 'sertralin', note: 'Kombination von NSAR und SSRI erhöht das Risiko für Magen-Darm-Blutungen.' },
  { a: 'aspirin', b: 'sertralin', note: 'Kombination von NSAR/Aspirin und SSRI erhöht das Risiko für Magen-Darm-Blutungen.' },
  { a: 'lthyroxin', b: 'pantoprazol', note: 'Protonenpumpenhemmer können die Aufnahme von L-Thyroxin verringern – zeitversetzte Einnahme (mind. 30–60 Min. Abstand) empfohlen.' },
  { a: 'lthyroxin', b: 'omeprazol', note: 'Protonenpumpenhemmer können die Aufnahme von L-Thyroxin verringern – zeitversetzte Einnahme (mind. 30–60 Min. Abstand) empfohlen.' },
  { a: 'prednisolon', b: 'ibuprofen', note: 'NSAR + Kortikosteroid gleichzeitig – deutlich erhöhtes Risiko für Magen-Darm-Blutungen und -Geschwüre.' },
  { a: 'prednisolon', b: 'diclofenac', note: 'NSAR + Kortikosteroid gleichzeitig – deutlich erhöhtes Risiko für Magen-Darm-Blutungen und -Geschwüre.' },
  { a: 'prednisolon', b: 'aspirin', note: 'NSAR/Aspirin + Kortikosteroid gleichzeitig – deutlich erhöhtes Risiko für Magen-Darm-Blutungen und -Geschwüre.' },
  { a: 'prednisolon', b: 'metformin', note: 'Kortikosteroide können den Blutzucker erhöhen und die blutzuckersenkende Wirkung von Metformin abschwächen – Blutzuckerkontrolle beachten.' },
  { a: 'novalgin', b: 'ibuprofen', note: 'Kombination mehrerer Schmerzmittel – erhöhtes Risiko für Nieren- und Magen-Darm-Nebenwirkungen.' },
  { a: 'novalgin', b: 'diclofenac', note: 'Kombination mehrerer Schmerzmittel – erhöhtes Risiko für Nieren- und Magen-Darm-Nebenwirkungen.' },
  { a: 'novalgin', b: 'aspirin', note: 'Kombination mehrerer Schmerzmittel – erhöhtes Risiko für Nieren- und Magen-Darm-Nebenwirkungen.' },
  { a: 'pregabalin', b: 'mirtazapin', note: 'Beide wirken dämpfend auf das Zentralnervensystem – verstärkte Müdigkeit/Schwindel möglich, besonders zu Behandlungsbeginn.' },
];

// Drug -> keywords to look for in the patient's free-text allergie field.
// Cefuroxim (a cephalosporin) is included under a penicillin allergy due to
// well-known cross-reactivity, not because it IS penicillin. Both the
// German ("Penizillin", the Anamnese checkbox's own label, deriveAllergyText()
// below) and Latin/English ("Penicillin", the more common free-text spelling)
// forms are listed -- a real gap found 2026-08-07: only the c-spelling was
// here, so it silently never matched the z-spelling the app itself renders.
const MED_ALLERGY_CLASSES = [
  { id: 'amoxicillin', keywords: ['penicillin', 'penizillin', 'amoxicillin'] },
  { id: 'cefuroxim', keywords: ['penicillin', 'penizillin', 'cephalosporin', 'cefuroxim'] },
  { id: 'aspirin', keywords: ['aspirin', 'ass', 'nsar', 'acetylsalicyl'] },
  { id: 'ibuprofen', keywords: ['nsar', 'ibuprofen'] },
  { id: 'diclofenac', keywords: ['nsar', 'diclofenac'] },
];

// Combines the patient's free-text allergie field (only ever populated via
// secretary.html's CSV bulk import -- there is no manual UI for it) with
// their structured Anamnese answers (the "Allergien & Unverträglichkeiten"
// checkboxes/free-text every doctor/patient actually fills in via the
// Anamnese questionnaire, vendor/anamnese-shared.js) into one string for
// detectMedicationAlerts() below. Real bug found 2026-08-07: a patient
// marked "Aspirin/NSAR" in their Anamnese never triggered a Rezept-tab
// allergy alert for Aspirin, because that data lives entirely separately
// (patients.anamnese jsonb) from the free-text field this check used to
// read alone (patients.allergie) -- for a patient never bulk-imported via
// CSV, that field is simply always empty, so the alert was silently
// unreachable for the normal, everyday way of recording an allergy.
// rec is whatever findPatientRecordAsync()/accountToPatientRecord() return
// (must include both .allergie and .anamnese).
function deriveAllergyText(rec) {
  const parts = [];
  if (rec && rec.allergie) parts.push(rec.allergie);
  const an = rec && rec.anamnese;
  if (an) {
    if (an['an.common.allergie.penizillin']) parts.push('Penizillin');
    if (an['an.common.allergie.aspirin']) parts.push('Aspirin/NSAR');
    if (an['an.common.allergie.latex']) parts.push('Latex');
    if (an['an.common.allergie.kontrastmittel']) parts.push('Kontrastmittel');
    if (an['an.common.allergie.weitere']) parts.push(an['an.common.allergie.weitere']);
  }
  return parts.join(', ');
}

function _medLabel(id) {
  const m = MED_INGREDIENT_KEYWORDS.find(k => k.id === id);
  return m ? m.label : id;
}

// drugTexts: array of the Rezept form's free-text medication field values
// (rz-med1..4). allergieText: the current patient's allergie field (may be
// empty/null). Returns [{type:'interaction'|'allergy', text}], or [] if
// nothing matched -- an empty result means "nothing in this small known
// list matched", not "verified safe".
function detectMedicationAlerts(drugTexts, allergieText) {
  const lowerTexts = (drugTexts || []).filter(Boolean).map(t => t.toLowerCase());
  const foundIds = MED_INGREDIENT_KEYWORDS
    .filter(k => lowerTexts.some(t => k.match.some(m => t.includes(m))))
    .map(k => k.id);

  const alerts = [];
  MED_INTERACTIONS.forEach(inter => {
    if (foundIds.includes(inter.a) && foundIds.includes(inter.b)) {
      alerts.push({ type: 'interaction', text: _medLabel(inter.a) + ' + ' + _medLabel(inter.b) + ': ' + inter.note });
    }
  });

  const allergieLower = (allergieText || '').trim().toLowerCase();
  if (allergieLower) {
    MED_ALLERGY_CLASSES.forEach(ac => {
      if (foundIds.includes(ac.id) && ac.keywords.some(k => allergieLower.includes(k))) {
        alerts.push({ type: 'allergy', text: _medLabel(ac.id) + ': mögliche Allergie/Unverträglichkeit laut Patientenakte ("' + (allergieText || '').trim() + '").' });
      }
    });
  }
  return alerts;
}
