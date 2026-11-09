import { useEffect, useRef, useState } from 'react';
import { BODY_FIGURES } from './lib/bodyFigures';
import { patientSetSymptoms } from './lib/patientData';
import { SYMPTOM_REGIONS, geschlechtToBodyVariant } from './lib/symptomRegions';

// Mirrors patient.html's symptom-picker modal (openSymptomModal()/
// toggleRegion()/toggleSymptom()/submitSymptoms()) -- opened automatically
// right after booking a symptom-relevant appointment (see TermineTab's
// artNeedsSymptomPicker()).
export default function SymptomPickerModal({ terminId, isChild, geschlecht, onClose, onSaved }) {
  const [variant, setVariant] = useState(() => geschlechtToBodyVariant(geschlecht) || 'male');
  const [showingBack, setShowingBack] = useState(false);
  const [activeRegions, setActiveRegions] = useState(() => new Set());
  const [selectedSymptoms, setSelectedSymptoms] = useState(() => new Set());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const figureRef = useRef(null);

  const figureVariant = isChild ? 'child' : variant;
  const figure = BODY_FIGURES[figureVariant];

  // data-region elements come from dangerouslySetInnerHTML (raw markup, not
  // React-owned) -- toggling their 'active' class imperatively, same spirit
  // as the original's own direct DOM manipulation.
  useEffect(() => {
    if (!figureRef.current) return;
    figureRef.current.querySelectorAll('[data-region]').forEach((el) => {
      el.classList.toggle('active', activeRegions.has(el.dataset.region));
    });
  }, [activeRegions, figureVariant, showingBack]);

  function toggleRegion(region) {
    setActiveRegions((prev) => {
      const next = new Set(prev);
      if (next.has(region)) next.delete(region);
      else next.add(region);
      return next;
    });
  }

  function handleFigureClick(e) {
    const el = e.target.closest('[data-region]');
    if (el) toggleRegion(el.dataset.region);
  }

  function toggleSymptom(key) {
    setSelectedSymptoms((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleSubmit() {
    const reason = [...selectedSymptoms].map((k) => k.split(':')[1]);
    setSaving(true);
    try {
      const ok = await patientSetSymptoms(terminId, reason, note.trim());
      if (ok) onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay show">
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">Grund für den Besuch</div>
          <button type="button" className="modal-close" onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 12, color: 'var(--p-muted)', marginBottom: 12 }}>
            Tippen Sie auf die betroffene Körperregion — Sie können mehrere auswählen.
          </div>

          {!isChild && (
            <div className="body-gender-toggle">
              <button type="button" className={`region-chip${variant === 'male' ? ' active' : ''}`} onClick={() => setVariant('male')}>Mann</button>
              <button type="button" className={`region-chip${variant === 'female' ? ' active' : ''}`} onClick={() => setVariant('female')}>Frau</button>
            </div>
          )}

          <div style={{ textAlign: 'center', marginBottom: 8 }}>
            <button type="button" className="region-chip" style={{ fontWeight: 700 }} onClick={() => setShowingBack((b) => !b)}>
              {showingBack ? 'Vorderansicht anzeigen' : 'Rückansicht anzeigen'}
            </button>
          </div>

          <div ref={figureRef} onClick={handleFigureClick}>
            <svg
              viewBox={figure.viewBox}
              style={{ width: '100%', maxWidth: 200, display: showingBack ? 'none' : 'block', margin: '0 auto 14px' }}
              dangerouslySetInnerHTML={{ __html: figure.front }}
            />
            <svg
              viewBox={figure.viewBox}
              style={{ width: '100%', maxWidth: 200, display: showingBack ? 'block' : 'none', margin: '0 auto 14px' }}
              dangerouslySetInnerHTML={{ __html: figure.back }}
            />
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
            <button
              type="button"
              className={`region-chip${activeRegions.has('haut') ? ' active' : ''}`}
              onClick={() => toggleRegion('haut')}
            >
              Haut (allgemein)
            </button>
          </div>

          <div>
            {[...activeRegions].map((r) => {
              const info = SYMPTOM_REGIONS[r];
              if (!info) return null;
              return (
                <div style={{ marginBottom: 12 }} key={r}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#1e40af', marginBottom: 6 }}>{info.label}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {info.symptoms.map((s) => {
                      const key = r + ':' + s;
                      return (
                        <button
                          key={key}
                          type="button"
                          className={`symptom-chip${selectedSymptoms.has(key) ? ' active' : ''}`}
                          onClick={() => toggleSymptom(key)}
                        >
                          {s}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 14 }}>
            <label style={{ display: 'block', marginBottom: 6, fontSize: 11, fontWeight: 700, color: 'var(--p-muted)' }}>
              Zusätzliche Erklärung (optional)
            </label>
            <textarea
              rows={3}
              placeholder="Beschreiben Sie kurz Ihre Beschwerden…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{ width: '100%', padding: 10, border: '1.5px solid var(--p-border)', borderRadius: 10, fontFamily: 'inherit', fontSize: 16, outline: 'none', resize: 'vertical' }}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-confirm" disabled={saving} onClick={handleSubmit}>
            {saving ? 'Wird gespeichert…' : 'Absenden'}
          </button>
        </div>
      </div>
    </div>
  );
}
