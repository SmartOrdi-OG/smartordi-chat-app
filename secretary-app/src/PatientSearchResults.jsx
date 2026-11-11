import { colorForName } from './lib/avatarColor';

// Shared result-row rendering for the "Weiteres Kind" owner search and the
// "QR-Code" patient picker -- mirrors npChildOwnerSearch()/qrPatientSearch()'s
// row markup.
export default function PatientSearchResults({ results, onSelect, emptyText }) {
  if (!results.length) {
    return <div style={{ padding: '14px 4px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>{emptyText || 'Keine Treffer'}</div>;
  }
  return (
    <div>
      {results.map((p) => {
        const name = p.fullName || p.name || '?';
        return (
          <div key={p.id} className="qr-patient-row" onClick={() => onSelect(p)}>
            <div className="avatar" style={{ width: 32, height: 32, fontSize: 12, background: colorForName(name) }}>
              {name[0]}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{name}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>{p.versicherung || ''}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
