'use strict';

const path = require('path');
const { buildScenarioTestCasesPrompt } = require('./promptTemplates');
const { buildDiscoverTestsPrompt } = require('./promptTemplates');

const PLAYWRIGHT_ROOT = path.join(__dirname, '../../../playwright');
const TEST_CASE_RESPONSE_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['browser', 'api'] },
      title: { type: 'string' },
      description: { type: 'string' }
    },
    required: ['type', 'title', 'description']
  }
};

function localModelEnabled() {
  return String(process.env.LOCAL_AI_ENABLED || '').toLowerCase() === 'true';
}

function localModelConfig() {
  return {
    baseUrl: String(process.env.LOCAL_AI_BASE_URL || 'http://localhost:11434/v1').replace(/\/$/, ''),
    model: process.env.LOCAL_AI_MODEL || 'llama3.2',
    timeoutMs: Number(process.env.LOCAL_AI_TIMEOUT_MS || 120000)
  };
}

function parseJsonArray(content) {
  const text = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const arrayStart = text.indexOf('[');
  const arrayEnd = text.lastIndexOf(']');
  if (arrayStart < 0 || arrayEnd < arrayStart) throw new Error('local model did not return a JSON array');
  const jsonText = text.slice(arrayStart, arrayEnd + 1).replace(/[\u0000-\u001f\u007f]/g, ' ');
  const parsed = JSON.parse(jsonText);
  if (!Array.isArray(parsed)) throw new Error('local model did not return a JSON array');
  return parsed
    .filter((item) => item && item.title && item.description)
    .map((item) => ({
      type: item.type === 'api' ? 'api' : 'browser',
      title: String(item.title).trim(),
      description: String(item.description).trim()
    }));
}

async function generateScenarioCandidatesWithLocalModel({ scenario, limit = 5 }) {
  const config = localModelConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        format: TEST_CASE_RESPONSE_SCHEMA,
        messages: [{ role: 'user', content: buildScenarioTestCasesPrompt(scenario) }]
      }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`local model returned HTTP ${response.status}`);
    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    return parseJsonArray(content).slice(0, Math.max(1, Number(limit) || 5));
  } finally {
    clearTimeout(timeout);
  }
}

async function inspectTargetSite(targetUrl) {
  const { chromium } = require(path.join(PLAYWRIGHT_ROOT, 'node_modules/@playwright/test'));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pages = [];
  const visited = new Set();
  const origin = new URL(targetUrl).origin;
  const urls = [targetUrl];

  try {
    while (urls.length > 0 && pages.length < 5) {
      const url = urls.shift();
      if (visited.has(url)) continue;
      visited.add(url);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });

      const snapshot = await page.evaluate(() => ({
        title: document.title,
        text: document.body?.innerText?.slice(0, 5000) || '',
        links: Array.from(document.querySelectorAll('a[href]')).slice(0, 30).map((link) => ({
          text: (link.innerText || link.getAttribute('aria-label') || '').trim().slice(0, 120),
          href: link.href
        })),
        controls: Array.from(document.querySelectorAll('button, input, select, textarea, [role="button"]'))
          .slice(0, 40)
          .map((element) => ({
            tag: element.tagName.toLowerCase(),
            type: element.getAttribute('type') || '',
            label: (element.innerText || element.getAttribute('aria-label') || element.getAttribute('placeholder') || '').trim().slice(0, 120)
          }))
      }));

      pages.push({ url, ...snapshot });
      for (const link of snapshot.links) {
        if (link.href.startsWith(origin) && !visited.has(link.href)) urls.push(link.href);
      }
    }
    return pages;
  } finally {
    await browser.close();
  }
}

async function discoverTestsWithLocalModel({ targetUrl, limit = 5 }) {
  const pages = await inspectTargetSite(targetUrl);
  const prompt = buildDiscoverTestsPrompt(targetUrl, pages);
  const content = await requestLocalModel(prompt);
  return parseJsonArray(content).slice(0, Math.max(1, Number(limit) || 5));
}

async function requestLocalModel(prompt) {
  const config = localModelConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        format: TEST_CASE_RESPONSE_SCHEMA,
        messages: [{ role: 'user', content: prompt }]
      }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`local model returned HTTP ${response.status}`);
    const payload = await response.json();
    return payload.choices?.[0]?.message?.content;
  } finally {
    clearTimeout(timeout);
  }
}

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

async function generateScenarioCandidatesFromScenario({ scenario, limit = 5 }) {
  if (!localModelEnabled()) return generateScenarioCandidates({ scenario, limit });

  try {
    const generated = await generateScenarioCandidatesWithLocalModel({ scenario, limit });
    return generated.length > 0 ? generated : generateScenarioCandidates({ scenario, limit });
  } catch (error) {
    console.warn(`[local AI scenario generation] ${error.message}; using fallback templates`);
    return generateScenarioCandidates({ scenario, limit });
  }
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
  if (!localModelEnabled()) return generateCandidateTests({ targetUrl, limit });

  try {
    const generated = await discoverTestsWithLocalModel({ targetUrl, limit });
    return generated.length > 0 ? generated : generateCandidateTests({ targetUrl, limit });
  } catch (error) {
    console.warn(`[local AI discovery] ${error.message}; using fallback templates`);
    return generateCandidateTests({ targetUrl, limit });
  }
}

module.exports = {
  generateCandidateTests,
  generateScenarioCandidates,
  generateScenarioCandidatesFromScenario,
  generateDraftSpec,
  discoverTests
};
