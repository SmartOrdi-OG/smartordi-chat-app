import { useEffect, useState } from 'react';
import { useLanguage } from './LanguageContext';
import { getPracticeJoinInfo, resolvePracticeShortCode, submitJoinRequest } from './lib/patientRegister';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function RegisterScreen({ onBackToLogin, practiceRef }) {
  const { t } = useLanguage();
  const [practiceId, setPracticeId] = useState(() => (practiceRef && UUID_RE.test(practiceRef) ? practiceRef : null));
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

  // practiceRef is either a UUID (older-style shared link) or a short code
  // (phase89_practice_short_code.sql, e.g. "2TW3BZ") -- resolve the latter
  // via the server before the rest of this screen treats it as a real id.
  useEffect(() => {
    if (practiceRef && !UUID_RE.test(practiceRef)) {
      resolvePracticeShortCode(practiceRef).then(setPracticeId);
    }
  }, [practiceRef]);

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
      setError(t('request.err.missing'));
      return;
    }
    if (pw.length < 6) {
      setError(t('changepw.err.tooShort'));
      return;
    }
    if (pw !== confirmPw) {
      setError(t('changepw.err.mismatch'));
      return;
    }
    if (!agb) {
      setError(t('request.err.agb'));
      return;
    }
    if (!practiceId) {
      setError(t('register.err.noPracticeLink'));
      return;
    }
    setSubmitting(true);
    try {
      await submitJoinRequest(fields, practiceId, isChild);
      setSent(true);
    } catch (err) {
      setError(t('request.err.submitFailed'));
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
        <div className="welcome-title">{t('request.sent.title')} ✓</div>
        <div className="welcome-sub">{t('request.sent.sub')}</div>
        <button className="btn-main" onClick={onBackToLogin}>{t('request.backToLogin')}</button>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-logo">
        <img src="/logo..jpeg" alt="Logo" className="card-logo-img" />
        <div className="card-logo-text">Smartordi<span>.chat</span></div>
      </div>

      <div className="welcome-title">{t('request.title')}</div>
      <div className="welcome-sub">{t('request.sub')}</div>

      <div className="acctype-toggle">
        <button type="button" className={`acctype-btn${!isChild ? ' active' : ''}`} onClick={() => setIsChild(false)}>{t('request.forWhom.self')}</button>
        <button type="button" className={`acctype-btn${isChild ? ' active' : ''}`} onClick={() => setIsChild(true)}>{t('request.forWhom.child')}</button>
      </div>

      {error && <div className="error-msg"><span>!</span><span>{error}</span></div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label">{t('request.vorname.label')} *</label>
          <input className="form-input" value={fields.vorname} onChange={set('vorname')} />
        </div>
        <div className="form-group">
          <label className="form-label">{t('request.nachname.label')} *</label>
          <input className="form-input" value={fields.nachname} onChange={set('nachname')} />
        </div>
        <div className="form-group">
          <label className="form-label">{t('request.dob.label')} *</label>
          <input className="form-input" type="date" max={new Date().toISOString().slice(0, 10)} value={fields.dob} onChange={set('dob')} />
        </div>
        <div className="form-group">
          <label className="form-label">{t('request.geschlecht.label')}</label>
          <select className="form-input" value={fields.geschlecht} onChange={set('geschlecht')}>
            <option value="">{t('request.geschlecht.none')}</option>
            <option value="m">{t('request.geschlecht.m')}</option>
            <option value="w">{t('request.geschlecht.w')}</option>
            <option value="d">{t('request.geschlecht.d')}</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">{t('request.tel.label')} *</label>
          <input className="form-input" type="tel" placeholder="+43 ..." value={fields.tel} onChange={set('tel')} />
        </div>
        <div className="form-group">
          <label className="form-label">{t('request.adresse.label')} *</label>
          <input className="form-input" value={fields.adresse} onChange={set('adresse')} />
        </div>
        <div className="form-group">
          <label className="form-label">{t('request.svnr.label')} *</label>
          <input className="form-input" value={fields.svnr} onChange={set('svnr')} />
        </div>
        <div className="form-group">
          <label className="form-label">{t('profil.versicherung')}</label>
          <select className="form-input" value={fields.versicherung} onChange={set('versicherung')}>
            <option value="">{t('request.geschlecht.none')}</option>
            <option value="ÖGK">ÖGK</option>
            <option value="BVAEB">BVAEB</option>
            <option value="SVS">SVS</option>
            <option value="Andere">{t('request.versicherung.other')}</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">{t('login.username.label')}</label>
          <input className="form-input" autoComplete="username" value={fields.username} onChange={set('username')} />
        </div>
        <div className="form-group">
          <label className="form-label">{t('login.password.label')}</label>
          <input className="form-input" type="password" autoComplete="new-password" value={fields.pw} onChange={set('pw')} />
        </div>
        <div className="form-group">
          <label className="form-label">{t('changepw.confirmPw.label')}</label>
          <input className="form-input" type="password" autoComplete="new-password" value={fields.confirmPw} onChange={set('confirmPw')} />
        </div>

        <div className="notice">
          <div className="notice-label">{t('request.clinic.label')}</div>
          <div className="notice-main">{practiceInfo ? practiceInfo.practiceName : practiceRef ? t('common.loading') : t('register.noLinkDetected')}</div>
          {practiceInfo && practiceInfo.adminFullName && (
            <div className="notice-sub">{practiceInfo.adminFullName}{practiceInfo.adminFach ? ` · ${practiceInfo.adminFach}` : ''}</div>
          )}
        </div>

        <div className="form-group">
          <label className="checkbox-label">
            <input type="checkbox" checked={agb} onChange={(e) => setAgb(e.target.checked)} />
            <span>{t('request.agb.prefix')} <a href="/agb.html" target="_blank" rel="noreferrer">{t('common.agbLink')}</a> {t('request.agb.and')} <a href="/datenschutz.html" target="_blank" rel="noreferrer">{t('common.datenschutzLink')}</a></span>
          </label>
        </div>

        <button className="btn-main" type="submit" disabled={submitting}>
          {submitting ? t('common.sending') : t('request.submit')}
        </button>
      </form>

      <div style={{ textAlign: 'center', marginTop: 12 }}>
        <a href="#" onClick={(e) => { e.preventDefault(); onBackToLogin(); }} className="text-link">{t('request.backToLogin')}</a>
      </div>
    </div>
  );
}
