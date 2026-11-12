import { useState } from 'react';
import { useLanguage } from './LanguageContext';
import { patientSubmitProfileJoinRequest } from './lib/patientData';

export default function AddProfileForm({ type, practiceId, onDone, onCancel }) {
  const { t } = useLanguage();
  const [fields, setFields] = useState({
    vorname: '', nachname: '', dob: '', geschlecht: '', adresse: '', svnr: '', versicherung: '',
  });
  const [relation, setRelation] = useState('father');
  const [relationLabel, setRelationLabel] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  function set(key) {
    return (e) => setFields((f) => ({ ...f, [key]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!fields.vorname || !fields.nachname || !fields.dob || !fields.adresse) {
      setError(t('request.err.missing'));
      return;
    }
    setSending(true);
    try {
      const rel = type === 'child' ? 'child' : relation;
      await patientSubmitProfileJoinRequest(
        fields, practiceId, rel, rel === 'other' ? relationLabel : null
      );
      setSent(true);
    } catch (err) {
      setError(t('request.err.submitFailed'));
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div>
        <div className="welcome-title" style={{ fontSize: 16 }}>{t('request.sent.title')} ✓</div>
        <div className="welcome-sub">{t('profiles.sentSub')}</div>
        <button className="btn-main" onClick={onDone}>{t('profiles.done')}</button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="welcome-title" style={{ fontSize: 16 }}>
        {type === 'child' ? t('profiles.addChild') : t('profiles.addAdult')}
      </div>

      {error && <div className="error-msg"><span>!</span><span>{error}</span></div>}

      {type !== 'child' && (
        <div className="form-group">
          <label className="form-label">{t('profiles.relation')}</label>
          <select className="form-input" value={relation} onChange={(e) => setRelation(e.target.value)}>
            <option value="father">{t('profiles.father')}</option>
            <option value="mother">{t('profiles.mother')}</option>
            <option value="other">{t('profiles.otherRelation')}</option>
          </select>
          {relation === 'other' && (
            <input
              className="form-input" style={{ marginTop: 8 }} placeholder={t('profiles.otherRelationPlaceholder')}
              value={relationLabel} onChange={(e) => setRelationLabel(e.target.value)}
            />
          )}
        </div>
      )}

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
        <label className="form-label">{t('request.adresse.label')} *</label>
        <input className="form-input" value={fields.adresse} onChange={set('adresse')} />
      </div>
      <div className="form-group">
        <label className="form-label">{t('request.svnr.label')}</label>
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

      <div className="booking-actions">
        <button type="button" className="btn-secondary" onClick={onCancel}>{t('linkPractice.cancel')}</button>
        <button type="submit" className="btn-main" disabled={sending}>{sending ? t('common.sending') : t('request.submit')}</button>
      </div>
    </form>
  );
}
