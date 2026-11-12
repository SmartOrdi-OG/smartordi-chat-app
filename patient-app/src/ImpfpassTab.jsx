import { useLanguage } from './LanguageContext';

function fmtDate(iso) {
  return iso ? new Date(iso + 'T00:00:00').toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
}

export default function ImpfpassTab({ impfungen, loading }) {
  const { t } = useLanguage();
  if (loading) return <div className="empty-state">{t('common.loading')}</div>;
  if (impfungen.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="M12 8v6"/><path d="M9 11h6"/></svg>
        </div>
        <div className="empty-text">{t('impfungen.empty.title')}</div>
        <div className="empty-sub">{t('impfungen.empty.sub')}</div>
      </div>
    );
  }

  return (
    <div className="info-card">
      <div className="info-card-header" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="M12 8v6"/><path d="M9 11h6"/></svg>
        <span>{t('impfungen.title')}</span>
      </div>
      {impfungen.map((imp) => (
        <div className="info-row" key={imp.id}>
          <span className="info-label">{imp.vaccineName}{imp.doseLabel ? ` · ${imp.doseLabel}` : ''}</span>
          <span className="info-value" style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
            <span style={{ color: '#94a3b8', fontWeight: 400 }}>
              {fmtDate(imp.datum)}{imp.nextDue ? ` · ${t('impfungen.next')}: ${fmtDate(imp.nextDue)}` : ''}
            </span>
            <span className="status-badge given">{t('impfungen.given')}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
