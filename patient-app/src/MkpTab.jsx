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
      <div className="welcome-sub" style={{ marginBottom: 12 }}>
        Nur zur Ansicht — ausgefüllt von Ihrer Kinderärztin/Ihrem Kinderarzt.
      </div>
      <div className="list-col">
        {exams.map((ex) => {
          const info = MKP_EXAM_INFO[ex.examKey] || { title: ex.examKey, ageLabel: '' };
          const fieldEntries = Object.entries(ex.data || {});
          return (
            <div className="list-row" key={ex.examKey}>
              <div className="list-row-main">{info.title}</div>
              <div className="list-row-sub">{info.ageLabel} · {fmtDate(ex.completedAt)}</div>
              {fieldEntries.length > 0 && (
                <div className="mkp-fields">
                  {fieldEntries.map(([k, v]) => (
                    <div className="mkp-field-row" key={k}>
                      <span>{k}</span><span>{fmtValue(v)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
