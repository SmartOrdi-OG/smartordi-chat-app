// Lightweight lookup (key -> title/ageLabel) mirroring vendor/mkp-exams.js's
// MKP_EXAMS list -- the full per-field definitions (labels, types) aren't
// ported yet, so each exam's filled-in data still renders as raw
// field-id: value pairs rather than the original's labeled form.
export const MKP_EXAM_INFO = {
  lw4_7_allgemein: { title: 'Allgemeine Untersuchung', ageLabel: '4.–7. Lebenswoche' },
  lw6_8_huefte: { title: 'Hüftultraschalluntersuchung', ageLabel: '6.–8. Lebenswoche' },
  lw4_7_orthopaedisch: { title: 'Orthopädische Untersuchung', ageLabel: '4.–7. Lebenswoche' },
  mo3_5_allgemein: { title: 'Allgemeine Untersuchung', ageLabel: '3.–5. Lebensmonat' },
  mo7_9_allgemein: { title: 'Allgemeine Untersuchung', ageLabel: '7.–9. Lebensmonat' },
  mo7_9_hno: { title: 'HNO-Untersuchung', ageLabel: '7.–9. Lebensmonat' },
  mo10_14_allgemein: { title: 'Allgemeine Untersuchung', ageLabel: '10.–14. Lebensmonat' },
  mo10_14_augen: { title: 'Augenuntersuchung', ageLabel: '10.–14. Lebensmonat' },
  mo22_26_allgemein: { title: 'Allgemeine Untersuchung', ageLabel: '22.–26. Lebensmonat' },
  mo22_26_augen: { title: 'Augenuntersuchung', ageLabel: '22.–26. Lebensmonat' },
  mo34_38_allgemein: { title: 'Allgemeine Untersuchung', ageLabel: '34.–38. Lebensmonat' },
  mo46_50_allgemein: { title: 'Allgemeine Untersuchung', ageLabel: '46.–50. Lebensmonat' },
  mo58_62_allgemein: { title: 'Allgemeine Untersuchung', ageLabel: '58.–62. Lebensmonat' },
};
