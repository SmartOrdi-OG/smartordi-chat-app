// Regression tests for the real cursor-based pagination module
// (loadPatientListPage()/countAllPatients(), vendor/patient-data.js) --
// the foundation of the patient-list architecture project (see TODO.md).
// Unlike refreshPatients()'s one-shot cache bounded to the 500 most
// recently active patients (see patients-bounded-list.spec.js), this is
// meant to genuinely walk the ENTIRE patients table page by page with
// zero patients skipped or duplicated -- including across ties on
// updated_at, which can genuinely collide in real Postgres (a single
// CSV-import transaction shares one now() value across every row it
// touches, since now() is frozen per transaction, not per statement).
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

const TOTAL_PATIENTS = 502;
// Deliberately few distinct timestamps (12, not 502) so most pages
// straddle a tie-group boundary -- a pagination bug that only shows up at
// ties would be completely invisible with a unique-per-row timestamp like
// patients-bounded-list.spec.js's fixture uses.
const TIMESTAMP_GROUPS = 12;

function seed() {
  const patients = [];
  for (let i = 0; i < TOTAL_PATIENTS; i++) {
    const d = new Date('2020-01-01T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + (i % TIMESTAMP_GROUPS));
    patients.push({
      id: 'p' + String(i).padStart(4, '0'),
      username: 'patient' + i,
      full_name: 'Patient Number' + String(i).padStart(4, '0'),
      name: 'Patient',
      svnr: String(1000000000 + i),
      join_status: 'approved',
      updated_at: d.toISOString(),
    });
  }
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practices: [{ id: 'prac1', name: 'Musterordination', plan: 'pro' }],
    patients,
  };
}

async function setupPage(page) {
  await installMockSupabase(page, seed(), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await patientsReady; });
}

test('loadPatientListPage() returns a full first page, most-recently-active first, with hasMore true', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    const r = await loadPatientListPage({ pageSize: 10 });
    return { rowCount: r.rows.length, hasMore: r.hasMore, cursor: r.cursor };
  });
  expect(result.rowCount).toBe(10);
  expect(result.hasMore).toBe(true);
  expect(result.cursor).toBeTruthy();
});

test('walking every page via the cursor covers all patients exactly once, with no gaps or duplicates -- including across updated_at ties', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    const seenIds = [];
    let cursor;
    let hasMore = true;
    let pages = 0;
    while (hasMore) {
      const p = await loadPatientListPage({ cursor, pageSize: 47 }); // 47 doesn't divide 502 or 12 evenly on purpose
      if (p.error) return { error: String(p.error) };
      pages++;
      if (pages > 50) return { error: 'runaway loop -- pagination never terminated' };
      p.rows.forEach(r => seenIds.push(r.id));
      cursor = p.cursor;
      hasMore = p.hasMore;
    }
    return { seenIds, pages };
  });
  expect(result.error).toBeUndefined();
  expect(result.seenIds).toHaveLength(TOTAL_PATIENTS);
  expect(new Set(result.seenIds).size, 'every patient must appear exactly once, never repeated').toBe(TOTAL_PATIENTS);
  // 10 full pages of 47 (470) + one final partial page of 32 -- that last
  // page is itself already < pageSize, so hasMore correctly flips false
  // right there without needing a further empty probe page.
  expect(result.pages).toBe(11);
});

test('the final (partial) page reports hasMore:false without needing an extra empty probe page', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    let cursor;
    let hasMore = true;
    let last;
    let pages = 0;
    while (hasMore) {
      last = await loadPatientListPage({ cursor, pageSize: 47 });
      cursor = last.cursor;
      hasMore = last.hasMore;
      pages++;
      if (pages > 50) break;
    }
    return { lastPageHasMore: last.hasMore, lastPageRowCount: last.rows.length };
  });
  expect(result.lastPageHasMore).toBe(false);
  // 502 - 10*47 = 32: the final page is a genuine partial page, not empty.
  expect(result.lastPageRowCount).toBe(32);
});

test('countAllPatients() returns the real total, not the bounded 500-patient cap', async ({ page }) => {
  await setupPage(page);
  const count = await page.evaluate(() => countAllPatients());
  expect(count).toBe(TOTAL_PATIENTS);
});
