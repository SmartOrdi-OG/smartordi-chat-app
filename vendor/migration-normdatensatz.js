// Parser for the Austrian Ärztekammer's Legacy Export-Normdatensatz (ENDS 1,
// "Export-NormDatenSatz ENDS", Version IX, Stand 6.5.2008) -- the format
// most current Austrian practice software still exports for switching to a
// new system (the newer ENDS 2 / CDA format, "Normativ" only since 2021, is
// a separate parser -- see the project plan in TODO.md).
//
// This is NOT a CSV. Every line in the file is exactly one field's value,
// prefixed with a fixed 27-character header:
//   10-digit patient number (numeric; the spec says a source system with
//     alphanumeric patient IDs must sort and renumber patients sequentially
//     before export)
//   5-character field code: '#' + 1-letter block code (see ENDS1_BLOCK_NAMES)
//     + 3-letter field code (e.g. FNM, VNM -- see ENDS1_P_FIELDS)
//   8-digit date (TTMMJJJJ), zero-padded for master data
//   4-digit time (HHMM), zero-padded
// followed immediately by the field's content, terminated by CR/LF. Per the
// spec, a patient's data is grouped block by block (#P, then #H, #B, #D...)
// before the next patient's data begins, and repeatable blocks (multiple
// diagnoses, multiple prescriptions) simply repeat within that patient.

// Field code is 3 chars after the block letter -- almost always letters
// (FNM, VNM, ...), but a couple of real spec codes end in a digit (TL1,
// TL2 -- "Telefon 1"/"Telefon 2"), so this must allow digits too, not just
// [A-Z]{3}. Missed on the first pass (Phase 1): TL1/TL2 lines silently
// never matched at all, so a patient's phone number was dropped from every
// import without any error -- found while testing the write phase, which
// is the first code path that actually depends on TL1 reaching a real
// patients.tel column.
const ENDS1_LINE_RE = /^(\d{10})(#[PHBDKLVGFEAZ][A-Z0-9]{3})(\d{8})(\d{4})/;

// #P (PatientenstammDaten) field dictionary -- complete, per the official
// spec's field table. Phase 1 only reads this block; other blocks (#D
// Diagnosen, #V Verordnungen, ...) are counted for the preview but not yet
// parsed field-by-field -- that's later phases of the same project.
const ENDS1_P_FIELDS = {
  NMR: { label: 'Patientennummer', type: 'N' },
  FNM: { label: 'Familienname', type: 'T' },
  VNM: { label: 'Vorname', type: 'T' },
  GNM: { label: 'Geburtsname', type: 'T' },
  TTL: { label: 'Titel', type: 'T' },
  GBD: { label: 'Geburtsdatum', type: 'D' },
  VNR: { label: 'Versicherungsnummer', type: 'N' },
  MGN: { label: 'Mitgliedsnummer', type: 'T' },
  VKT: { label: 'Versicherten-Kategorie', type: 'N' },
  SKV: { label: 'Sachleistungs-/Kostenersatz', type: 'N' },
  TL1: { label: 'Telefon 1', type: 'T' },
  TL2: { label: 'Telefon 2', type: 'T' },
  MAL: { label: 'E-Mail', type: 'T' },
  FAX: { label: 'Fax', type: 'T' },
  EKM: { label: 'Entfernung (km)', type: 'N' },
  STR: { label: 'Straße', type: 'T' },
  LND: { label: 'Land', type: 'T' },
  PLZ: { label: 'Postleitzahl', type: 'N' },
  ORT: { label: 'Ort', type: 'T' },
  KCD: { label: 'Kassencode', type: 'T' },
  BLD: { label: 'Bundesland', type: 'N' },
  GES: { label: 'Geschlecht', type: 'N' },
  BER: { label: 'Beruf', type: 'T' },
  GRS: { label: 'Größe (cm)', type: 'N' },
  GEW: { label: 'Gewicht (g)', type: 'N' },
  HTF: { label: 'Bes. Kennzeichen/Hautfarbe', type: 'T' },
  VRW: { label: 'Verwandtschaft z. Hauptversicherten', type: 'T' },
  ZSV: { label: 'Zusatzversicherung', type: 'T' },
  RZG: { label: 'Rezeptgebühren befreit', type: 'T' },
  RZD: { label: 'Befreit bis', type: 'D' },
  ZUW: { label: 'Zuweisender Arzt', type: 'T' },
  DDG: { label: 'Dauerdiagnose', type: 'T' },
  CAV: { label: 'Cave', type: 'T' },
  DMK: { label: 'Dauermedikation', type: 'T' },
  ALL: { label: 'Allergie', type: 'T' },
  BSA: { label: 'Behandlungsscheinart', type: 'N' },
  BGR: { label: 'Behandlungsschein-Begründung', type: 'N' },
  VON: { label: 'Schein von', type: 'D' },
  BIS: { label: 'Schein bis', type: 'D' },
  KAS: { label: 'Behandlungsschein-Kassencode', type: 'T' },
  SDS: { label: 'Fremdstaaten-Kennzeichen', type: 'T' },
  SAD: { label: 'Schein-Abgabedatum', type: 'D' },
  UWD: { label: 'Überweisungsdatum', type: 'D' },
  SZW: { label: 'Schein-Zuweisender Arzt', type: 'T' },
  FRG: { label: 'Fragestellung', type: 'T' },
  DGB: { label: 'Dienstgeber', type: 'T' },
  DGS: { label: 'DG Straße', type: 'T' },
  DGO: { label: 'DG Ort', type: 'T' },
  DGP: { label: 'DG Postleitzahl', type: 'N' },
  DGT: { label: 'DG Telefon', type: 'T' },
  GSD: { label: 'Geld-Saldo', type: 'N' },
  SDU: { label: 'Saldo-Ursache', type: 'T' },
  HVN: { label: 'Patientennr. Hauptversicherter', type: 'N' },
};

// #D (Diagnosen), #V (Verordnungen/Rezepte) and #L (Laborbefunde) field
// dictionaries -- like ENDS1_P_FIELDS, transcribed directly from the
// official spec's field table (page 7-8), not guessed. Unlike #P (one value
// per patient per field), these are REPEATABLE blocks: a patient can have
// many diagnoses/prescriptions/lab results. The spec's own field list marks
// each block's STD (Systemdatum) as "Datum der Leistungserbringung... ist
// nicht das Systemdatum" for non-#P blocks (point 9.2.5) -- i.e. for these
// blocks the 27-char header's date/time is the real event date, not a
// zero-padded placeholder like it is for #P. That's the only grouping key
// the spec actually defines for telling separate repeatable entries apart,
// so buildEnds1PatientPreview() below groups a block's lines into one entry
// per distinct (date,time) pair.
const ENDS1_D_FIELDS = {
  STD: { label: 'Systemdatum der Eintragung', type: 'D' },
  TXT: { label: 'Text Diagnose', type: 'T' },
  WHO: { label: 'WHO-Code', type: 'T' },
  DGN: { label: 'andere Diagnose-Codes', type: 'T' },
  ART: { label: 'Art (Dauer/Temporär)', type: 'N' },
};
const ENDS1_V_FIELDS = {
  STD: { label: 'Systemdatum', type: 'D' },
  TXT: { label: 'Text', type: 'T' },
  MNG: { label: 'Menge', type: 'N' },
  ART: { label: 'Art (Stk., GT), Einheit', type: 'T' },
  PHN: { label: 'Pharmazentralnr.', type: 'N' },
  ANZ: { label: 'Anzahl Packungen', type: 'N' },
  TXG: { label: 'Tax-Preis (in Cent)', type: 'N' },
  AVP: { label: 'Apotheken-Verkaufspreis (in Cent)', type: 'N' },
  SIG: { label: 'Signatur (Einheit/Menge/Zeit)', type: 'T' },
  RZB: { label: 'Rezeptgebühren befreit', type: 'N' },
  PAR: { label: 'Packungsart', type: 'T' },
};
const ENDS1_L_FIELDS = {
  BEZ: { label: 'Bezeichnung', type: 'T' },
  WTX: { label: 'Wert oder Text folgt im nächsten Feld', type: 'T' },
  WRT: { label: 'Wert (mit 3 Nachkommastellen)', type: 'N' },
  TXT: { label: 'Text: Ergebnis', type: 'T' },
  GRP: { label: 'Gruppe', type: 'T' },
};

const ENDS1_BLOCK_NAMES = {
  P: 'Patientenstammdaten', H: 'Hauptversicherten-Daten', B: 'Behandlung/Positionen',
  D: 'Diagnosen', K: 'Karteieintragungen', L: 'Laborbefunde', V: 'Verordnungen/Rezepte',
  G: 'Geldfluss', F: 'Befunde', E: 'eCard-Konsultationsdaten', A: 'ABS-Daten', Z: 'Zahn-Daten',
};

// The spec doesn't state a text encoding. Austrian DOS/Windows practice
// software of this era conventionally used Windows-1252, so that's the
// fallback -- but we try strict UTF-8 first in case a modern export used it.
function decodeEnds1Bytes(bytes) {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch (e) {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
  }
}

// Content-based detection (not filename-based): the spec never mandates a
// specific filename for the main export file, unlike ENDS 2's fixed
// README.TXT/IHE_XDM structure. A handful of lines matching the exact
// 27-character header is a strong, cheap signal.
function looksLikeEnds1(text) {
  const lines = text.split(/\r\n|\r|\n/);
  let hits = 0;
  for (let i = 0; i < Math.min(lines.length, 200); i++) {
    if (ENDS1_LINE_RE.test(lines[i])) hits++;
    if (hits >= 3) return true;
  }
  return false;
}

// Parses every line into {patientNr, block, field, date, time, value}.
// Each field is exactly one line (CR/LF-terminated) per the spec, so this
// is a plain line-by-line parse -- no multi-line lookahead needed. Lines
// that don't match the header at all (stray blank lines, a corrupted
// line) are kept separately rather than silently dropped.
function parseEnds1Lines(text) {
  const lines = text.split(/\r\n|\r|\n/);
  const records = [];
  const unrecognizedLines = [];
  for (const line of lines) {
    if (!line) continue;
    const m = ENDS1_LINE_RE.exec(line);
    if (!m) {
      if (line.trim()) unrecognizedLines.push(line);
      continue;
    }
    const [, patientNr, fieldCode, date, time] = m;
    records.push({
      patientNr,
      block: fieldCode[1],
      field: fieldCode.slice(2),
      date,
      time,
      value: line.slice(27),
    });
  }
  return { records, unrecognizedLines };
}

// Block letter -> {dictionary, entry-list property name} for the
// repeatable blocks parsed field-by-field (Phase 3). Blocks not listed here
// (#B, #H, #K, #G, #F, #E, #A, #Z) are still counted in blockCounts, just
// not broken down field-by-field yet.
const ENDS1_REPEATABLE_BLOCKS = {
  D: { fields: ENDS1_D_FIELDS, listKey: 'diagnosen' },
  V: { fields: ENDS1_V_FIELDS, listKey: 'verordnungen' },
  L: { fields: ENDS1_L_FIELDS, listKey: 'laborbefunde' },
};

// Groups parsed records by patient number. #P fields not in ENDS1_P_FIELDS
// (e.g. a future spec revision's field code) are preserved under
// unknownFields instead of being dropped, per the "never destroy unmapped
// source data" principle. #D/#V/#L lines are grouped into entry objects and
// pushed onto that patient's diagnosen/verordnungen/laborbefunde array, in
// the order seen. Every other block (#B, #H, #K, #G, #F, #E, #A, #Z) is
// still only counted, not parsed field-by-field yet -- not this phase's scope.
//
// Boundary rule for where one repeatable entry ends and the next begins: a
// field code repeating within the same block+patient marks the start of a
// new entry (the standard rule for this kind of flat, fixed-field-order
// repeating-group format -- one entry's fields are written together, in a
// consistent order, then the next entry's fields follow). Deliberately NOT
// grouped by the (date,time) header instead: real diagnoses/prescriptions
// entered in the same visit can legitimately share the exact same
// date+time, and grouping by that would silently merge two real, distinct
// entries into one, losing data -- exactly the kind of silent loss this
// parser is built to avoid.
function buildEnds1PatientPreview(records) {
  const byPatient = new Map();
  // openEntry: patientNr -> block -> the in-progress entry object (or
  // undefined once no entry is open yet for that block).
  const openEntry = new Map();
  for (const rec of records) {
    if (!byPatient.has(rec.patientNr)) {
      byPatient.set(rec.patientNr, {
        patientNr: rec.patientNr, stammdaten: {}, unknownFields: [], blockCounts: {},
        diagnosen: [], verordnungen: [], laborbefunde: [],
      });
      openEntry.set(rec.patientNr, {});
    }
    const p = byPatient.get(rec.patientNr);
    p.blockCounts[rec.block] = (p.blockCounts[rec.block] || 0) + 1;
    const trimmed = rec.value.trim();
    if (rec.block === 'P') {
      if (ENDS1_P_FIELDS[rec.field]) p.stammdaten[rec.field] = trimmed;
      else p.unknownFields.push({ field: rec.field, value: trimmed });
      continue;
    }
    const repeatable = ENDS1_REPEATABLE_BLOCKS[rec.block];
    if (!repeatable || !repeatable.fields[rec.field]) continue;
    const patientOpenEntries = openEntry.get(rec.patientNr);
    let entry = patientOpenEntries[rec.block];
    if (!entry || rec.field in entry) {
      entry = { date: rec.date, time: rec.time };
      patientOpenEntries[rec.block] = entry;
      p[repeatable.listKey].push(entry);
    }
    entry[rec.field] = trimmed;
  }
  return [...byPatient.values()];
}

// Converts an ENDS1 date value (TTMMJJJJ, 8 digits, no separators -- the
// spec's format for #P GBD/RZD/VON/BIS etc.) to the ISO 'YYYY-MM-DD' this
// app's `patients.dob` column expects. Returns '' for anything that isn't
// exactly 8 digits (missing/placeholder dates like '00000000' included)
// rather than guessing, so a caller can tell "no usable date" apart from a
// real one instead of writing a wrong date silently.
function ends1DateToIso(value) {
  const digits = (value || '').trim();
  if (!/^\d{8}$/.test(digits)) return '';
  const day = digits.slice(0, 2), month = digits.slice(2, 4), year = digits.slice(4, 8);
  if (day === '00' || month === '00') return '';
  return year + '-' + month + '-' + day;
}

// base64 -> Uint8Array, browser-native (atob + charCodeAt) -- no Buffer
// dependency, matches how this codebase already decodes base64 elsewhere.
function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Top-level entry point: given a File (the uploaded ZIP), extracts every
// entry, runs looksLikeEnds1() detection on each text-like entry, and
// parses the ones that match. Tolerant of the export containing more than
// one matching file (e.g. Stammdaten + a separate Adressdaten file, which
// the spec explicitly allows for multi-mandant setups) by merging results
// per patient number across all matching files.
//
// maxTotalBytes guards against a zip bomb-style archive (a tiny ZIP that
// decompresses to gigabytes) -- extraction is aborted once the running
// total of decompressed bytes read exceeds this bound. Reads each entry via
// .async('base64') (not 'uint8array') to match the same JSZip entry API
// this codebase's other zip-reading code (secretary.html's confirmDocImport)
// already uses, including in tests/helpers/jszipStub.js's fake JSZip.
async function parseEnds1Zip(zipFile, { maxTotalBytes = 100 * 1024 * 1024 } = {}) {
  const buf = await zipFile.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  let totalBytes = 0;
  let encoding = null;
  const allRecords = [];
  const matchedFiles = [];
  const entryNames = Object.keys(zip.files).filter(name => !zip.files[name].dir);
  for (const name of entryNames) {
    // Skip anything that's obviously not a text export (documents/images
    // referenced from #F/#E/#A path fields live alongside the main file).
    if (/\.(pdf|jpe?g|png|gif|bmp|tiff?|docx?|xlsx?|csv)$/i.test(name)) continue;
    const base64 = await zip.files[name].async('base64');
    const bytes = base64ToBytes(base64);
    totalBytes += bytes.length;
    if (totalBytes > maxTotalBytes) {
      throw new Error('Archiv zu groß (Limit: ' + Math.round(maxTotalBytes / 1024 / 1024) + ' MB entpackt).');
    }
    const decoded = decodeEnds1Bytes(bytes);
    if (!looksLikeEnds1(decoded.text)) continue;
    encoding = encoding || decoded.encoding;
    matchedFiles.push(name);
    const { records } = parseEnds1Lines(decoded.text);
    allRecords.push(...records);
  }
  if (matchedFiles.length === 0) return null;
  const patients = buildEnds1PatientPreview(allRecords);
  const blockTotals = {};
  for (const rec of allRecords) blockTotals[rec.block] = (blockTotals[rec.block] || 0) + 1;
  return { format: 'ends1', matchedFiles, encoding, patients, blockTotals, totalRecords: allRecords.length };
}
