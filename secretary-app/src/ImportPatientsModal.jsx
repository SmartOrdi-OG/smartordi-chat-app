import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IMPORT_FIELDS, guessFieldForHeader, parseCsv, runImport, summarizeResults } from './lib/importData';
import { getPlanLabelAndLimit } from './lib/patientsData';
import { fetchPracticeAdminFach } from './lib/staffAuth';
import { showToast } from './lib/toast';

const PLACEHOLDER_CSV = 'Vorname,Nachname,Geburtsdatum,SVNr,Versicherung,Telefon,Diagnosen,Allergien\nJulia,Fürst,05.05.1990,7777 050590,BVAEB,+43 660 999 8888,Migräne,';

// Mirrors secretary.html's "Patienten importieren" 3-step wizard
// (openImportModal()/proceedToMapping()/confirmImport()/
// renderImportResults()). Phase 20 adds the Impfungen/Termine/
// Behandlungsverlauf CSV columns; Phase 24 adds Blutgruppe/
// Krankengeschichte -- see lib/importData.js's own comment.
export default function ImportPatientsModal({ profile, onClose, onImported }) {
  const [step, setStep] = useState(1);
  const [csvText, setCsvText] = useState('');
  const [parsed, setParsed] = useState(null);
  const [mapping, setMapping] = useState([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(null);
  const [resultSummary, setResultSummary] = useState('');
  const [results, setResults] = useState([]);
  const fileInputRef = useRef(null);

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsvText(reader.result);
    reader.readAsText(file);
  }

  function proceedToMapping() {
    const text = csvText.trim();
    if (!text) { showToast('Bitte eine CSV-Datei hochladen oder Text einfügen', 'error'); return; }
    const p = parseCsv(text);
    if (!p.headers.length || !p.rows.length) { showToast('Keine Daten gefunden', 'error'); return; }
    setParsed(p);
    setMapping(p.headers.map(guessFieldForHeader));
    setStep(2);
  }

  const hasVorname = mapping.includes('vorname');
  const hasNachname = mapping.includes('nachname');
  const usedFields = parsed ? IMPORT_FIELDS.filter((f) => f.key && mapping.includes(f.key)) : [];
  const previewRows = parsed ? parsed.rows.slice(0, 5) : [];

  function setMappingAt(idx, value) {
    setMapping((m) => m.map((v, i) => (i === idx ? value : v)));
  }

  async function handleImport() {
    const vornameIdx = mapping.indexOf('vorname');
    const nachnameIdx = mapping.indexOf('nachname');
    if (vornameIdx === -1 || nachnameIdx === -1) { showToast('Vorname und Nachname müssen zugeordnet werden', 'error'); return; }
    const fieldIdx = {};
    IMPORT_FIELDS.forEach((f) => { if (f.key) fieldIdx[f.key] = mapping.indexOf(f.key); });

    setImporting(true);
    setProgress({ current: 0, total: parsed.rows.length });
    try {
      const fach = await fetchPracticeAdminFach();
      const { results: res, skipped, ...termineStats } = await runImport(parsed.rows, fieldIdx, fach, profile?.id, (current, total) => setProgress({ current, total }));
      const { label, limit } = await getPlanLabelAndLimit();
      setResults(res);
      setResultSummary(summarizeResults(res, skipped, label, limit, termineStats));
      setStep(3);
      onImported();
    } finally {
      setImporting(false);
      setProgress(null);
    }
  }

  function handlePrint() {
    const root = document.getElementById('printAreaImport');
    if (!root) return;
    root.classList.add('print-active');
    window.print();
    root.classList.remove('print-active');
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 640 }}>
        <div className="modal-header">
          <div className="modal-title">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-2px' }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg> Patienten importieren
          </div>
          <button className="modal-close" type="button" onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="modal-body">
          {step === 1 && (
            <>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12, lineHeight: 1.6 }}>
                Exportieren Sie Ihre Patientenliste aus Ihrem alten System als CSV-Datei (erste Zeile = Spaltenüberschriften) und laden Sie sie hier hoch. Im nächsten Schritt ordnen Sie die Spalten den passenden Feldern zu — nichts wird automatisch übernommen, ohne dass Sie es sehen.
              </div>
              <div className="form-group">
                <label className="form-label">CSV-Datei</label>
                <input ref={fileInputRef} type="file" className="form-input" accept=".csv,text/csv" onChange={handleFile} />
              </div>
              <div className="form-group">
                <label className="form-label">...oder CSV-Text einfügen</label>
                <textarea
                  className="form-input" rows={6} style={{ fontFamily: 'monospace', fontSize: 11 }}
                  placeholder={PLACEHOLDER_CSV} value={csvText} onChange={(e) => setCsvText(e.target.value)}
                />
              </div>
            </>
          )}

          {step === 2 && parsed && (
            <>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>Ordnen Sie jede Spalte Ihrer Datei dem passenden Feld zu. Wählen Sie "Ignorieren" für Spalten, die nicht übernommen werden sollen.</div>
              <div style={{ marginBottom: 14 }}>
                {parsed.headers.map((h, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <div style={{ flex: 1, fontSize: 12, fontWeight: 600, color: '#0f172a' }}>{h}</div>
                    <select className="form-input" style={{ flex: 1 }} value={mapping[i]} onChange={(e) => setMappingAt(i, e.target.value)}>
                      {IMPORT_FIELDS.map((f) => <option key={f.key || 'ignore'} value={f.key}>{f.label}</option>)}
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
              <div style={{ fontSize: 12, marginTop: 8, color: (!hasVorname || !hasNachname) ? '#dc2626' : '#64748b' }}>
                {parsed.rows.length} Zeilen erkannt.{(!hasVorname || !hasNachname) ? ' Vorname und Nachname müssen zugeordnet werden.' : ''}
              </div>
              {importing && progress && (
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>Importiere {progress.current} von {progress.total} Patient(en)...</div>
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
                  <thead><tr><th style={{ textAlign: 'left', padding: 6, borderBottom: '1px solid #e2e8f0' }}>Name</th><th style={{ textAlign: 'left', padding: 6, borderBottom: '1px solid #e2e8f0' }}>Benutzername</th><th style={{ textAlign: 'left', padding: 6, borderBottom: '1px solid #e2e8f0' }}>Passwort</th></tr></thead>
                  <tbody>
                    {results.map((r, i) => (
                      <tr key={i}>
                        <td style={{ padding: 6, borderBottom: '1px solid #f1f5f9' }}>
                          {r.name}
                          {r.updated && !r.syncFailed && <span style={{ color: '#0369a1', fontWeight: 700 }} title="Bestehender Patient aktualisiert"> ↻</span>}
                          {r.syncFailed && <span style={{ color: '#dc2626', fontWeight: 700 }} title="Serverabgleich fehlgeschlagen"> ⚠</span>}
                          {r.historyFailed && <span style={{ color: '#d97706', fontWeight: 700 }} title="Impfung/Termin/Verlaufseintrag konnte nicht gespeichert werden -- Kartei manuell prüfen"> ⚠</span>}
                          {r.limitReached && <span style={{ color: '#dc2626', fontWeight: 700 }} title="Patientenlimit erreicht"> ✕</span>}
                        </td>
                        <td style={{ padding: 6, borderBottom: '1px solid #f1f5f9', fontFamily: 'monospace' }}>{r.limitReached ? '—' : r.username}</td>
                        <td style={{ padding: 6, borderBottom: '1px solid #f1f5f9', fontFamily: 'monospace' }}>{(r.updated || r.limitReached) ? '—' : r.password}</td>
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
              <button className="btn-confirm" type="button" disabled={importing || !hasVorname || !hasNachname} onClick={handleImport}>
                {importing ? 'Importiere...' : 'Importieren'}
              </button>
            </>
          )}
          {step === 3 && (
            <>
              <button className="btn-cancel" type="button" onClick={onClose}>Fertig</button>
              <button className="btn-confirm" type="button" onClick={handlePrint}>🖨 Liste drucken</button>
            </>
          )}
        </div>
      </div>
      {createPortal(
        <div id="printAreaImport">
          <h2 style={{ fontFamily: 'Segoe UI, system-ui, sans-serif', marginBottom: 10 }}>Smartordi.chat — Zugangsdaten (Import)</h2>
          <table>
            <thead><tr><th>Name</th><th>Benutzername</th><th>Passwort</th></tr></thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i}><td>{r.name}</td><td>{r.username}</td><td>{r.updated ? '— (aktualisiert)' : r.password}</td></tr>
              ))}
            </tbody>
          </table>
        </div>,
        document.body,
      )}
    </div>
  );
}
