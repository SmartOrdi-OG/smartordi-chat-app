import { MKP_EXAM_INFO } from './lib/mkpExams';

function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
}

function fmtValue(v) {
  if (v === true) return 'Ja';
  if (v === false) return 'Nein';
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

export default function MkpTab({ exams, loading }) {
  if (loading) return <div className="empty-state">Lädt…</div>;
  if (exams.length === 0) return <div className="empty-state">Noch keine Mutter-Kind-Pass-Untersuchungen erfasst.</div>;

  return (
    <div>
      {exams.map((ex) => {
        const info = MKP_EXAM_INFO[ex.examKey] || { title: ex.examKey, ageLabel: '' };
        const fieldEntries = Object.entries(ex.data || {});
        return (
          <div className="info-card" key={ex.examKey}>
            <div className="info-card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span>
                {info.title}
                <span style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--p-muted)', textTransform: 'none', letterSpacing: 0, marginTop: 2 }}>{info.ageLabel}</span>
              </span>
              <span className="status-badge given">{fmtDate(ex.completedAt)}</span>
            </div>
            {fieldEntries.length > 0 ? (
              fieldEntries.map(([k, v]) => (
                <div className="info-row" key={k}>
                  <span className="info-label">{k}</span>
                  <span className="info-value">{fmtValue(v)}</span>
                </div>
              ))
            ) : (
              <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--p-muted)' }}>Keine Angaben erfasst.</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
