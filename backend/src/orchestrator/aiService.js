'use strict';

function normalizeUrl(url) {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (e) {
    return String(url)
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0] || '';
  }
}

function buildDefaultCandidates({ targetUrl, limit = 5 }) {
  const host = normalizeUrl(targetUrl);
  const hostTokens = host ? host.split('.').filter(Boolean) : [];
  const keywordHints = hostTokens.length ? hostTokens.join(' ') : 'site';
  const firstKeyword = keywordHints.split(' ')[0] || 'Core';
  const derivedTitle = firstKeyword.replace(/[^a-z0-9]/gi, '').slice(0, 18) || 'Core';

  const generic = [
    {
      type: 'browser',
      title: 'Homepage loads with core navigation visible',
      description: `Open ${targetUrl || 'the target homepage'} and verify the main navigation, brand/header, and primary call-to-action are visible without layout errors.`
    },
    {
      type: 'browser',
      title: 'Search or filtering flow works',
      description: 'Use the search field or category filter to find relevant content and confirm the results update correctly with the expected items.'
    },
    {
      type: 'browser',
      title: 'Primary form submission works',
      description: 'Fill out the main contact or signup form with valid values and verify the success state or confirmation message appears.'
    },
    {
      type: 'browser',
      title: 'Key page navigation works',
      description: 'Navigate through the top-level menu or major links and confirm each page loads, shows consistent content, and returns without broken redirects.'
    },
    {
      type: 'browser',
      title: `${derivedTitle} user journey is successful`,
      description: 'Exercise the primary user journey for this application, such as browsing content, selecting an item, and completing the main business action with visible confirmation.'
    }
  ];

  if (host && /shop|store|product|cart|catalog|search|sale/.test(host)) {
    generic.splice(1, 0, {
      type: 'browser',
      title: 'Product listing and selection flow works',
      description: 'Open the products or catalog page, select a product, and verify the detail view loads the expected information and product actions.'
    });
  }

  return generic.slice(0, Math.max(1, Number(limit) || 5));
}

function generateScenarioCandidates({ scenario, limit = 5 }) {
  const text = String(scenario || '').trim();
  const baseTitle = text ? text.split(/\s+/).slice(0, 4).join(' ') : 'Scenario check';
  const titlePrefix = baseTitle || 'Scenario check';

  const candidates = [
    {
      type: 'browser',
      title: `${titlePrefix} loads successfully`,
      description: `Start from the target page and verify the main flow for "${text || 'the described scenario'}" loads without errors and shows the user-facing starting state.`
    },
    {
      type: 'browser',
      title: `${titlePrefix} happy path works`,
      description: `Exercise the primary happy path for "${text || 'the described scenario'}" and confirm the expected success state is visible and consistent.`
    },
    {
      type: 'browser',
      title: `${titlePrefix} validation is enforced`,
      description: `Submit incomplete or invalid input for "${text || 'the described scenario'}" and confirm that validation feedback is shown instead of a silent failure.`
    }
  ];

  return candidates.slice(0, Math.max(1, Number(limit) || 5));
}

function generateDraftSpec({ type, title, description, targetUrl, apiBaseUrl }) {
  const isApi = type === 'api';
  const safeTitle = String(title || 'Generated test').replace(/['"\\]/g, '');
  const safeDescription = String(description || 'Verify the expected behavior from the target page.');
  // Block-comment form so multi-line descriptions can't break out into raw statements.
  const descriptionComment = `/* Description:\n${safeDescription.replace(/\*\//g, '*\\/')}\n*/`;
  const safeTarget = targetUrl || 'https://example.com';
  const safeApiBase = apiBaseUrl || 'https://example.com';

  if (isApi) {
    return `import { test, expect } from '@playwright/test';\n\n${descriptionComment}\ntest('${safeTitle}', async ({ request }) => {\n  const response = await request.get('${safeApiBase}/');\n  expect(response.ok()).toBeTruthy();\n  const body = await response.json().catch(() => null);\n  expect(body !== null || response.status() < 500).toBeTruthy();\n});\n`;
  }

  return `import { test, expect } from '@playwright/test';\nimport { gotoWithTransientRetry } from '../../utils/navigation.js';\n\n${descriptionComment}\ntest('${safeTitle}', async ({ page }) => {\n  await gotoWithTransientRetry(page, '${safeTarget}');\n  await expect(page).toHaveURL(/.+/);\n  await expect(page.locator('body')).toBeVisible();\n});\n`;
}

function generateCandidateTests({ targetUrl, limit = 5 }) {
  return buildDefaultCandidates({ targetUrl, limit });
}

async function discoverTests({ targetUrl, limit = 5 }) {
  return generateCandidateTests({ targetUrl, limit });
}

module.exports = {
  generateCandidateTests,
  generateScenarioCandidates,
  generateDraftSpec,
  discoverTests
};
