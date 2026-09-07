// Playwright global setup — runs once before all tests. Placeholder for logging in
// once and reusing the session (storageState) across tests, instead of every test
// logging in separately. Fill in when a project needs shared authenticated state.
async function globalSetup() {
  // Example (uncomment and adapt when needed):
  // const { chromium } = require('@playwright/test');
  // const browser = await chromium.launch();
  // const page = await browser.newPage();
  // await page.goto(process.env.PW_BASE_URL + '/login');
  // await page.fill('#username', process.env.TEST_USER);
  // await page.fill('#password', process.env.TEST_PASS);
  // await page.click('#submit');
  // await page.context().storageState({ path: 'Data/storageState.json' });
  // await browser.close();
}

module.exports = globalSetup;
