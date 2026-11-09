import { useState } from 'react';
import { patientLogin } from './lib/patientAuth';

export default function LoginScreen({ onLoggedIn, onRegister }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setLoading(true);
    setError('');
    try {
      const profile = await patientLogin(username.trim().toLowerCase(), password);
      if (!profile) {
        setError('Falscher Benutzername oder Passwort.');
        return;
      }
      onLoggedIn(profile);
    } catch (err) {
      const msg = (err && err.message) || '';
      setError(
        msg.indexOf('account_locked') !== -1
          ? 'Konto vorübergehend gesperrt. Bitte später erneut versuchen.'
          : msg.indexOf('temp_password_expired') !== -1
          ? 'Temporäres Passwort abgelaufen. Bitte kontaktieren Sie Ihre Ordination.'
          : 'Anmeldung fehlgeschlagen. Bitte versuchen Sie es erneut.'
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <div className="card-logo">
        <img src="/logo..jpeg" alt="Logo" className="card-logo-img" />
        <div className="card-logo-text">
          Smartordi<span>.chat</span>
        </div>
      </div>

      {error && (
        <div className="error-msg">
          <span>!</span>
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label" htmlFor="username">Benutzername</label>
          <div className="input-wrap">
            <input
              id="username"
              className="form-input"
              type="text"
              placeholder="benutzername"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="password">Passwort</label>
          <div className="input-wrap">
            <input
              id="password"
              className="form-input"
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>

        <button className="btn-main" type="submit" disabled={loading}>
          {loading ? <span className="spinner" /> : 'Anmelden'}
        </button>
      </form>

      <div style={{ textAlign: 'center', marginTop: 12 }}>
        <a href="#" onClick={(e) => { e.preventDefault(); onRegister(); }} className="text-link">
          Neu hier? Anmeldung beantragen
        </a>
      </div>
    </div>
  );
}
