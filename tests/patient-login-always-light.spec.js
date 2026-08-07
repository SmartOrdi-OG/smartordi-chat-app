// Real report, with a screenshot: a patient logging in from a phone with
// system Dark Mode enabled saw patient-login.html switch to a dark theme
// (the page had its own @media(prefers-color-scheme:dark) block) -- on that
// device, text in the form fields became unreadable. On request ("اعملها
// فاتح دايما لان بالوضع الداكن ما بتبين الكتابة"), the page is now always
// light regardless of the device's OS/browser color-scheme setting.
const path = require('path');
const { test, expect } = require('@playwright/test');

test('patient-login.html stays light even when the OS/browser prefers dark', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('file://' + path.join(__dirname, '..', 'patient-login.html'));
  const colors = await page.evaluate(() => ({
    body: getComputedStyle(document.body).backgroundColor,
    card: getComputedStyle(document.querySelector('.card')).backgroundColor,
    inputText: getComputedStyle(document.querySelector('.form-input')).color,
  }));
  // Light body background (from the light gradient) -- not the dark
  // #0f172a the removed media query used to switch to.
  expect(colors.body).not.toBe('rgb(15, 23, 42)');
  // .card{background:white} -- not the dark #1e293b variant.
  expect(colors.card).toBe('rgb(255, 255, 255)');
  // .form-input{color:var(--slate)} = #0f172a -- dark, readable text on the
  // light field background in both cases now, not the removed dark-mode
  // override that also lightened the text color for a dark field.
  expect(colors.inputText).toBe('rgb(15, 23, 42)');
});
