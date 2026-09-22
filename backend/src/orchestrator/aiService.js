'use strict';

const path = require('path');
const {
  buildScenarioTestCasesPrompt,
  buildDiscoverTestsPrompt,
  buildDraftSpecPrompt
} = require('./promptTemplates');

const PLAYWRIGHT_ROOT = path.join(__dirname, '../../../playwright');
const TEST_CASE_RESPONSE_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['browser', 'api'] },
      title: { type: 'string' },
      description: { type: 'string' },
      targetUrl: { type: 'string' }
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
      description: String(item.description).trim(),
      targetUrl: typeof item.targetUrl === 'string' ? item.targetUrl.trim() : ''
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

function isIdentifierSegment(segment) {
  const decoded = decodeURIComponent(segment);
  return /^\d+$/.test(decoded) ||
    /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(decoded) ||
    /^[0-9a-f]{16,}$/i.test(decoded) ||
    /^[A-Za-z0-9_-]{20,}$/.test(decoded);
}

function discoveryRouteKey(url, relatedUrls = []) {
  const parsed = new URL(url);
  const segments = parsed.pathname.split('/').filter(Boolean);
  const siblings = relatedUrls
    .map((candidate) => {
      try {
        const sibling = new URL(candidate);
        return sibling.origin === parsed.origin ? sibling.pathname.split('/').filter(Boolean) : null;
      } catch (_error) {
        return null;
      }
    })
    .filter((candidate) => candidate && candidate.length === segments.length && candidate[0] === segments[0]);

  const templateSegments = segments.map((segment, index) => {
    if (isIdentifierSegment(segment)) return ':value';
    const values = new Set(siblings.map((sibling) => sibling[index]));
    return siblings.length >= 3 && values.size >= 3 ? ':value' : segment;
  });
  const queryKey = [...parsed.searchParams.keys()].sort().map((key) => `${key}=:value`).join('&');
  return `/${templateSegments.join('/')}${queryKey ? `?${queryKey}` : ''}`;
}

async function inspectTargetSite(targetUrl) {
  const { chromium } = require(path.join(PLAYWRIGHT_ROOT, 'node_modules/@playwright/test'));
  const headless = String(process.env.DISCOVERY_HEADLESS || '').toLowerCase() === 'true';
  const browser = await chromium.launch({
    headless,
    slowMo: headless ? 0 : Number(process.env.DISCOVERY_SLOW_MO_MS || 250)
  });
  const page = await browser.newPage();
  const pages = [];
  const visited = new Set();
  const visitedRouteKeys = new Set();
  const origin = new URL(targetUrl).origin;
  const maxPages = Math.max(1, Number(process.env.DISCOVERY_MAX_PAGES || 100));
  const urls = [targetUrl];

  try {
    while (urls.length > 0 && pages.length < maxPages) {
      const nextUrl = new URL(urls.shift());
      nextUrl.hash = '';
      const url = nextUrl.href;
      if (visited.has(url)) continue;
      visited.add(url);
      const routeKey = discoveryRouteKey(url, [...visited, ...urls]);
      if (visitedRouteKeys.has(routeKey)) continue;
      visitedRouteKeys.add(routeKey);
      console.log(`[discovery] opening ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      await page.evaluate(async () => {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        await new Promise((resolve) => setTimeout(resolve, 500));
        window.scrollTo({ top: 0, behavior: 'smooth' });
        await new Promise((resolve) => setTimeout(resolve, 500));
      });

      const snapshot = await page.evaluate(() => ({
        title: document.title,
        text: document.body?.innerText?.slice(0, 2000) || '',
        links: Array.from(document.querySelectorAll('a[href]')).slice(0, 100).map((link) => ({
          text: (link.innerText || link.getAttribute('aria-label') || '').trim().slice(0, 120),
          href: link.href
        })),
        controls: Array.from(document.querySelectorAll('button, input, select, textarea, [role="button"]'))
          .slice(0, 100)
          .map((element) => ({
            tag: element.tagName.toLowerCase(),
            type: element.getAttribute('type') || '',
            id: element.id || '',
            name: element.getAttribute('name') || '',
            required: element.required || element.getAttribute('aria-required') === 'true',
            formId: element.form?.id || '',
            formAction: element.form?.getAttribute('action') || '',
            label: (element.innerText || element.getAttribute('aria-label') || element.getAttribute('placeholder') || '').trim().slice(0, 120)
          }))
      }));

      pages.push({ url, ...snapshot });
      for (const link of snapshot.links) {
        try {
          const linkedUrl = new URL(link.href);
          linkedUrl.hash = '';
          if (
            linkedUrl.origin === origin &&
            !/\b(logout|signout|delete|remove)\b/i.test(`${link.text} ${linkedUrl.pathname}`) &&
            !visited.has(linkedUrl.href)
          ) {
            urls.push(linkedUrl.href);
          }
        } catch (_error) {
          // Ignore malformed and non-HTTP links.
        }
      }
    }
    return pages;
  } finally {
    await browser.close();
  }
}

function ensureObservedPageCoverage(candidates, pages) {
  const coveredUrls = new Set(candidates.map((item) => item.targetUrl).filter(Boolean));
  const additions = [];
  const coveredFormSignatures = new Set();
  const coveredSearchSignatures = new Set();
  for (const page of pages) {
    const pageName = page.title || new URL(page.url).pathname || 'Page';
    if (!coveredUrls.has(page.url)) {
      additions.push({
        type: 'browser',
        title: `${pageName} navigation and content`,
        description: `Open ${page.url}. Verify the page heading, primary content, and navigation links are visible and usable.`,
        targetUrl: page.url
      });
    }

    const formGroups = new Map();
    for (const control of page.controls) {
      const formKey = `${control.formId || ''}|${control.formAction || ''}`;
      if (formKey === '|') continue;
      if (!formGroups.has(formKey)) formGroups.set(formKey, []);
      formGroups.get(formKey).push(control);
    }
    for (const controls of formGroups.values()) {
      const fields = controls.filter((control) => ['input', 'textarea', 'select'].includes(control.tag) && control.type !== 'submit');
      const submitControl = controls.find((control) => control.type === 'submit' || /submit|send|login|signup|search|continue|checkout/i.test(control.label));
      const formSignature = controls
        .map((control) => `${control.tag}:${control.type}:${control.id}:${control.name}:${control.formAction}:${control.label}`.toLowerCase())
        .sort()
        .join('|');
      if (fields.length === 0 || !submitControl || coveredFormSignatures.has(formSignature)) continue;

      coveredFormSignatures.add(formSignature);
      const formName = submitControl.label || submitControl.formAction || submitControl.formId || 'form';
      additions.push({
        type: 'browser',
        title: `${pageName} ${formName} valid submission`,
        description: `Open ${page.url}. Enter valid values in ${fields.map((field) => field.label || field.name || field.type || field.tag).join(', ')}. Submit with ${submitControl.label || 'the submit control'} and verify the expected success or next-page state.`,
        targetUrl: page.url
      });
      additions.push({
        type: 'browser',
        title: `${pageName} ${formName} required-field validation`,
        description: `Open ${page.url}. Leave required fields empty, submit with ${submitControl.label || 'the submit control'}, and verify submission is blocked with visible validation feedback.`,
        targetUrl: page.url
      });
      if (fields.some((field) => field.type === 'email')) {
        additions.push({
          type: 'browser',
          title: `${pageName} ${formName} rejects invalid email`,
          description: `Open ${page.url}. Enter an invalid email format, complete other required fields with valid values, submit the form, and verify email validation prevents submission.`,
          targetUrl: page.url
        });
      }
    }

    const fields = page.controls.filter((control) => ['input', 'textarea', 'select'].includes(control.tag));
    const searchField = fields.find((field) => /search/i.test(`${field.label} ${field.name} ${field.id}`));
    const searchSignature = searchField ? `${searchField.type}:${searchField.id}:${searchField.name}:${searchField.label}`.toLowerCase() : '';
    if (searchField && !coveredSearchSignatures.has(searchSignature)) {
      coveredSearchSignatures.add(searchSignature);
      additions.push({
        type: 'browser',
        title: `${pageName} search positive and no-results flows`,
        description: `Open ${page.url}. Search for a visible item and verify matching results. Then search for a unique nonexistent value and verify the empty or no-results state.`,
        targetUrl: page.url
      });
    }
  }
  return [...candidates, ...additions];
}

async function discoverTestsWithLocalModel({ targetUrl, pages }) {
  const prompt = buildDiscoverTestsPrompt(targetUrl, pages);
  const content = await requestLocalModel(prompt);
  return ensureObservedPageCoverage(parseJsonArray(content), pages);
}

async function requestLocalModel(prompt, responseFormat = TEST_CASE_RESPONSE_SCHEMA) {
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
        ...(responseFormat ? { format: responseFormat } : {}),
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

async function generateDraftSpecFromTestCase(testCase) {
  if (!localModelEnabled()) return generateDraftSpec(testCase);

  try {
    let prompt = buildDraftSpecPrompt(testCase);
    let source = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const content = await requestLocalModel(prompt, null);
      source = String(content || '')
        .trim()
        .replace(/^```(?:javascript|js)?\s*/i, '')
        .replace(/\s*```$/i, '');
      const expectedPageObjectImport = String(testCase.pageObjectContext || '').match(/^Import path:\s*(.+)$/m)?.[1];
      if (expectedPageObjectImport) {
        source = source.replace(
          /from\s+['"][^'"]*\/pages\/[^'"]+['"]/g,
          `from '${expectedPageObjectImport}'`
        );
      }
      const hasAssertion = /await\s+expect\s*\(/.test(source);
      const hasInteraction = testCase.type === 'api' || /\.(?:fill|click|check|selectOption|press)\s*\(/.test(source);
      const hasAmbiguousTextLocator = /locator\(\s*['"]text=/.test(source);
      const pageObjectImports = [...source.matchAll(/from\s+['"]([^'"]*\/pages\/[^'"]+)['"]/g)];
      const hasInvalidPageObjectImport = pageObjectImports.some((match) => !match[1].endsWith('.js'));
      const hasStaticPageObjectLocator = /page\.locator\(\s*[A-Z][A-Za-z0-9]*Page\./.test(source);
      if (
        source &&
        hasAssertion &&
        hasInteraction &&
        !hasAmbiguousTextLocator &&
        !hasInvalidPageObjectImport &&
        !hasStaticPageObjectLocator
      ) return source;
      prompt += `\n\nYour previous response was incomplete or unsafe. Return a corrected complete spec with at least one real user interaction and at least one awaited assertion written as "await expect(...)". Assert the resulting page state, heading, URL, or unique result container. Do not use locator('text=...') because it can match hidden or duplicate elements. Any Page Object import must use the complete supplied import path including its filename and .js extension. Page Object locators are instance properties: construct the imported class with "const pageObject = new PageClass(page)" and use pageObject.locatorName directly; never pass PageClass.locatorName to page.locator().`;
    }
    return generateDraftSpec(testCase);
  } catch (error) {
    console.warn(`[local AI draft generation] ${error.message}; using fallback spec`);
    return generateDraftSpec(testCase);
  }
}

function generateCandidateTests({ targetUrl, limit = 5 }) {
  return buildDefaultCandidates({ targetUrl, limit });
}

async function discoverTests({ targetUrl, pages = [] }) {
  const observedPages = pages.length > 0 ? pages : await inspectTargetSite(targetUrl);
  if (!localModelEnabled()) return ensureObservedPageCoverage([], observedPages);

  try {
    const generated = await discoverTestsWithLocalModel({ targetUrl, pages: observedPages });
    return generated.length > 0 ? generated : ensureObservedPageCoverage([], observedPages);
  } catch (error) {
    console.warn(`[local AI discovery] ${error.message}; using fallback templates`);
    return ensureObservedPageCoverage([], observedPages);
  }
}

async function generatePageObjectForTarget(targetUrl) {
  const { generatePageObject } = require(path.join(PLAYWRIGHT_ROOT, 'scripts/generatePageObject.js'));
  return generatePageObject(targetUrl);
}

module.exports = {
  generateCandidateTests,
  generateScenarioCandidates,
  generateScenarioCandidatesFromScenario,
  generateDraftSpec,
  generateDraftSpecFromTestCase,
  discoverTests,
  inspectTargetSite,
  discoveryRouteKey,
  generatePageObjectForTarget
};
