// This app is a static multi-file HTML/JS app with no build step and no
// live backend reachable from CI (Supabase requires real credentials/
// network access this environment doesn't have) -- every test loads a
// page directly via a file:// URL and replaces window.supabase with an
// in-memory mock (see tests/helpers/mockSupabase.js) before the page's
// own scripts run. No webServer/baseURL is needed as a result.
const {defineConfig} = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    trace: 'retain-on-failure',
    // This environment pre-installs a single Chromium binary rather than
    // Playwright's own downloaded browsers (headless shell included) --
    // point at it explicitly instead of letting Playwright try to launch
    // a build that was never fetched. CI environments that DO run
    // `playwright install` can simply unset PW_EXECUTABLE_PATH.
    launchOptions: process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {},
  },
});
