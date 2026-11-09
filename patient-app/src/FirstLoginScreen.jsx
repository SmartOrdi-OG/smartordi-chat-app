import { useState } from 'react';
import { patientChangePassword, patientChangeUsername, patientGetProfile, patientRecordLoginConsent } from './lib/patientAuth';
import { POLICY_VERSION } from './lib/patientRegister';

// Mirrors patient-login.html's screen-changepw + saveNewPw() -- the
// mandatory step between a first real login (QR-provisioned temp password,
// or a self-registered account's first login after the login-consent
// feature shipped) and the portal. Whether the mandatory Anamnese
// questionnaire comes next is decided by the caller (App.jsx, from the
// needsAnamnese flag resolveLogin() already computed) -- this screen just
// reports the freshly-updated profile back via onDone once password/
// username/consent are handled.
export default function FirstLoginScreen({ profile, needsUsername, needsPassword, needsConsent, onDone }) {
  const [username, setUsername] = useState(needsUsername ? '' : profile.username);
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [consentProcessing, setConsentProcessing] = useState(false);
  const [consentAccuracy, setConsentAccuracy] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const isChild = !!profile.isChild;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (needsConsent && (!consentProcessing || !consentAccuracy)) {
      setError('Bitte bestätigen Sie beide Punkte, um fortzufahren.');
      return;
    }

    if (needsPassword) {
      if (newPw.length < 6) {
        setError('Passwort muss mindestens 6 Zeichen haben.');
        return;
      }
      if (newPw !== confirmPw) {
        setError('Passwörter stimmen nicht überein.');
        return;
      }
      if (needsUsername && !username.trim()) {
        setError('Bitte wählen Sie einen Benutzernamen.');
        return;
      }
    }

    setSaving(true);
    try {
      if (needsPassword) {
        const trimmed = username.trim().toLowerCase();
        if (trimmed && trimmed !== profile.username) {
          const result = await patientChangeUsername(trimmed);
          if (!result.ok) {
            setError(
              result.code === 'too_short' ? 'Benutzername muss mindestens 3 Zeichen haben.'
                : result.code === 'taken' ? 'Dieser Benutzername ist bereits vergeben.'
                : 'Benutzername konnte nicht geändert werden.'
            );
            setSaving(false);
            return;
          }
        }
        const ok = await patientChangePassword(newPw);
        if (!ok) {
          setError('Passwort konnte nicht gespeichert werden. Bitte versuchen Sie es erneut.');
          setSaving(false);
          return;
        }
      }

      if (needsConsent) {
        const consentOk = await patientRecordLoginConsent(POLICY_VERSION);
        if (!consentOk) {
          setError('Passwort konnte nicht gespeichert werden. Bitte versuchen Sie es erneut.');
          setSaving(false);
          return;
        }
      }

      const updated = await patientGetProfile();
      onDone(updated || profile);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <div className="card-logo">
        <img src="/logo..jpeg" alt="Logo" className="card-logo-img" />
        <div className="card-logo-text">Smartordi<span>.chat</span></div>
      </div>

      <div className="welcome-title">{needsPassword ? (isChild ? 'Konto für Ihr Kind einrichten' : 'Neues Passwort wählen') : 'Ihre Zustimmung ist erforderlich'}</div>
      <div className="welcome-sub">
        {needsPassword
          ? (isChild
            ? 'Bitte wählen Sie einen Benutzernamen und ein Passwort für das Konto Ihres Kindes. Die Ordination wird keinen Zugriff darauf haben.'
            : 'Bitte wählen Sie ein persönliches Passwort. Die Ordination wird keinen Zugriff darauf haben.')
          : 'Bitte bestätigen Sie die folgenden Punkte, um fortzufahren.'}
      </div>

      {error && <div className="error-msg"><span>!</span><span>{error}</span></div>}

      <form onSubmit={handleSubmit}>
        {needsPassword && (
          <>
            <div className="form-group">
              <label className="form-label" htmlFor="newUsername">Benutzername</label>
              <div className="input-wrap">
                <input
                  id="newUsername" className="form-input" autoCapitalize="off" autoCorrect="off" spellCheck={false}
                  value={username} onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              {needsUsername && (
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>
                  Bitte wählen Sie einen Benutzernamen für {isChild ? 'dieses Konto' : 'Ihr Konto'}.
                </div>
              )}
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="newPw">Neues Passwort</label>
              <div className="input-wrap">
                <input
                  id="newPw" className="form-input" type="password" placeholder="Mindestens 6 Zeichen"
                  value={newPw} onChange={(e) => setNewPw(e.target.value)}
                />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="confirmPw">Passwort bestätigen</label>
              <div className="input-wrap">
                <input
                  id="confirmPw" className="form-input" type="password" placeholder="Passwort wiederholen"
                  value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)}
                />
              </div>
            </div>
          </>
        )}

        {needsConsent && (
          <div className="form-group">
            <label className="checkbox-label" style={{ marginBottom: 10 }}>
              <input type="checkbox" checked={consentProcessing} onChange={(e) => setConsentProcessing(e.target.checked)} />
              <span>
                {isChild
                  ? 'Ich habe die Datenschutzerklärung gelesen und stimme als Erziehungsberechtigte:r der Verarbeitung der Gesundheitsdaten meines Kindes über die SmartOrdi-Plattform zu.'
                  : 'Ich habe die Datenschutzerklärung gelesen und stimme der Verarbeitung meiner Gesundheitsdaten über die SmartOrdi-Plattform zu.'}
              </span>
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={consentAccuracy} onChange={(e) => setConsentAccuracy(e.target.checked)} />
              <span>
                {isChild
                  ? 'Ich bestätige, dass ich als Erziehungsberechtigte:r die Angaben für mein Kind in eigener Verantwortung wahrheitsgemäß und vollständig eingegeben habe.'
                  : 'Ich bestätige, dass die von mir eingegebenen Angaben wahrheitsgemäß und vollständig sind, und übernehme hierfür die persönliche Verantwortung.'}
              </span>
            </label>
          </div>
        )}

        <button className="btn-main" type="submit" disabled={saving}>
          {saving ? <span className="spinner" /> : (needsPassword ? 'Passwort speichern & einloggen' : 'Bestätigen')}
        </button>
      </form>
    </div>
  );
}
