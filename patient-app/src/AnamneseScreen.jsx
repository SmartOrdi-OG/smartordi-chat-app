import { useState } from 'react';
import { patientSetAnamnese } from './lib/patientData';
import { patientGetProfile } from './lib/patientAuth';
import { ANAMNESE_COMMON_SECTIONS, ANAMNESE_GFB_QUESTIONS, anamneseSpecialtyInfo } from './lib/anamneseSchema';

function fieldDefault(field) {
  if (field.kind === 'select') return field.options[0].value;
  return '';
}

function collectBlockDefaults(block, into) {
  if (block.kind === 'checkboxes') block.items.forEach((item) => { into[item.key] = false; });
  else if (block.kind === 'grid') block.fields.forEach((f) => { into[f.key] = fieldDefault(f); });
  else if (block.kind === 'subheader') { /* no field */ }
  else into[block.key] = fieldDefault(block);
}

function collectSectionsDefaults(sections, into) {
  sections.forEach((section) => {
    if (section.gfb) {
      ANAMNESE_GFB_QUESTIONS.forEach((q) => {
        into[q.key] = 'Nein';
        if (q.followupPlaceholder) into[q.key + '.detail'] = '';
      });
      return;
    }
    (section.blocks || []).forEach((block) => collectBlockDefaults(block, into));
  });
}

function buildInitialData(specialtySections) {
  const data = {};
  collectSectionsDefaults(ANAMNESE_COMMON_SECTIONS, data);
  collectSectionsDefaults(specialtySections, data);
  return data;
}

function Field({ field, data, onChange }) {
  return (
    <div className="an-field">
      {field.label && <div className="an-field-label">{field.label}</div>}
      {field.kind === 'select' ? (
        <select className="form-input" value={data[field.key] ?? field.options[0].value} onChange={(e) => onChange(field.key, e.target.value)}>
          {field.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input className="form-input" type={field.inputType || 'text'} placeholder={field.placeholder}
          value={data[field.key] ?? ''} onChange={(e) => onChange(field.key, e.target.value)} />
      )}
    </div>
  );
}

function Block({ block, data, onChange }) {
  if (block.kind === 'checkboxes') {
    return (
      <div className="an-block">
        {block.label && <div className="an-field-label">{block.label}</div>}
        <div className="an-checkbox-grid">
          {block.items.map((item) => (
            <label className="checkbox-label" key={item.key}>
              <input type="checkbox" checked={!!data[item.key]} onChange={(e) => onChange(item.key, e.target.checked)} />
              <span>{item.label}</span>
            </label>
          ))}
        </div>
      </div>
    );
  }
  if (block.kind === 'textarea') {
    return (
      <div className="an-block">
        {block.label && <div className="an-field-label">{block.label}</div>}
        <textarea className="form-input an-textarea" rows={2} placeholder={block.placeholder}
          value={data[block.key] ?? ''} onChange={(e) => onChange(block.key, e.target.value)} />
      </div>
    );
  }
  if (block.kind === 'text') {
    return (
      <div className="an-block">
        {block.label && <div className="an-field-label">{block.label}</div>}
        <input className="form-input" type={block.inputType || 'text'} placeholder={block.placeholder}
          value={data[block.key] ?? ''} onChange={(e) => onChange(block.key, e.target.value)} />
      </div>
    );
  }
  if (block.kind === 'select') {
    return (
      <div className="an-block">
        {block.label && <div className="an-field-label">{block.label}</div>}
        <select className="form-input" value={data[block.key] ?? block.options[0].value} onChange={(e) => onChange(block.key, e.target.value)}>
          {block.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    );
  }
  if (block.kind === 'grid') {
    return (
      <div className="an-field-grid">
        {block.fields.map((f) => <Field key={f.key} field={f} data={data} onChange={onChange} />)}
      </div>
    );
  }
  if (block.kind === 'subheader') {
    return <div className="an-subheader">{block.label}</div>;
  }
  return null;
}

function GfbSection({ data, onChange }) {
  return (
    <div className="an-section">
      <div className="an-section-title">Gesundheitsfragebogen</div>
      {ANAMNESE_GFB_QUESTIONS.map((q) => (
        <div className="an-gfb-row" key={q.key}>
          <div className="an-gfb-row-top">
            <span className="an-gfb-question">{q.question}</span>
            <select className="form-input an-gfb-select" value={data[q.key] ?? 'Nein'} onChange={(e) => onChange(q.key, e.target.value)}>
              <option value="Nein">Nein</option>
              <option value="Ja">Ja</option>
            </select>
          </div>
          {q.followupPlaceholder && data[q.key] === 'Ja' && (
            <input className="form-input an-gfb-detail" placeholder={q.followupPlaceholder}
              value={data[q.key + '.detail'] ?? ''} onChange={(e) => onChange(q.key + '.detail', e.target.value)} />
          )}
        </div>
      ))}
    </div>
  );
}

function Section({ section, data, onChange }) {
  if (section.gfb) return <GfbSection data={data} onChange={onChange} />;
  return (
    <div className="an-section">
      <div className="an-section-title">{section.title}</div>
      {section.blocks.map((block, i) => <Block key={block.key || i} block={block} data={data} onChange={onChange} />)}
    </div>
  );
}

// Mirrors patient-login.html's showAnamneseScreen()/submitAnamnese() --
// the mandatory, once-only medical-history questionnaire, now completed in
// React. The specialty sections and Gesundheitsfragebogen are data-driven
// from lib/anamneseSchema.js (a port of vendor/anamnese-shared.js), keyed
// by the exact same data-key strings doctor.html's Kartei "Anamnese" tab
// (vendor/kartei-anamnese.js) reads a patient's submitted answers by.
export default function AnamneseScreen({ profile, onDone }) {
  const fach = profile.isChild ? 'Kinderheilkunde' : (profile.fach || 'Allgemeinmedizin');
  const specialtyInfo = anamneseSpecialtyInfo(fach);
  const [data, setData] = useState(() => buildInitialData(specialtyInfo.sections));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function handleChange(key, value) {
    setData((d) => ({ ...d, [key]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const ok = await patientSetAnamnese(data);
      if (!ok) {
        setError('Speichern fehlgeschlagen. Bitte versuchen Sie es erneut.');
        return;
      }
      const updated = await patientGetProfile();
      onDone(updated || profile);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card wide">
      <div className="card-logo">
        <img src="/logo..jpeg" alt="Logo" className="card-logo-img" />
        <div className="card-logo-text">Smartordi<span>.chat</span></div>
      </div>

      <div className="welcome-title">Anamnese ausfüllen</div>
      <div className="welcome-sub">Bitte füllen Sie einmalig Ihre medizinische Vorgeschichte aus. Diese Angaben werden an Ihre Ordination übermittelt.</div>

      {error && <div className="error-msg"><span>!</span><span>{error}</span></div>}

      <form onSubmit={handleSubmit}>
        <div className="anamnese-scroll">
          {ANAMNESE_COMMON_SECTIONS.map((section) => (
            <Section key={section.title} section={section} data={data} onChange={handleChange} />
          ))}
          {specialtyInfo.sections.length > 0 && (
            <div className="anamnese-specialty-title">{specialtyInfo.label}</div>
          )}
          {specialtyInfo.sections.map((section) => (
            <Section key={section.title} section={section} data={data} onChange={handleChange} />
          ))}
        </div>

        <button className="btn-main" type="submit" disabled={saving}>
          {saving ? <span className="spinner" /> : '✓ Anamnese absenden'}
        </button>
      </form>
    </div>
  );
}
