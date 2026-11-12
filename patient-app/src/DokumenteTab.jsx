import { useState } from 'react';
import { useLanguage } from './LanguageContext';
import { patientGetDocumentFile } from './lib/patientData';

function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
}

export default function DokumenteTab({ documents, loading }) {
  const { t } = useLanguage();
  const [openingId, setOpeningId] = useState(null);

  async function handleOpen(doc) {
    setOpeningId(doc.id);
    try {
      const file = await patientGetDocumentFile(doc.id);
      if (!file || !file.base64) return;
      const byteChars = atob(file.base64);
      const bytes = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
      const blob = new Blob([bytes], { type: file.mimeType || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } finally {
      setOpeningId(null);
    }
  }

  if (loading) return <div className="empty-state">{t('common.loading')}</div>;
  if (documents.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        </div>
        <div className="empty-text">{t('dokumente.empty.title')}</div>
        <div className="empty-sub">{t('dokumente.empty.sub')}</div>
      </div>
    );
  }

  return (
    <div>
      {documents.map((d) => (
        <button key={d.id} className="doc-card" onClick={() => handleOpen(d)} disabled={openingId === d.id}>
          <span className="doc-icon-box">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          </span>
          <span className="doc-info">
            <span className="doc-title" style={{ display: 'block' }}>{d.title || d.filename}</span>
            <span className="doc-meta" style={{ display: 'block' }}>{d.category || t('dokumente.genericType')} · {fmtDate(d.createdAt)}</span>
            {openingId === d.id && <span className="doc-loading">{t('dokumente.opening')}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}
