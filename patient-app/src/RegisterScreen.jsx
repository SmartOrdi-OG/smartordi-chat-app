import { useEffect, useState } from 'react';
import { getPracticeJoinInfo, submitJoinRequest } from './lib/patientRegister';

function getPracticeIdFromUrl() {
  return new URLSearchParams(window.location.search).get('practice');
}

export default function RegisterScreen({ onBackToLogin }) {
  const practiceId = getPracticeIdFromUrl();
  const [practiceInfo, setPracticeInfo] = useState(null);
  const [isChild, setIsChild] = useState(false);
  const [fields, setFields] = useState({
    vorname: '', nachname: '', dob: '', geschlecht: '', tel: '', adresse: '',
    svnr: '', versicherung: '', username: '', pw: '', confirmPw: '',
  });
  const [agb, setAgb] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (practiceId) getPracticeJoinInfo(practiceId).then(setPracticeInfo);
  }, [practiceId]);

  function set(key) {
    return (e) => setFields((f) => ({ ...f, [key]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const { vorname, nachname, dob, tel, adresse, svnr, username, pw, confirmPw } = fields;
    if (!vorname || !nachname || !dob || !tel || !adresse || !svnr || !username || !pw) {
      setError('Bitte füllen Sie alle Pflichtfelder (*) aus.');
      return;
    }
    if (pw.length < 6) {
      setError('Das Passwort muss mindestens 6 Zeichen lang sein.');
      return;
    }
    if (pw !== confirmPw) {
      setError('Die Passwörter stimmen nicht überein.');
      return;
    }
    if (!agb) {
      setError('Bitte akzeptieren Sie die AGB und Datenschutzbestimmungen.');
      return;
    }
    if (!practiceId) {
      setError('Kein Ordinations-Link erkannt. Bitte verwenden Sie den Link oder QR-Code Ihrer Ordination.');
      return;
    }
    setSubmitting(true);
    try {
      await submitJoinRequest(fields, practiceId, isChild);
      setSent(true);
    } catch (err) {
      setError('Antrag konnte nicht gesendet werden. Bitte versuchen Sie es erneut.');
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div className="card">
        <div className="card-logo">
          <img src="/logo..jpeg" alt="Logo" className="card-logo-img" />
          <div className="card-logo-text">Smartordi<span>.chat</span></div>
        </div>
        <div className="welcome-title">Antrag gesendet ✓</div>
        <div className="welcome-sub">
          Ihre Ordination prüft Ihre Anfrage. Sobald sie freigeschaltet ist, können Sie sich mit Ihrem
          gewählten Benutzernamen und Passwort anmelden.
        </div>
        <button className="btn-main" onClick={onBackToLogin}>Zurück zur Anmeldung</button>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-logo">
        <img src="/logo..jpeg" alt="Logo" className="card-logo-img" />
        <div className="card-logo-text">Smartordi<span>.chat</span></div>
      </div>

      <div className="welcome-title">Anmeldung beantragen</div>
      <div className="welcome-sub">Füllen Sie Ihre Daten aus. Ihre Anfrage wird von der Ordination geprüft.</div>

      <div className="acctype-toggle">
        <button type="button" className={`acctype-btn${!isChild ? ' active' : ''}`} onClick={() => setIsChild(false)}>Für mich</button>
        <button type="button" className={`acctype-btn${isChild ? ' active' : ''}`} onClick={() => setIsChild(true)}>Für mein Kind</button>
      </div>

      {error && <div className="error-msg"><span>!</span><span>{error}</span></div>}

      <form onSubmit={handleSubmit}>
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
          <label className="form-label">Telefon *</label>
          <input className="form-input" type="tel" placeholder="+43 ..." value={fields.tel} onChange={set('tel')} />
        </div>
        <div className="form-group">
          <label className="form-label">Adresse *</label>
          <input className="form-input" value={fields.adresse} onChange={set('adresse')} />
        </div>
        <div className="form-group">
          <label className="form-label">Versicherungsnummer (SVNr) *</label>
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
        <div className="form-group">
          <label className="form-label">Benutzername</label>
          <input className="form-input" autoComplete="username" value={fields.username} onChange={set('username')} />
        </div>
        <div className="form-group">
          <label className="form-label">Passwort</label>
          <input className="form-input" type="password" autoComplete="new-password" value={fields.pw} onChange={set('pw')} />
        </div>
        <div className="form-group">
          <label className="form-label">Passwort bestätigen</label>
          <input className="form-input" type="password" autoComplete="new-password" value={fields.confirmPw} onChange={set('confirmPw')} />
        </div>

        <div className="notice">
          <div className="notice-label">Ordination</div>
          <div className="notice-main">{practiceInfo ? practiceInfo.practiceName : practiceId ? 'Lädt…' : '— kein Link erkannt —'}</div>
          {practiceInfo && practiceInfo.adminFullName && (
            <div className="notice-sub">{practiceInfo.adminFullName}{practiceInfo.adminFach ? ` · ${practiceInfo.adminFach}` : ''}</div>
          )}
        </div>

        <div className="form-group">
          <label className="checkbox-label">
            <input type="checkbox" checked={agb} onChange={(e) => setAgb(e.target.checked)} />
            <span>Ich akzeptiere die <a href="/agb.html" target="_blank" rel="noreferrer">AGB</a> und <a href="/datenschutz.html" target="_blank" rel="noreferrer">Datenschutz</a></span>
          </label>
        </div>

        <button className="btn-main" type="submit" disabled={submitting}>
          {submitting ? 'Wird gesendet…' : 'Antrag senden'}
        </button>
      </form>

      <div style={{ textAlign: 'center', marginTop: 12 }}>
        <a href="#" onClick={(e) => { e.preventDefault(); onBackToLogin(); }} className="text-link">Zurück zur Anmeldung</a>
      </div>
    </div>
  );
}
