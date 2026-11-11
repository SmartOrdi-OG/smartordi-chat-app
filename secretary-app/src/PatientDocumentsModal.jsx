import { useEffect, useRef, useState } from 'react';
import {
  DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABEL, formatFileSize,
  getDocumentsForPatient, getPatientDocumentFile, uploadPatientDocument, deletePatientDocument,
  fileToBase64, triggerFileDownload,
} from './lib/patientDocumentsData';
import { getPlanUploadMaxBytes, formatUploadMaxLabel } from './lib/patientsData';
import { showToast } from './lib/toast';

function DocRow({ doc, onDownload, onDelete }) {
  const date = new Date(doc.created_at).toLocaleDateString('de-AT');
  if (doc.body_text) {
    return (
      <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{doc.title}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>{DOCUMENT_CATEGORY_LABEL[doc.category] || doc.category} · {date}</span>
            <button type="button" onClick={() => onDelete(doc.id)} title="Löschen" style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 14, padding: 4 }}>🗑</button>
          </div>
        </div>
        <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{doc.body_text}</div>
      </div>
    );
  }
  return (
    <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 36, height: 36, background: '#EAF4F1', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>📄</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{doc.title}</div>
        <div style={{ fontSize: 11, color: '#94a3b8' }}>{DOCUMENT_CATEGORY_LABEL[doc.category] || doc.category} · {date} · {formatFileSize(doc.size_bytes)}</div>
      </div>
      <button type="button" onClick={() => onDownload(doc.id)} style={{ background: '#EAF4F1', border: '1px solid #bfdbfe', borderRadius: 7, padding: '6px 10px', fontSize: 11, fontWeight: 700, color: '#0E5E56', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>⬇ PDF</button>
      <button type="button" onClick={() => onDelete(doc.id)} title="Löschen" style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 14, padding: 4 }}>🗑</button>
    </div>
  );
}

// Mirrors doctor.html's Kartei "Dokumente" tab -- see lib/patientDocumentsData.js's
// own comment for why this is a new addition rather than a straight port
// of something secretary.html already has.
export default function PatientDocumentsModal({ patient, profile, onClose }) {
  const [docs, setDocs] = useState(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('befund');
  const [uploading, setUploading] = useState(false);
  const [maxLabel, setMaxLabel] = useState('8 MB');
  const fileInputRef = useRef(null);

  function refresh() {
    getDocumentsForPatient(patient.id).then(setDocs);
  }
  useEffect(() => {
    refresh();
    getPlanUploadMaxBytes().then((bytes) => setMaxLabel(formatUploadMaxLabel(bytes)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDownload(docId) {
    const file = await getPatientDocumentFile(docId);
    if (!file) { showToast('Datei konnte nicht geladen werden', 'error'); return; }
    await triggerFileDownload(file.filename, file.mimeType, file.base64);
  }

  async function handleDelete(docId) {
    if (!window.confirm('Dieses Dokument wirklich löschen?')) return;
    try {
      await deletePatientDocument(docId);
      refresh();
    } catch {
      showToast('Löschen fehlgeschlagen', 'error');
    }
  }

  async function handleUpload() {
    const file = fileInputRef.current?.files[0];
    if (!file) { showToast('Bitte zuerst eine PDF-Datei auswählen', 'error'); return; }
    if (file.type !== 'application/pdf') { showToast('Nur PDF-Dateien sind erlaubt', 'error'); return; }
    const maxBytes = await getPlanUploadMaxBytes();
    if (file.size > maxBytes) { showToast('Datei ist zu groß (max. ' + formatUploadMaxLabel(maxBytes) + ')', 'error'); return; }
    const trimmedTitle = title.trim();
    if (!trimmedTitle) { showToast('Bitte einen Titel eingeben', 'error'); return; }
    setUploading(true);
    try {
      const base64Data = await fileToBase64(file);
      await uploadPatientDocument(patient.id, {
        category, title: trimmedTitle, filename: file.name, mimeType: file.type, sizeBytes: file.size, base64Data,
      }, profile?.id || null);
      setTitle('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      showToast('✓ Dokument hochgeladen');
      refresh();
    } catch {
      showToast('Hochladen fehlgeschlagen', 'error');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <div className="modal-title">Dokumente — {patient.fullName || patient.name}</div>
          <button className="modal-close" type="button" onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="modal-body">
          {docs === null && <div style={{ color: '#94a3b8', fontSize: 12 }}>Lädt...</div>}
          {docs !== null && docs.length === 0 && <div style={{ color: '#94a3b8', fontSize: 12 }}>Noch keine Dokumente hochgeladen.</div>}
          {docs !== null && docs.map((d) => <DocRow key={d.id} doc={d} onDownload={handleDownload} onDelete={handleDelete} />)}

          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>Dokument hochladen</div>
            <div className="form-group">
              <label className="form-label">Titel</label>
              <input className="form-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z.B. Laborbefund 11.11.2026" />
            </div>
            <div className="form-group">
              <label className="form-label">Kategorie</label>
              <select className="form-input" value={category} onChange={(e) => setCategory(e.target.value)}>
                {DOCUMENT_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">PDF-Datei (max. {maxLabel})</label>
              <input ref={fileInputRef} type="file" className="form-input" accept=".pdf,application/pdf" />
            </div>
            <button className="rail-btn rail-btn-primary" type="button" style={{ justifyContent: 'center', width: '100%' }} disabled={uploading} onClick={handleUpload}>
              {uploading ? 'Wird hochgeladen...' : 'Hochladen'}
            </button>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-cancel" type="button" onClick={onClose}>Fertig</button>
        </div>
      </div>
    </div>
  );
}
