import { useState } from 'react';
import { patientSubmitProfileJoinRequest } from './lib/patientData';

export default function AddProfileForm({ type, practiceId, onDone, onCancel }) {
  const [fields, setFields] = useState({
    vorname: '', nachname: '', dob: '', geschlecht: '', adresse: '', svnr: '', versicherung: '',
  });
  const [relation, setRelation] = useState('father');
  const [relationLabel, setRelationLabel] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  function set(key) {
    return (e) => setFields((f) => ({ ...f, [key]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!fields.vorname || !fields.nachname || !fields.dob || !fields.adresse) {
      setError('Bitte füllen Sie Vorname, Nachname, Geburtsdatum und Adresse aus.');
      return;
    }
    setSending(true);
    try {
      const rel = type === 'child' ? 'child' : relation;
      await patientSubmitProfileJoinRequest(
        fields, practiceId, rel, rel === 'other' ? relationLabel : null
      );
      setSent(true);
    } catch (err) {
      setError('Antrag konnte nicht gesendet werden. Bitte versuchen Sie es erneut.');
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div>
        <div className="welcome-title" style={{ fontSize: 16 }}>Antrag gesendet ✓</div>
        <div className="welcome-sub">Ihre Ordination prüft die Anfrage, bevor das neue Profil erscheint.</div>
        <button className="btn-main" onClick={onDone}>Fertig</button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="welcome-title" style={{ fontSize: 16 }}>
        {type === 'child' ? 'Kind hinzufügen' : 'Erwachsene:n hinzufügen'}
      </div>

      {error && <div className="error-msg"><span>!</span><span>{error}</span></div>}

      {type !== 'child' && (
        <div className="form-group">
          <label className="form-label">Beziehung zu Ihnen</label>
          <select className="form-input" value={relation} onChange={(e) => setRelation(e.target.value)}>
            <option value="father">Vater</option>
            <option value="mother">Mutter</option>
            <option value="other">Andere</option>
          </select>
          {relation === 'other' && (
            <input
              className="form-input" style={{ marginTop: 8 }} placeholder="z. B. Großmutter"
              value={relationLabel} onChange={(e) => setRelationLabel(e.target.value)}
            />
          )}
        </div>
      )}

      <div className="form-group">
        <label className="form-label">Vorname *</label>
        <input className="form-input" value={fields.vorname} onChange={set('vorname')} />
      </div>
      <div className="form-group">
        <label className="form-label">Nachname *</label>
        <input className="form-input" value={fields.nachname} onChange={set('nachname')} />
      </div>
      <div className="form-group">
        <label className="form-label">Geburtsdatum *</label>
        <input className="form-input" type="date" max={new Date().toISOString().slice(0, 10)} value={fields.dob} onChange={set('dob')} />
      </div>
      <div className="form-group">
        <label className="form-label">Geschlecht</label>
        <select className="form-input" value={fields.geschlecht} onChange={set('geschlecht')}>
          <option value="">Keine Angabe</option>
          <option value="m">Männlich</option>
          <option value="w">Weiblich</option>
          <option value="d">Divers</option>
        </select>
      </div>
      <div className="form-group">
        <label className="form-label">Adresse *</label>
        <input className="form-input" value={fields.adresse} onChange={set('adresse')} />
      </div>
      <div className="form-group">
        <label className="form-label">Versicherungsnummer (SVNr)</label>
        <input className="form-input" value={fields.svnr} onChange={set('svnr')} />
      </div>
      <div className="form-group">
        <label className="form-label">Versicherung</label>
        <select className="form-input" value={fields.versicherung} onChange={set('versicherung')}>
          <option value="">Keine Angabe</option>
          <option value="ÖGK">ÖGK</option>
          <option value="BVAEB">BVAEB</option>
          <option value="SVS">SVS</option>
          <option value="Andere">Andere</option>
        </select>
      </div>

      <div className="booking-actions">
        <button type="button" className="btn-secondary" onClick={onCancel}>Abbrechen</button>
        <button type="submit" className="btn-main" disabled={sending}>{sending ? 'Wird gesendet…' : 'Antrag senden'}</button>
      </div>
    </form>
  );
}
