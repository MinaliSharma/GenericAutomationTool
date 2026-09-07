// Central place to store known environment URLs. PW_BASE_URL (set per-run by the
// backend from the project's target_url) always wins; these are fallbacks for
// running Playwright standalone (npx playwright test) without the backend.
const environments = {
  dev: process.env.DEV_BASE_URL || '',
  staging: process.env.STAGING_BASE_URL || '',
  prod: process.env.PROD_BASE_URL || '',
};

function getBaseUrl(env = process.env.TEST_ENV || 'dev') {
  return process.env.PW_BASE_URL || environments[env] || '';
}

module.exports = { environments, getBaseUrl };
