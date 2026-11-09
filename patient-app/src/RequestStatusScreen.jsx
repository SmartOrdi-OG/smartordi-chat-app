// Mirrors patient-login.html's screen-request-status -- shown instead of a
// flat "wrong password" when the typed username belongs to a self-
// registration that's still pending review, or was turned down.
// Simplified vs. the original: no pre-filled "resubmit" form (just a
// pointer back to a fresh registration) -- a disclosed scope cut, not an
// oversight, to keep this slice reasonably sized.
export default function RequestStatusScreen({ status, note, onBackToLogin, onRegisterAgain }) {
  const rejected = status === 'rejected';
  return (
    <div className="card">
      <div className="card-logo">
        <img src="/logo..jpeg" alt="Logo" className="card-logo-img" />
        <div className="card-logo-text">Smartordi<span>.chat</span></div>
      </div>

      <div className="welcome-title">{rejected ? 'Anfrage abgelehnt' : 'Anfrage wird geprüft'}</div>
      <div className="welcome-sub">
        {rejected
          ? 'Ihre Anfrage wurde leider nicht angenommen:'
          : 'Ihre Anfrage liegt der Ordination noch zur Prüfung vor. Bitte versuchen Sie es später erneut.'}
      </div>

      {rejected && (
        <div className="notice">
          <div className="notice-main">{note || 'Kein Grund angegeben.'}</div>
        </div>
      )}

      {rejected && (
        <button className="btn-main" style={{ marginBottom: 10 }} onClick={onRegisterAgain}>Anfrage erneut stellen</button>
      )}
      <button className="btn-secondary" style={{ width: '100%' }} onClick={onBackToLogin}>Zurück zur Anmeldung</button>
    </div>
  );
}
