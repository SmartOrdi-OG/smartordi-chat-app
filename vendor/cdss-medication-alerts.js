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
// (NSAR-combinations, ACE-Hemmer/NSAR, SSRI/NSAR bleeding risk, PPI/
// L-Thyroxin absorption) and penicillin/NSAR allergy-class cross-checks --
// NOT a substitute for a licensed drug-interaction database (e.g. a real
// ABDA/Lauer-Taxe feed). See TODO.md for the recommendation to license a
// real database before relying on this beyond a first, limited rollout.

// Maps a drug's free-text field value (whatever the doctor typed or picked
// from the Rezept datalist, e.g. "Ibuprofen 400mg") to a stable ingredient
// id via substring match, so dosage/spelling variations still match.
const MED_INGREDIENT_KEYWORDS = [
  { id: 'ibuprofen', label: 'Ibuprofen', match: ['ibuprofen'] },
  { id: 'diclofenac', label: 'Diclofenac', match: ['diclofenac'] },
  { id: 'aspirin', label: 'Aspirin (ASS)', match: ['aspirin', 'acetylsalicyl'] },
  { id: 'amoxicillin', label: 'Amoxicillin', match: ['amoxicillin'] },
  { id: 'cefuroxim', label: 'Cefuroxim', match: ['cefuroxim'] },
  { id: 'sertralin', label: 'Sertralin', match: ['sertralin'] },
  { id: 'ramipril', label: 'Ramipril', match: ['ramipril'] },
  { id: 'lthyroxin', label: 'L-Thyroxin', match: ['l-thyroxin', 'thyroxin'] },
  { id: 'pantoprazol', label: 'Pantoprazol', match: ['pantoprazol'] },
  { id: 'omeprazol', label: 'Omeprazol', match: ['omeprazol'] },
];

// Symmetric drug-drug interaction pairs (order doesn't matter).
const MED_INTERACTIONS = [
  { a: 'ibuprofen', b: 'diclofenac', note: 'Zwei NSAR gleichzeitig – erhöhtes Risiko für Magen-Darm-Blutungen und Nierenschäden.' },
  { a: 'ibuprofen', b: 'aspirin', note: 'Ibuprofen kann die thrombozytenaggregationshemmende Wirkung von niedrig dosiertem Aspirin abschwächen; zusätzlich erhöhtes Blutungsrisiko.' },
  { a: 'diclofenac', b: 'aspirin', note: 'Zwei NSAR gleichzeitig – erhöhtes Risiko für Magen-Darm-Blutungen.' },
  { a: 'ibuprofen', b: 'ramipril', note: 'NSAR können die blutdrucksenkende Wirkung von ACE-Hemmern abschwächen und das Risiko einer Nierenfunktionsstörung erhöhen.' },
  { a: 'diclofenac', b: 'ramipril', note: 'NSAR können die blutdrucksenkende Wirkung von ACE-Hemmern abschwächen und das Risiko einer Nierenfunktionsstörung erhöhen.' },
  { a: 'aspirin', b: 'ramipril', note: 'NSAR/Aspirin können die blutdrucksenkende Wirkung von ACE-Hemmern abschwächen, insbesondere in höherer Dosierung.' },
  { a: 'ibuprofen', b: 'sertralin', note: 'Kombination von NSAR und SSRI erhöht das Risiko für Magen-Darm-Blutungen.' },
  { a: 'diclofenac', b: 'sertralin', note: 'Kombination von NSAR und SSRI erhöht das Risiko für Magen-Darm-Blutungen.' },
  { a: 'aspirin', b: 'sertralin', note: 'Kombination von NSAR/Aspirin und SSRI erhöht das Risiko für Magen-Darm-Blutungen.' },
  { a: 'lthyroxin', b: 'pantoprazol', note: 'Protonenpumpenhemmer können die Aufnahme von L-Thyroxin verringern – zeitversetzte Einnahme (mind. 30–60 Min. Abstand) empfohlen.' },
  { a: 'lthyroxin', b: 'omeprazol', note: 'Protonenpumpenhemmer können die Aufnahme von L-Thyroxin verringern – zeitversetzte Einnahme (mind. 30–60 Min. Abstand) empfohlen.' },
];

// Drug -> keywords to look for in the patient's free-text allergie field.
// Cefuroxim (a cephalosporin) is included under a penicillin allergy due to
// well-known cross-reactivity, not because it IS penicillin.
const MED_ALLERGY_CLASSES = [
  { id: 'amoxicillin', keywords: ['penicillin', 'amoxicillin'] },
  { id: 'cefuroxim', keywords: ['penicillin', 'cephalosporin', 'cefuroxim'] },
  { id: 'aspirin', keywords: ['aspirin', 'ass', 'nsar', 'acetylsalicyl'] },
  { id: 'ibuprofen', keywords: ['nsar', 'ibuprofen'] },
  { id: 'diclofenac', keywords: ['nsar', 'diclofenac'] },
];

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
