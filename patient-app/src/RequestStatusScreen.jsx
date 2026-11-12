import { useLanguage } from './LanguageContext';

// Mirrors patient-login.html's screen-request-status -- shown instead of a
// flat "wrong password" when the typed username belongs to a self-
// registration that's still pending review, or was turned down.
// Simplified vs. the original: no pre-filled "resubmit" form (just a
// pointer back to a fresh registration) -- a disclosed scope cut, not an
// oversight, to keep this slice reasonably sized.
export default function RequestStatusScreen({ status, note, onBackToLogin, onRegisterAgain }) {
  const { t } = useLanguage();
  const rejected = status === 'rejected';
  return (
    <div className="card">
      <div className="card-logo">
        <img src="/logo..jpeg" alt="Logo" className="card-logo-img" />
        <div className="card-logo-text">Smartordi<span>.chat</span></div>
      </div>

      <div className="welcome-title">{rejected ? t('request.status.rejected.title') : t('request.status.pending.title')}</div>
      <div className="welcome-sub">
        {rejected ? t('request.status.rejected.sub') : t('request.status.pending.sub')}
      </div>

      {rejected && (
        <div className="notice">
          <div className="notice-main">{note || t('request.status.noNote')}</div>
        </div>
      )}

      {rejected && (
        <button className="btn-main" style={{ marginBottom: 10 }} onClick={onRegisterAgain}>{t('request.status.resubmit')}</button>
      )}
      <button className="btn-secondary" style={{ width: '100%' }} onClick={onBackToLogin}>{t('request.status.back')}</button>
    </div>
  );
}
