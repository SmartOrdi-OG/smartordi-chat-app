import { useState } from 'react';
import { useLanguage } from './LanguageContext';
import { patientChangePassword, patientChangeUsername } from './lib/patientAuth';

export default function PasswordChangeForm({ currentUsername, onDone, onCancel }) {
  const { t } = useLanguage();
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
      setError(t('changepw.err.tooShort'));
      return;
    }
    if (newPw !== confirmPw) {
      setError(t('changepw.err.mismatch'));
      return;
    }
    setSaving(true);
    try {
      if (newUsername.trim() && newUsername.trim().toLowerCase() !== (currentUsername || '').toLowerCase()) {
        const result = await patientChangeUsername(newUsername.trim().toLowerCase());
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
      setSuccess(t('changepw2.success'));
      setNewPw('');
      setConfirmPw('');
      setTimeout(onDone, 1200);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="welcome-title" style={{ fontSize: 16 }}>{t('changepw2.title')}</div>
      <div className="welcome-sub">{t('changepw2.hint')}</div>

      {error && <div className="error-msg"><span>!</span><span>{error}</span></div>}
      {success && <div className="notice" style={{ color: '#166534', background: '#dcfce7', borderColor: '#bbf7d0' }}>{success}</div>}

      <div className="form-group">
        <label className="form-label">{t('login.username.label')}</label>
        <input className="form-input" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">{t('changepw.newPw.label')}</label>
        <input className="form-input" type="password" placeholder={t('changepw.newPw.placeholder')} value={newPw} onChange={(e) => setNewPw(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">{t('changepw.confirmPw.label')}</label>
        <input className="form-input" type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
      </div>

      <div className="booking-actions">
        <button type="button" className="btn-secondary" onClick={onCancel}>{t('linkPractice.cancel')}</button>
        <button type="submit" className="btn-main" disabled={saving}>{saving ? t('changepw2.saving') : t('settings.save')}</button>
      </div>
    </form>
  );
}
