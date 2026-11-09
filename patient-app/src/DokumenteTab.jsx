import { useEffect, useState } from 'react';
import { patientGetDocumentFile } from './lib/patientData';

function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
}

export default function DokumenteTab({ documents, loading }) {
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

  if (loading) return <div className="empty-state">Lädt…</div>;
  if (documents.length === 0) return <div className="empty-state">Keine Dokumente vorhanden.</div>;

  return (
    <div className="list-col">
      {documents.map((d) => (
        <button key={d.id} className="list-row list-row-button" onClick={() => handleOpen(d)} disabled={openingId === d.id}>
          <div className="list-row-main">{d.title || d.filename}</div>
          <div className="list-row-sub">{d.category || 'Dokument'} · {fmtDate(d.createdAt)}</div>
          {openingId === d.id && <span className="list-row-loading">Öffnet…</span>}
        </button>
      ))}
    </div>
  );
}
