import { useState } from 'react';
import { resolveLogin } from './lib/patientLoginFlow';

export default function LoginScreen({ onResolve, onRegister, initialUsername, initialPassword, initialError }) {
  const [username, setUsername] = useState(initialUsername || '');
  const [password, setPassword] = useState(initialPassword || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialError || '');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setLoading(true);
    setError('');
    try {
      const result = await resolveLogin(username.trim().toLowerCase(), password);
      if (result.kind === 'invalid') {
        setError('Falscher Benutzername oder Passwort.');
        return;
      }
      if (result.kind === 'error') {
        setError(result.message);
        return;
      }
      onResolve(result);
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
          {loading ? <span className="spinner-row"><span className="spinner" /> Einen Moment...</span> : 'Anmelden'}
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
