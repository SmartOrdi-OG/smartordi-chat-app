import { useState } from 'react';
import { patientChangePassword, patientChangeUsername } from './lib/patientAuth';

export default function PasswordChangeForm({ currentUsername, onDone, onCancel }) {
  const [newUsername, setNewUsername] = useState(currentUsername || '');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (newPw.length < 6) {
      setError('Das Passwort muss mindestens 6 Zeichen lang sein.');
      return;
    }
    if (newPw !== confirmPw) {
      setError('Die Passwörter stimmen nicht überein.');
      return;
    }
    setSaving(true);
    try {
      if (newUsername.trim() && newUsername.trim().toLowerCase() !== (currentUsername || '').toLowerCase()) {
        const result = await patientChangeUsername(newUsername.trim().toLowerCase());
        if (!result.ok) {
          setError(
            result.code === 'too_short' ? 'Benutzername ist zu kurz.'
              : result.code === 'taken' ? 'Dieser Benutzername ist bereits vergeben.'
              : 'Benutzername konnte nicht geändert werden.'
          );
          setSaving(false);
          return;
        }
      }
      const ok = await patientChangePassword(newPw);
      if (!ok) {
        setError('Passwort konnte nicht geändert werden. Bitte versuchen Sie es erneut.');
        setSaving(false);
        return;
      }
      setSuccess('Passwort erfolgreich geändert.');
      setNewPw('');
      setConfirmPw('');
      setTimeout(onDone, 1200);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="welcome-title" style={{ fontSize: 16 }}>Passwort ändern</div>
      <div className="welcome-sub">Ihr Passwort ist nur für Sie sichtbar — die Ordination hat keinen Zugriff darauf.</div>

      {error && <div className="error-msg"><span>!</span><span>{error}</span></div>}
      {success && <div className="notice" style={{ color: '#166534', background: '#dcfce7', borderColor: '#bbf7d0' }}>{success}</div>}

      <div className="form-group">
        <label className="form-label">Benutzername</label>
        <input className="form-input" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">Neues Passwort</label>
        <input className="form-input" type="password" placeholder="Mindestens 6 Zeichen" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">Passwort bestätigen</label>
        <input className="form-input" type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
      </div>

      <div className="booking-actions">
        <button type="button" className="btn-secondary" onClick={onCancel}>Abbrechen</button>
        <button type="submit" className="btn-main" disabled={saving}>{saving ? 'Speichert…' : 'Speichern'}</button>
      </div>
    </form>
  );
}
