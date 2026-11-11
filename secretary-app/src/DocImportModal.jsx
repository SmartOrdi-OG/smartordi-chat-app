import { useEffect, useRef, useState } from 'react';
import {
  DOC_IMPORT_FIELDS, guessFieldForDocHeader, loadZipFileEntries, runDocImport, summarizeDocResults,
} from './lib/documentsData';
import { parseCsv } from './lib/importData';
import { getPlanUploadMaxBytes, formatUploadMaxLabel } from './lib/patientsData';
import { showToast } from './lib/toast';

const PLACEHOLDER_CSV = 'Dateiname,SV-Nummer,Vorname,Nachname,Titel,Kategorie\nbefund_fuerst.pdf,7777 050590,Julia,Fürst,Laborbefund,befund';

// Mirrors secretary.html's "Dokumente importieren" 3-step wizard
// (openDocImportModal()/proceedToDocMapping()/confirmDocImport()/
// renderDocImportResults()). Distinct from ImportPatientsModal: this never
// creates a patient account, it only attaches files to patients that
// already exist (matched by SVNr, or Vor-/Nachname + Geburtsdatum when
// ambiguous).
export default function DocImportModal({ onClose }) {
  const [step, setStep] = useState(1);
  const [zipEntries, setZipEntries] = useState(null);
  const [zipStatus, setZipStatus] = useState('');
  const [csvText, setCsvText] = useState('');
  const [parsed, setParsed] = useState(null);
  const [mapping, setMapping] = useState([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(null);
  const [resultSummary, setResultSummary] = useState('');
  const [results, setResults] = useState([]);
  const [maxLabel, setMaxLabel] = useState('8 MB');
  const zipInputRef = useRef(null);

  useEffect(() => {
    getPlanUploadMaxBytes().then((bytes) => setMaxLabel(formatUploadMaxLabel(bytes)));
  }, []);

  async function handleZipFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setZipStatus('Wird gelesen...');
    try {
      const entries = await loadZipFileEntries(file);
      setZipEntries(entries);
      setZipStatus(new Set(Object.values(entries)).size + ' Datei(en) im ZIP gefunden.');
    } catch (err) {
      console.error('Doc import: ZIP parsing failed', err);
      setZipEntries(null);
      setZipStatus('ZIP-Datei konnte nicht gelesen werden.');
    }
  }

  function handleManifestFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsvText(reader.result);
    reader.readAsText(file);
  }

  function proceedToMapping() {
    if (!zipEntries) { showToast('Bitte zuerst eine ZIP-Datei hochladen', 'error'); return; }
    const text = csvText.trim();
    if (!text) { showToast('Bitte eine Manifest-CSV-Datei hochladen oder Text einfügen', 'error'); return; }
    const p = parseCsv(text);
    if (!p.headers.length || !p.rows.length) { showToast('Keine Daten gefunden', 'error'); return; }
    setParsed(p);
    setMapping(p.headers.map(guessFieldForDocHeader));
    setStep(2);
  }

  const hasFilename = mapping.includes('filename');
  const hasSvnr = mapping.includes('svnr');
  const hasVorname = mapping.includes('vorname');
  const hasNachname = mapping.includes('nachname');
  const canMatch = hasSvnr || (hasVorname && hasNachname);
  const usedFields = parsed ? DOC_IMPORT_FIELDS.filter((f) => f.key && mapping.includes(f.key)) : [];
  const previewRows = parsed ? parsed.rows.slice(0, 5) : [];

  function setMappingAt(idx, value) {
    setMapping((m) => m.map((v, i) => (i === idx ? value : v)));
  }

  async function handleImport() {
    const filenameIdx = mapping.indexOf('filename');
    if (filenameIdx === -1) { showToast('Dateiname muss zugeordnet werden', 'error'); return; }
    const fieldIdx = {};
    DOC_IMPORT_FIELDS.forEach((f) => { if (f.key) fieldIdx[f.key] = mapping.indexOf(f.key); });

    setImporting(true);
    setProgress({ current: 0, total: parsed.rows.length });
    try {
      const res = await runDocImport(parsed.rows, fieldIdx, zipEntries, (current, total) => setProgress({ current, total }));
      setResults(res);
      setResultSummary(summarizeDocResults(res));
      setStep(3);
    } finally {
      setImporting(false);
      setProgress(null);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 640 }}>
        <div className="modal-header">
          <div className="modal-title">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-2px' }}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg> Dokumente importieren
          </div>
          <button className="modal-close" type="button" onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="modal-body">
          {step === 1 && (
            <>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12, lineHeight: 1.6 }}>
                Laden Sie ein ZIP-Archiv mit den PDF-/Bild-Dateien (PDF, PNG, JPG, je max. {maxLabel}) hoch, sowie eine CSV-Tabelle ("Manifest"), die jeden Dateinamen im ZIP einem Patienten (per SV-Nummer oder Vor-/Nachname) zuordnet. Es werden nur Dokumente bereits bestehender Patienten übernommen — es werden dabei keine neuen Patientenkonten angelegt. Bei Namensgleichheit zusätzlich das Geburtsdatum angeben, sonst wird die Zeile sicherheitshalber als "kein passender Patient gefunden" übersprungen.
              </div>
              <div className="form-group">
                <label className="form-label">ZIP-Datei mit den Dokumenten</label>
                <input ref={zipInputRef} type="file" className="form-input" accept=".zip,application/zip" onChange={handleZipFile} />
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{zipStatus}</div>
              </div>
              <div className="form-group">
                <label className="form-label">Manifest-CSV-Datei</label>
                <input type="file" className="form-input" accept=".csv,text/csv" onChange={handleManifestFile} />
              </div>
              <div className="form-group">
                <label className="form-label">...oder Manifest-CSV-Text einfügen</label>
                <textarea
                  className="form-input" rows={6} style={{ fontFamily: 'monospace', fontSize: 11 }}
                  placeholder={PLACEHOLDER_CSV} value={csvText} onChange={(e) => setCsvText(e.target.value)}
                />
              </div>
            </>
          )}

          {step === 2 && parsed && (
            <>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>Ordnen Sie jede Spalte des Manifests dem passenden Feld zu. Wählen Sie "Ignorieren" für Spalten, die nicht übernommen werden sollen.</div>
              <div style={{ marginBottom: 14 }}>
                {parsed.headers.map((h, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <div style={{ flex: 1, fontSize: 12, fontWeight: 600, color: '#0f172a' }}>{h}</div>
                    <select className="form-input" style={{ flex: 1 }} value={mapping[i]} onChange={(e) => setMappingAt(i, e.target.value)}>
                      {DOC_IMPORT_FIELDS.map((f) => <option key={f.key || 'ignore'} value={f.key}>{f.label}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>Vorschau (erste 5 Zeilen)</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead><tr>{usedFields.map((f) => <th key={f.key} style={{ textAlign: 'left', padding: 5, borderBottom: '1px solid #e2e8f0' }}>{f.label}</th>)}</tr></thead>
                  <tbody>
                    {previewRows.map((row, ri) => (
                      <tr key={ri}>
                        {usedFields.map((f) => <td key={f.key} style={{ padding: 5, borderBottom: '1px solid #f1f5f9' }}>{row[mapping.indexOf(f.key)] || ''}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: 12, marginTop: 8, color: (!hasFilename || !canMatch) ? '#dc2626' : '#64748b' }}>
                {parsed.rows.length} Zeilen erkannt.
                {!hasFilename ? ' Dateiname muss zugeordnet werden.' : (!canMatch ? ' SV-Nummer oder Vorname+Nachname müssen zugeordnet werden.' : '')}
              </div>
              {importing && progress && (
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>Importiere {progress.current} von {progress.total} Dokument(en)...</div>
              )}
            </>
          )}

          {step === 3 && (
            <>
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: 12, fontSize: 12, color: '#15803d', fontWeight: 600, marginBottom: 14 }}>
                {resultSummary}
              </div>
              <div style={{ overflowX: 'auto', maxHeight: 280, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead><tr><th style={{ textAlign: 'left', padding: 6, borderBottom: '1px solid #e2e8f0' }}>Dateiname</th><th style={{ textAlign: 'left', padding: 6, borderBottom: '1px solid #e2e8f0' }}>Patient</th><th style={{ textAlign: 'left', padding: 6, borderBottom: '1px solid #e2e8f0' }}>Status</th></tr></thead>
                  <tbody>
                    {results.map((r, i) => (
                      <tr key={i}>
                        <td style={{ padding: 6, borderBottom: '1px solid #f1f5f9' }}>{r.filename}</td>
                        <td style={{ padding: 6, borderBottom: '1px solid #f1f5f9' }}>{r.patient}</td>
                        <td style={{ padding: 6, borderBottom: '1px solid #f1f5f9', color: r.ok ? '#15803d' : '#dc2626' }}>{r.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          {step === 1 && (
            <>
              <button className="btn-cancel" type="button" onClick={onClose}>Abbrechen</button>
              <button className="btn-confirm" type="button" onClick={proceedToMapping}>Weiter →</button>
            </>
          )}
          {step === 2 && (
            <>
              <button className="btn-cancel" type="button" onClick={() => setStep(1)}>← Zurück</button>
              <button className="btn-confirm" type="button" disabled={importing || !hasFilename || !canMatch} onClick={handleImport}>
                {importing ? 'Importiere...' : 'Importieren'}
              </button>
            </>
          )}
          {step === 3 && (
            <button className="btn-cancel" type="button" onClick={onClose}>Fertig</button>
          )}
        </div>
      </div>
    </div>
  );
}
