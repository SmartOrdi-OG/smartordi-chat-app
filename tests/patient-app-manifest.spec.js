// Regression test for the patient-facing PWA manifest, added ahead of
// publishing a Trusted Web Activity (Android/Google Play) wrapper for the
// patient app. Every page previously shared one manifest.json whose
// start_url pointed at login.html (the staff login) -- installing the
// patient app from that manifest would have opened straight to the wrong
// (staff) login screen. patient.html/patient-login.html now link a
// separate manifest-patient.json whose start_url is patient-login.html;
// every staff-facing page keeps the original shared manifest.json.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

function manifestHrefOf(file) {
  const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const m = html.match(/<link rel="manifest" href="([^"]+)">/);
  return m ? m[1] : null;
}

test('manifest-patient.json is valid JSON with a start_url that lands on the patient login, not the staff one', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest-patient.json'), 'utf8'));
  expect(manifest.start_url).toBe('/patient-login.html');
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.length).toBeGreaterThan(0);
});

test('patient.html and patient-login.html link the patient-specific manifest', () => {
  expect(manifestHrefOf('patient.html')).toBe('/manifest-patient.json');
  expect(manifestHrefOf('patient-login.html')).toBe('/manifest-patient.json');
});

test('staff-facing pages still link the original shared manifest, unaffected by the patient-app split', () => {
  for (const file of ['doctor.html', 'secretary.html', 'login.html', 'register.html']) {
    expect(manifestHrefOf(file)).toBe('/manifest.json');
  }
});
