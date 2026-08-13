// Praxisdaten-Migration -- ENDS 2 (Export-Normdatensatz 2, HL7 Austria)
// parser. Phase 1: detect an IHE XDM export container inside the uploaded
// ZIP, walk it down to each patient's main CDA (Clinical Document
// Architecture) document, and parse just the patient Stammdaten
// (recordTarget/patientRole) for a read-only preview -- same scope and same
// "never guess, skip what can't be read cleanly" discipline as
// vendor/migration-normdatensatz.js's ENDS 1 Phase 1 had.
//
// Unlike ENDS 1 (flat fixed-format text lines), ENDS 2 is a folder-based
// container (IHE XDM: https://www.ihe.net/ "Distribute Document Set on
// Media") holding one or more HL7 CDA XML documents per patient, discovered
// via HTML index files rather than by scanning file contents:
//   <root>/INDEX.HTM                        -- lists every patient + a link
//                                               to their own folder's index
//   <root>/IHE_XDM/<patientFolder>/INDEX.HTM -- lists that patient's
//                                               documents (Dokumentart,
//                                               Datum, Link, MIME-Type);
//                                               the main "NDS (CDA)" row is
//                                               the patient's core document
//   <root>/IHE_XDM/<patientFolder>/<file>.xml -- the actual CDA document(s)
// <root> itself may be '' (XDM folders directly at the ZIP root) or a
// wrapper folder (e.g. a real export zipped from its own top-level folder)
// -- detected from wherever "IHE_XDM/" actually appears, not assumed fixed.
//
// Verified against a real, official ENDS 2 sample export (not a guess at
// the format): github.com/TechnikumWienAcademy/cda-ends2 (the working group
// that ran HL7 Austria's ENDS 2 workshops), xdm-beispiel/ folder.
//
// The parsed patient shape below deliberately reuses ENDS 1's stammdaten
// field keys (FNM/VNM/GBD/STR/PLZ/ORT/...) even though the source format is
// entirely different, so doctor.html's existing renderMigrationPreview()
// (and later write-phase helpers) can render/consume either format without
// forking that code per-format.

// Locates the IHE_XDM folder inside the archive and returns everything
// before it (the "root" prefix, possibly '') -- or null if this ZIP has no
// such folder at all, meaning it isn't an ENDS 2 export.
function ends2FindXdmRoot(entryNames) {
  for (const name of entryNames) {
    const norm = name.replace(/\\/g, '/');
    const idx = norm.toUpperCase().indexOf('IHE_XDM/');
    if (idx !== -1) return norm.slice(0, idx);
  }
  return null;
}

// Case-insensitive exact-path lookup against the archive's real entry names
// -- exporters vary in casing (INDEX.HTM vs Index.htm, 00000036.xml vs
// .XML in the real sample itself), so an exact-case match would silently
// miss real files rather than just being pickier.
function ends2FindEntry(entryNames, path) {
  const target = (path || '').replace(/\\/g, '/').toLowerCase();
  return entryNames.find(function (n) { return n.toLowerCase() === target; }) || null;
}

// Joins a directory prefix (already ending in '/', or '') with a relative
// href from an INDEX.HTM link -- normalizes backslashes (Windows-authored
// exports) and collapses accidental double slashes. Returns null for an
// absolute URL (http://...), which never points inside the archive.
function ends2JoinPath(baseDir, rel) {
  const relNorm = String(rel || '').replace(/\\/g, '/');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(relNorm)) return null;
  return (baseDir + relNorm).replace(/\/{2,}/g, '/');
}

function ends2Dirname(path) {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx + 1);
}

// Parses an ENDS 2 INDEX.HTM (both the top-level patient list and each
// patient's own document list use the same shape: an HTML table with one
// link per real data row). Returns only rows that actually contain a link
// -- the header row never does, so this doubles as header-skipping without
// needing to assume <th> vs. styled <td> markup.
function ends2ParseIndexRows(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const rows = Array.from(doc.querySelectorAll('table tr'));
  const out = [];
  rows.forEach(function (tr) {
    const cells = Array.from(tr.querySelectorAll('td'));
    if (!cells.length) return;
    const link = tr.querySelector('a[href]');
    if (!link) return;
    out.push({
      texts: cells.map(function (td) { return (td.textContent || '').trim(); }),
      href: link.getAttribute('href'),
    });
  });
  return out;
}

function ends2TextOf(el) {
  return el ? (el.textContent || '').trim() : '';
}

// CDA birthTime/effectiveTime values are YYYYMMDD[hhmmss[+zone]] -- only the
// date portion matters here. Returns '' (not a guess) for anything that
// isn't a real calendar date, same discipline as ends1DateToIso().
function ends2CdaDateToDisplay(value) {
  const digits = (value || '').trim();
  if (!/^\d{8}/.test(digits)) return '';
  const year = digits.slice(0, 4), month = digits.slice(4, 6), day = digits.slice(6, 8);
  if (month === '00' || day === '00') return '';
  return day + '.' + month + '.' + year;
}

// Inverse of ends2CdaDateToDisplay() -- converts the "DD.MM.YYYY" strings
// this parser puts in Stammdaten.GBD and Karteineintragungen entries' datum
// back to the ISO 'YYYY-MM-DD' the app's date columns expect. Used by
// doctor.html's write phase (confirmMigrationImport() et al.); kept here
// alongside the format it inverts rather than in doctor.html itself.
function ends2DisplayDateToIso(value) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec((value || '').trim());
  return m ? m[3] + '-' + m[2] + '-' + m[1] : '';
}

// The Diagnose section's "Zeitraum oder Zeitpunkt" column is free text --
// real values in the wild range from an exact date ("25.6.2010") to a
// vague period ("Seit Mai 1980"). Only the unambiguous D(D).M(M).YYYY shape
// is converted; anything else (including genuinely just a year or month) is
// left unparsed so the write phase skips that diagnosis rather than
// guessing which day within "Mai 1980" it actually happened.
function ends2DiagnoseZeitraumToIso(value) {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec((value || '').trim());
  if (!m) return '';
  const day = m[1].padStart(2, '0'), month = m[2].padStart(2, '0'), year = m[3];
  if (month === '00' || day === '00' || Number(month) > 12 || Number(day) > 31) return '';
  return year + '-' + month + '-' + day;
}

// Parses XML text into a Document, or null if it doesn't parse cleanly --
// shared by the Stammdaten and section parsers below so a CDA document is
// only ever parsed once per patient.
function ends2ParseXml(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) return null;
  return doc;
}

// Parses recordTarget/patientRole out of one patient's main CDA document
// into the same field keys ENDS 1's #P Stammdaten preview already uses
// (VNR for the insurance number, TL1 for phone, etc., not ENDS-2-specific
// names) -- so doctor.html's confirmMigrationImport() write phase can stay
// one shared code path instead of forking per format. Returns null if
// there's no recordTarget at all -- callers skip that patient rather than
// showing a broken/blank row.
//
// SVNR: the sample export's Sozialversicherungsnummer id carries a fixed,
// government-assigned OID (1.2.40.0.10.1.4.3.1, "Österreichische
// Sozialversicherung") rather than anything software-specific, so matching
// on that root -- not just "the first id" -- reliably picks the SVNR out
// from among a patient's other ids (local software id, etc.) even though
// id order isn't guaranteed by the spec.
const ENDS2_SVNR_ROOT = '1.2.40.0.10.1.4.3.1';
function ends2ParseCdaStammdaten(doc) {
  const patientRole = doc.querySelector('recordTarget > patientRole');
  if (!patientRole) return null;
  const nameEl = patientRole.querySelector('patient > name');
  const genderEl = patientRole.querySelector('patient > administrativeGenderCode');
  const birthEl = patientRole.querySelector('patient > birthTime');
  const addrEl = patientRole.querySelector('addr');
  const ids = Array.from(patientRole.querySelectorAll('id'));
  const svnrId = ids.find(function (el) { return el.getAttribute('root') === ENDS2_SVNR_ROOT; });
  const localId = ids[0];
  // telecom values are "tel:..."/"mailto:..." URIs -- strip the scheme so
  // the stored value matches what ENDS 1's TL1/MAL fields (and the rest of
  // the app) already expect: a bare phone number/address, no "tel:" prefix.
  const telEl = Array.from(patientRole.querySelectorAll('telecom')).find(function (t) {
    return (t.getAttribute('value') || '').startsWith('tel:');
  });
  const mailEl = Array.from(patientRole.querySelectorAll('telecom')).find(function (t) {
    return (t.getAttribute('value') || '').startsWith('mailto:');
  });
  return {
    FNM: ends2TextOf(nameEl?.querySelector('family')),
    VNM: ends2TextOf(nameEl?.querySelector('given')),
    GBD: ends2CdaDateToDisplay(birthEl?.getAttribute('value')),
    GES: genderEl?.getAttribute('code') || '',
    STR: ends2TextOf(addrEl?.querySelector('streetAddressLine')),
    PLZ: ends2TextOf(addrEl?.querySelector('postalCode')),
    ORT: ends2TextOf(addrEl?.querySelector('city')),
    VNR: svnrId?.getAttribute('extension') || '',
    TL1: (telEl?.getAttribute('value') || '').replace(/^tel:/, ''),
    MAL: (mailEl?.getAttribute('value') || '').replace(/^mailto:/, ''),
    SoftwareId: localId?.getAttribute('extension') || '',
  };
}

// ── Phase 2: Diagnose/Karteineintragungen/Rezept/Laborbefunde ──
//
// Every one of these CDA sections carries its content TWICE: a "Level 3"
// fully-coded <entry> structure (deeply nested, uses shared ELGA/IHE
// templateIds that vary a lot between vendors) and a "Level 2" human-
// readable <text><table> right above it (the same table a person reading
// the document in a browser would see). The ENDS 2 wiki minutes explicitly
// call Level 2 tables an accepted representation on their own ("derzeit in
// CDA als L2 (Tabelle) abgebildet ... L3 Abbildung der Tabelle möglich"),
// meaning some real vendor exports may have ONLY the table, no Level 3 at
// all. Parsing the table is therefore not just simpler than decoding every
// section's own Level 3 entry shape -- it's also the more robust target,
// so that's what every parser below does, falling back to the entry-level
// data only where the table genuinely doesn't carry a value the app needs
// (Karteineintragungen's per-row date, below).
//
// Columns are matched by keyword against the table's own <th> text rather
// than by fixed position -- resilient to column reordering/renaming
// between vendors without guessing at values a header doesn't actually
// name.

// Finds the (first) <section> anywhere in the document carrying a direct
// child <templateId root="templateId">. CDA sections can have several
// templateIds on one <section> (e.g. Rezept has five), so this checks
// direct children rather than assuming there's exactly one.
function ends2FindSectionByTemplateId(doc, templateId) {
  const sections = Array.from(doc.querySelectorAll('section'));
  return sections.find(function (s) {
    return s.querySelector(':scope > templateId[root="' + templateId + '"]') !== null;
  }) || null;
}

// Reads one <table>'s header names (null if it has no <thead>, e.g. the
// label/value tables Rezept uses per medication) and body rows (each a
// plain array of cell text, whitespace-collapsed).
function ends2ParseTableRows(tableEl) {
  const theadCells = Array.from(tableEl.querySelectorAll(':scope > thead > tr > th'));
  const headers = theadCells.length ? theadCells.map(function (th) { return ends2TextOf(th); }) : null;
  const bodyRows = Array.from(tableEl.querySelectorAll(':scope > tbody > tr'));
  const rows = bodyRows.map(function (tr) {
    return Array.from(tr.querySelectorAll(':scope > td')).map(function (td) {
      return (td.textContent || '').trim().replace(/\s+/g, ' ');
    });
  });
  return { headers: headers, rows: rows };
}

// Finds the first header whose text contains any of the given keywords
// (case-insensitive), returning its column index or -1 if the table has no
// header row or none matches -- callers leave that field blank rather than
// reading the wrong column.
function ends2ColumnIndex(headers, keywords) {
  if (!headers) return -1;
  return headers.findIndex(function (h) {
    const lower = h.toLowerCase();
    return keywords.some(function (kw) { return lower.includes(kw); });
  });
}

// #D-equivalent: the Diagnose section's table has one row per diagnosis
// (Zeitraum oder Zeitpunkt/Diagnosetext/Code [Codesystem]/Diagnoseart).
// "Zeitraum" is kept as the source's own free text (e.g. "Seit Mai 1980",
// "25.6.2010") rather than force-parsed into a date -- unlike ENDS 1's
// fixed TTMMJJJJ format, ENDS 2's Level 2 table has no fixed date format
// specified, and guessing at ambiguous German date phrases risks a wrong
// date more than showing the source text as-is does.
function ends2ParseDiagnosen(doc) {
  const section = ends2FindSectionByTemplateId(doc, '1.2.40.0.34.6.0.11.2.96');
  if (!section) return [];
  const table = section.querySelector(':scope > text > table');
  if (!table) return [];
  const { headers, rows } = ends2ParseTableRows(table);
  const idxZeitraum = ends2ColumnIndex(headers, ['zeitraum', 'zeitpunkt']);
  const idxText = ends2ColumnIndex(headers, ['diagnosetext']);
  const idxCode = ends2ColumnIndex(headers, ['code']);
  const idxArt = ends2ColumnIndex(headers, ['diagnoseart']);
  return rows.map(function (cells) {
    return {
      zeitraum: idxZeitraum >= 0 ? (cells[idxZeitraum] || '') : '',
      text: idxText >= 0 ? (cells[idxText] || '') : '',
      code: idxCode >= 0 ? (cells[idxCode] || '') : '',
      art: idxArt >= 0 ? (cells[idxArt] || '') : '',
    };
  }).filter(function (d) { return d.text; });
}

// Karteineintragungen ("Verlauf"-equivalent free-text chart entries): the
// table itself only has Zeilennummer/Text, no date column -- but the
// section's own Level 3 <entry> DOES record each row's real date
// (effectiveTime/low), correlated back to its table row via a shared
// integer (value[xsi:type=INT]) matching Zeilennummer. This is reading
// real, already-present correlated data (not inventing one), so it's kept
// unlike the Diagnose "Zeitraum" case above, which has no such structured
// counterpart to fall back on.
function ends2ParseKarteineintragungen(doc) {
  const section = ends2FindSectionByTemplateId(doc, '1.2.40.0.34.6.0.11.2.34');
  if (!section) return [];
  const table = section.querySelector(':scope > text > table');
  if (!table) return [];
  const { headers, rows } = ends2ParseTableRows(table);
  const idxNr = ends2ColumnIndex(headers, ['zeilennummer']);
  const idxText = ends2ColumnIndex(headers, ['text']);
  const dateByNr = {};
  Array.from(section.querySelectorAll('observation')).forEach(function (obs) {
    const valueEl = obs.querySelector(':scope > value');
    if (!valueEl || valueEl.getAttribute('xsi:type') !== 'INT') return;
    const nr = valueEl.getAttribute('value');
    const dateVal = obs.querySelector(':scope > effectiveTime > low')?.getAttribute('value');
    if (nr && dateVal) dateByNr[nr] = ends2CdaDateToDisplay(dateVal);
  });
  return rows.map(function (cells) {
    const nr = idxNr >= 0 ? (cells[idxNr] || '') : '';
    return {
      nr: nr,
      text: idxText >= 0 ? (cells[idxText] || '') : '',
      datum: dateByNr[nr] || '',
    };
  }).filter(function (k) { return k.text; });
}

// #V-equivalent: the Rezept section's <text> holds one overview table
// (Rezeptart/Gültig von/Gültig bis) followed by one label/value table per
// medication (<table ID="vpos-N">, no <thead> -- each row is [label,
// value], e.g. "Arznei Bezeichnung" -> "Ciproxin 500mg Tabletten"). Known
// German field labels are read directly (not guessed at); a vendor using
// different label text for the same concept simply won't populate that
// field, same "skip rather than guess" behavior as everywhere else here.
function ends2ParseVerordnungen(doc) {
  const section = ends2FindSectionByTemplateId(doc, '1.2.40.0.34.6.0.11.2.101');
  if (!section) return [];
  const tables = Array.from(section.querySelectorAll(':scope > text > table'));
  if (tables.length < 2) return [];
  const overview = ends2ParseTableRows(tables[0]);
  const idxVon = ends2ColumnIndex(overview.headers, ['gültig von']);
  const gueltigVon = idxVon >= 0 && overview.rows[0] ? (overview.rows[0][idxVon] || '') : '';
  return tables.slice(1).map(function (t) {
    const { rows } = ends2ParseTableRows(t);
    const kv = {};
    rows.forEach(function (cells) { if (cells.length >= 2) kv[cells[0]] = cells[1]; });
    return {
      bezeichnung: kv['Arznei Bezeichnung'] || '',
      dosierung: kv['Dosierung'] || '',
      packungen: kv['Anzahl der Packungen'] || '',
      pzn: kv['Arznei Pharmazentralnummer'] || '',
      wirkstoff: kv['Arznei Wirkstoffname (ATC Code)'] || '',
      dauer: kv['Einnahmedauer'] || '',
      datum: gueltigVon,
    };
  }).filter(function (v) { return v.bezeichnung; });
}

// #L-equivalent: "Laborparameter" is a container section holding one
// <component><section> per lab group (e.g. "Hämatologie"), each with its
// own Analyse/Ergebnis/Einheit/Referenzbereiche table -- one row per lab
// value. No per-result date exists at this level (unlike the standalone
// Laborbefund CDA documents like LAB01.XML, which are a separate,
// not-yet-parsed document type -- see TODO.md); left blank here rather
// than guessed from e.g. the document's own creation date, which need not
// be when the sample was actually drawn.
function ends2ParseLaborbefunde(doc) {
  const container = ends2FindSectionByTemplateId(doc, '1.2.40.0.34.6.0.11.2.104');
  if (!container) return [];
  const results = [];
  Array.from(container.querySelectorAll(':scope > component > section')).forEach(function (sub) {
    const gruppe = ends2TextOf(sub.querySelector(':scope > title'));
    Array.from(sub.querySelectorAll(':scope > text > table')).forEach(function (t) {
      const { headers, rows } = ends2ParseTableRows(t);
      const idxAnalyse = ends2ColumnIndex(headers, ['analyse']);
      const idxErgebnis = ends2ColumnIndex(headers, ['ergebnis']);
      const idxEinheit = ends2ColumnIndex(headers, ['einheit']);
      const idxReferenz = ends2ColumnIndex(headers, ['referenz']);
      rows.forEach(function (cells) {
        const bezeichnung = idxAnalyse >= 0 ? (cells[idxAnalyse] || '') : '';
        if (!bezeichnung) return;
        results.push({
          bezeichnung: bezeichnung,
          ergebnis: idxErgebnis >= 0 ? (cells[idxErgebnis] || '') : '',
          einheit: idxEinheit >= 0 ? (cells[idxEinheit] || '') : '',
          referenz: idxReferenz >= 0 ? (cells[idxReferenz] || '') : '',
          gruppe: gruppe,
        });
      });
    });
  });
  return results;
}

// Phase 4: secondary documents referenced from a patient's document
// INDEX.HTM besides the main NDS CDA (e.g. a standalone Laborbefund CDA
// like the real sample's LAB01.XML -- a full external lab report, much
// richer than the abbreviated Laborparameter table already embedded in the
// main document). Deliberately NOT parsed field-by-field into
// patient_lab_results: the real sample's standalone Laborbefund repeats
// several of the same values already captured from the main document's own
// Laborparameter section (e.g. the same Leukozyten/Thrombozyten row),
// and this parser has no reliable way to tell "genuinely new result" from
// "the same one restated in more detail" without guessing. Rendered as
// readable text instead and written as a Befund/document (see
// importMigrationNebendokument2() in doctor.html) -- same role ENDS 1's #F
// document findings play, and avoids ever double-counting a lab value.
//
// Renders one CDA section's Level 2 content (title + free text / tables)
// as a single readable text block. Deliberately generic (not tied to any
// specific section templateId) -- same "read what a browser/stylesheet
// would show" Level 2 discipline used everywhere else here, so any CDA
// document type ENDS 2/ELGA might reference renders sensibly instead of
// needing a bespoke parser per document type.
function ends2RenderCdaSectionText(sectionEl) {
  const title = ends2TextOf(sectionEl.querySelector(':scope > title'));
  const textEl = sectionEl.querySelector(':scope > text');
  if (!textEl) return '';
  const lines = [];
  Array.from(textEl.children).forEach(function (child) {
    const tag = child.tagName.toLowerCase();
    if (tag === 'table') {
      const { headers, rows } = ends2ParseTableRows(child);
      if (headers) lines.push(headers.join(' | '));
      rows.forEach(function (r) { if (r.some(Boolean)) lines.push(r.join(' | ')); });
    } else if (tag === 'paragraph' || tag === 'content') {
      const t = ends2TextOf(child);
      if (t) lines.push(t);
    }
  });
  if (!lines.length) {
    const plain = ends2TextOf(textEl);
    if (plain) lines.push(plain);
  }
  if (!lines.length) return '';
  return (title ? title + ':\n' : '') + lines.join('\n');
}

// Walks every titled section in a CDA document and joins their rendered
// Level 2 text, section by section -- the full readable content of a
// document this parser has no dedicated field-by-field reader for.
function ends2RenderCdaDocumentText(doc) {
  const sections = Array.from(doc.querySelectorAll('section')).filter(function (s) {
    return s.querySelector(':scope > title');
  });
  return sections.map(ends2RenderCdaSectionText).filter(Boolean).join('\n\n');
}

// Quick, cheap format check -- used by handleMigrationZipFile() to decide
// whether to even attempt the (more expensive) full parseEnds2Zip() walk,
// same role looksLikeEnds1() plays for the other format.
function looksLikeEnds2Zip(entryNames) {
  return ends2FindXdmRoot(entryNames) !== null;
}

// Top-level entry point, mirroring parseEnds1Zip()'s shape (same
// {format, matchedFiles, patients, blockTotals, totalRecords, encoding}
// result contract) so doctor.html's handleMigrationZipFile() can try one
// parser, then the other, without needing per-format branches beyond that.
// Reads INDEX.HTM/CDA files at once (not lazily) since Phase 1 is preview
// scope only -- a handful of small HTML/XML files, not a whole archive's
// worth of attached documents like ENDS 1's #F handling has to guard
// against; maxTotalBytes still guards the decompressed-size budget.
async function parseEnds2Zip(zipFile, { maxTotalBytes = 100 * 1024 * 1024 } = {}) {
  const buf = await zipFile.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const entryNames = Object.keys(zip.files).filter(function (name) { return !zip.files[name].dir; });
  const root = ends2FindXdmRoot(entryNames);
  if (root === null) return null;
  const rootIndexPath = ends2FindEntry(entryNames, root + 'INDEX.HTM');
  if (!rootIndexPath) return null;

  let totalBytes = 0;
  async function readText(entryPath) {
    const base64 = await zip.files[entryPath].async('base64');
    const bytes = base64ToBytes(base64);
    totalBytes += bytes.length;
    if (totalBytes > maxTotalBytes) {
      throw new Error('Archiv zu groß (Limit: ' + Math.round(maxTotalBytes / 1024 / 1024) + ' MB entpackt).');
    }
    // ENDS 2's workshops explicitly settled on UTF-8 as mandatory for all
    // content (unlike ENDS 1, which needed real encoding sniffing) -- see
    // TODO.md/the ENDS 2 wiki minutes.
    return new TextDecoder('utf-8').decode(bytes);
  }

  const rootHtml = await readText(rootIndexPath);
  const patientRows = ends2ParseIndexRows(rootHtml);
  const patients = [];
  for (const row of patientRows) {
    const joined = ends2JoinPath(root, row.href);
    const patientIndexPath = joined && ends2FindEntry(entryNames, joined);
    if (!patientIndexPath) continue;
    const patientDir = ends2Dirname(patientIndexPath);
    const patientHtml = await readText(patientIndexPath);
    const docRows = ends2ParseIndexRows(patientHtml);
    if (!docRows.length) continue;
    // The wiki's Meeting 6 decision fixes "Datenbankexport" (the main NDS
    // CDA doc) as the index's first row, but matching by Dokumentart
    // containing "NDS" is more robust than blindly trusting row order.
    const mainDocRow = docRows.find(function (r) { return /nds/i.test(r.texts[0] || ''); }) || docRows[0];
    const cdaJoined = ends2JoinPath(patientDir, mainDocRow.href);
    const cdaPath = cdaJoined && ends2FindEntry(entryNames, cdaJoined);
    if (!cdaPath) continue;
    const cdaXml = await readText(cdaPath);
    const cdaDoc = ends2ParseXml(cdaXml);
    if (!cdaDoc) continue;
    const stammdaten = ends2ParseCdaStammdaten(cdaDoc);
    if (!stammdaten) continue;

    // Phase 4: every OTHER document row in this patient's own index (e.g.
    // "Laborbefund" -> LAB01.XML) besides the main NDS CDA already handled
    // above -- rendered as readable text (see ends2RenderCdaDocumentText())
    // rather than field-parsed, for the duplicate-data reason explained on
    // that function. A row whose file can't be resolved in the ZIP still
    // gets an entry (fileFound:false) instead of being silently dropped,
    // same discipline as ENDS 1's #F document findings.
    const befunde = [];
    for (const docRow of docRows) {
      if (docRow === mainDocRow) continue;
      const title = docRow.texts[0] || 'Dokument';
      const datum = docRow.texts[1] || '';
      const otherJoined = ends2JoinPath(patientDir, docRow.href);
      const otherPath = otherJoined && ends2FindEntry(entryNames, otherJoined);
      if (!otherPath) {
        befunde.push({ title, datum, bodyText: '', fileFound: false });
        continue;
      }
      const otherXml = await readText(otherPath);
      const otherDoc = ends2ParseXml(otherXml);
      befunde.push({ title, datum, bodyText: otherDoc ? ends2RenderCdaDocumentText(otherDoc) : '', fileFound: true });
    }

    patients.push({
      stammdaten,
      diagnosen: ends2ParseDiagnosen(cdaDoc),
      karteineintragungen: ends2ParseKarteineintragungen(cdaDoc),
      verordnungen: ends2ParseVerordnungen(cdaDoc),
      laborbefunde: ends2ParseLaborbefunde(cdaDoc),
      befunde,
      // ENDS 1's #P dictionary can contain fields this app doesn't map
      // (see legacyHistory in doctor.html's confirmMigrationImport());
      // ENDS 2's Stammdaten comes from fixed CDA elements with no such
      // open-ended dictionary, so there's nothing to preserve here -- kept
      // as an empty array (not omitted) so confirmMigrationImport()'s
      // shared unmapped.length/legacyFieldCount logic works unchanged.
      unknownFields: [],
    });
  }
  if (!patients.length) return null;
  return { format: 'ends2', matchedFiles: [rootIndexPath], encoding: 'utf-8', patients, blockTotals: {}, totalRecords: patients.length };
}
