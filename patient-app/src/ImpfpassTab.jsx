function fmtDate(iso) {
  return iso ? new Date(iso + 'T00:00:00').toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
}

export default function ImpfpassTab({ impfungen, loading }) {
  if (loading) return <div className="empty-state">Lädt…</div>;
  if (impfungen.length === 0) return <div className="empty-state">Keine Impfungen erfasst.</div>;

  return (
    <div className="list-col">
      {impfungen.map((imp) => (
        <div className="list-row" key={imp.id}>
          <div className="list-row-main">{imp.vaccineName}{imp.doseLabel ? ` · ${imp.doseLabel}` : ''}</div>
          <div className="list-row-sub">Geimpft am {fmtDate(imp.datum)}</div>
          {imp.nextDue && <div className="list-row-sub next-due">Nächste Auffrischung: {fmtDate(imp.nextDue)}</div>}
        </div>
      ))}
    </div>
  );
}
