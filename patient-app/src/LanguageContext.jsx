import { createContext, useContext, useState } from 'react';
import { getPatientLang, setPatientLanguage, initPatientLanguage, tr, trParams, PATIENT_LANGS } from './lib/i18n';

const LanguageContext = createContext(null);

// React-side replacement for vendor/i18n-patient.js's onPatientLanguageChanged()/
// applyI18n(document) re-render step -- here, changing the language just
// updates this Provider's own state, and every consumer re-renders through
// the normal React tree instead of a DOM re-scan. `lang` itself is only
// read by the language switcher (to mark the current <option> selected);
// every other consumer calls t()/tp(), which always re-reads the just-
// written localStorage value -- including `lang` in the context value is
// what actually triggers their re-render on a language change.
export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(initPatientLanguage);

  function changeLanguage(next) {
    setPatientLanguage(next);
    setLangState(next);
  }

  const value = {
    lang,
    setLanguage: changeLanguage,
    languages: PATIENT_LANGS,
    t: tr,
    tp: trParams,
  };

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within a LanguageProvider');
  return ctx;
}

// Convenience for components that only need the translate function itself.
export function useT() {
  return useLanguage().t;
}

export { getPatientLang };
