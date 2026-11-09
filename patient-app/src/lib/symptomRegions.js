// Mirrors patient.html's SYMPTOM_REGIONS + SYMPTOM_RELEVANT_ART/
// artNeedsSymptomPicker() -- the canonical German region/symptom strings
// are what gets written to the termin record (patient_set_symptoms), same
// as the original; this POC skips the i18n layer, same simplification
// already made for MKP/Impfpass.
export const SYMPTOM_REGIONS = {
  kopf: { label: 'Kopf (allgemein)', symptoms: ['Kopfschmerzen', 'Schwindel', 'Migräne', 'Fieber'] },
  gesicht: { label: 'Gesicht / Augen / Ohren', symptoms: ['Sehstörungen', 'Ohrenschmerzen', 'Hörminderung', 'Nasenbluten', 'Zahnschmerzen', 'Riechstörung'] },
  nacken: { label: 'Nacken & Schultern', symptoms: ['Nackenschmerzen', 'Schulterschmerzen', 'Verspannungen', 'Eingeschränkte Beweglichkeit'] },
  hals: { label: 'Hals (Kehle)', symptoms: ['Halsschmerzen', 'Schluckbeschwerden', 'Heiserkeit', 'Husten'] },
  brust: { label: 'Brust / Herz', symptoms: ['Brustschmerzen', 'Herzrasen', 'Atemnot', 'Husten'] },
  bauch: { label: 'Bauch', symptoms: ['Bauchschmerzen', 'Übelkeit', 'Erbrechen', 'Durchfall', 'Verstopfung', 'Sodbrennen'] },
  becken: { label: 'Becken / Unterleib', symptoms: ['Unterleibsschmerzen', 'Brennen beim Wasserlassen', 'Blasenprobleme', 'Menstruationsbeschwerden', 'Ausfluss'] },
  ruecken: { label: 'Rücken', symptoms: ['Rückenschmerzen', 'Verspannungen', 'Ausstrahlende Schmerzen', 'Ischiasschmerzen'] },
  arme: { label: 'Arme', symptoms: ['Schmerzen', 'Taubheitsgefühl', 'Schwellung', 'Eingeschränkte Beweglichkeit'] },
  haende: { label: 'Hände', symptoms: ['Schmerzen', 'Taubheit/Kribbeln', 'Schwellung', 'Zittern', 'Eingeschränkte Fingerbeweglichkeit'] },
  beine: { label: 'Beine', symptoms: ['Schmerzen', 'Schwellung', 'Krampfadern', 'Taubheitsgefühl'] },
  fuesse: { label: 'Füße', symptoms: ['Schmerzen', 'Schwellung', 'Taubheit/Kribbeln', 'Hautveränderung'] },
  haut: { label: 'Haut (allgemein)', symptoms: ['Ausschlag', 'Juckreiz', 'Rötung', 'Wunde/Verletzung'] },
};

// Only these reasons are symptom-relevant -- same reasoning as the
// original: an Arbeitsunfähigkeitsmeldung/Pflegefreistellung is an
// administrative certificate request, not a symptom, and a plain Impfung/
// Blutabnahme has nothing to point at on a body figure.
const SYMPTOM_RELEVANT_ART = ['Ordination', 'Kontrolle', 'Erstgespräch', 'Sonstige'];

export function artNeedsSymptomPicker(art) {
  return SYMPTOM_RELEVANT_ART.includes(art);
}

export function geschlechtToBodyVariant(g) {
  if (g === 'm') return 'male';
  if (g === 'w') return 'female';
  return null;
}
