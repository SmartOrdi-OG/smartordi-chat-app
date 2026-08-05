// Regression test for a real user-reported visual bug: password inputs with
// a .toggle-pw reveal-eye button only reserved 14px of right padding (the
// same as every other input, which has no icon on that side), so a long
// password's last 1-2 characters rendered right underneath the eye icon
// instead of before it. Fixed by giving every input with a toggle-pw
// sibling a wider right padding via a dedicated .has-toggle class.
const path = require('path');
const { test, expect } = require('@playwright/test');

test('patient-login.html: password inputs with a reveal button have enough right padding to clear the icon', async ({ page }) => {
  await page.goto('file://' + path.join(__dirname, '..', 'patient-login.html'));
  for (const id of ['password', 'newPw', 'confirmPw']) {
    const paddingRight = await page.locator('#' + id).evaluate(el => parseFloat(getComputedStyle(el).paddingRight));
    expect(paddingRight, `#${id} should have >=30px right padding to clear the toggle-pw icon`).toBeGreaterThanOrEqual(30);
  }
});

test('login.html: the password input with a reveal button has enough right padding to clear the icon', async ({ page }) => {
  await page.goto('file://' + path.join(__dirname, '..', 'login.html'));
  const paddingRight = await page.locator('#password').evaluate(el => parseFloat(getComputedStyle(el).paddingRight));
  expect(paddingRight).toBeGreaterThanOrEqual(30);
});
