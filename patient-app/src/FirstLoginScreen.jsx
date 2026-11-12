import { useState } from 'react';
import { useLanguage } from './LanguageContext';
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
  const { t } = useLanguage();
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
      setError(t('changepw.err.consentRequired'));
      return;
    }

    if (needsPassword) {
      if (newPw.length < 6) {
        setError(t('changepw.err.tooShort'));
        return;
      }
      if (newPw !== confirmPw) {
        setError(t('changepw.err.mismatch'));
        return;
      }
      if (needsUsername && !username.trim()) {
        setError(t('changepw.err.usernameRequired'));
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
              result.code === 'too_short' ? t('changepw.err.usernameTooShort')
                : result.code === 'taken' ? t('changepw.err.usernameTaken')
                : t('changepw2.err.usernameChangeFailed')
            );
            setSaving(false);
            return;
          }
        }
        const ok = await patientChangePassword(newPw);
        if (!ok) {
          setError(t('changepw.err.saveFailed'));
          setSaving(false);
          return;
        }
      }

      if (needsConsent) {
        const consentOk = await patientRecordLoginConsent(POLICY_VERSION);
        if (!consentOk) {
          setError(t('changepw.err.saveFailed'));
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

      <div className="welcome-title">{needsPassword ? (isChild ? t('changepw.child.title') : t('changepw.title')) : t('changepw.consent.title')}</div>
      <div className="welcome-sub">
        {needsPassword
          ? (isChild ? t('changepw.child.sub') : t('changepw.sub'))
          : t('changepw.consent.sub')}
      </div>

      {error && <div className="error-msg"><span>!</span><span>{error}</span></div>}

      <form onSubmit={handleSubmit}>
        {needsPassword && (
          <>
            <div className="form-group">
              <label className="form-label" htmlFor="newUsername">{t('changepw.newUsername.label')}</label>
              <div className="input-wrap">
                <input
                  id="newUsername" className="form-input" autoCapitalize="off" autoCorrect="off" spellCheck={false}
                  value={username} onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              {needsUsername && (
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>
                  {isChild ? t('changepw.child.newUsername.notice') : t('changepw.newAccount.newUsername.notice')}
                </div>
              )}
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="newPw">{t('changepw.newPw.label')}</label>
              <div className="input-wrap">
                <input
                  id="newPw" className="form-input" type="password" placeholder={t('changepw.newPw.placeholder')}
                  value={newPw} onChange={(e) => setNewPw(e.target.value)}
                />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="confirmPw">{t('changepw.confirmPw.label')}</label>
              <div className="input-wrap">
                <input
                  id="confirmPw" className="form-input" type="password" placeholder={t('changepw.confirmPw.placeholder')}
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
              <span>{isChild ? t('changepw.consent.processing.child') : t('changepw.consent.processing')}</span>
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={consentAccuracy} onChange={(e) => setConsentAccuracy(e.target.checked)} />
              <span>{isChild ? t('changepw.consent.accuracy.child') : t('changepw.consent.accuracy')}</span>
            </label>
          </div>
        )}

        <button className="btn-main" type="submit" disabled={saving}>
          {saving ? <span className="spinner-row"><span className="spinner" /> {t('login.loading')}</span> : (needsPassword ? t('changepw.save') : t('common.confirm'))}
        </button>
      </form>
    </div>
  );
}
