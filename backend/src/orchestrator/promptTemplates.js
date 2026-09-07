/**
 * Prompt-building helpers for the claude CLI orchestrator.
 * Each function returns a plain prompt string (no side effects).
 */

function buildDiscoverTestsPrompt(targetUrl) {
  return `You are an automated QA test discovery agent using Playwright MCP tools.

Target URL: ${targetUrl}

Instructions:
1. Navigate to the target URL using the Playwright MCP navigation tool.
2. Explore the site: use navigation and page snapshot tools to discover key pages,
   forms, links, and interactive flows (e.g. login, search, add-to-cart, signup,
   navigation menus). Follow a handful of the most important flows a QA engineer
   would want covered. Do not perform destructive actions (no account deletion,
   no payment submission).
3. Based on what you find, propose a set of browser test cases that would give good
   coverage of the site's core functionality.

Output requirement (critical):
Return ONLY a raw JSON array, with no prose, no explanation, and no markdown code
fences, in exactly this shape:
[{"type":"browser","title":"<short title>","description":"<plain English steps, one per line>"}]

Every element must have type "browser". Return between 3 and 10 test cases. The
response body must be valid JSON and nothing else.`;
}

function buildScenarioTestCasesPrompt(scenario) {
  return `You are a senior QA test analyst. Convert the following user scenario into a focused
set of browser or API test cases. Do not write Playwright code. Cover the main happy path plus
important negative or boundary cases only when the scenario supports them.

User scenario:
${scenario}

Return ONLY a valid JSON array with 3 to 10 objects in exactly this shape:
[{"type":"browser","title":"short test title","description":"clear executable steps and expected result"}]

Rules:
- type must be exactly "browser" or "api".
- Each title must be unique and action-oriented.
- Each description must say what to do and what observable result to verify.
- Do not invent URLs, credentials, selectors, or unsupported product behavior.
- If the scenario is too vague for a reliable test, return one object whose title is
  "Scenario needs clarification" and whose description lists the missing information.
- Return JSON only, with no markdown or explanation.`;
}

function buildDraftSpecPrompt({ type, title, description, targetUrl, apiBaseUrl, pageObjectContext }) {
  const isApi = type === 'api';

  return `You are an automated QA engineer writing a Playwright Test spec file.

Test case title: "${title}"

Plain-English description of what this test should do:
${description || '(no description provided - infer reasonable behavior from the title alone)'}

${isApi
    ? `This is an API test. Use the \`request\` fixture from @playwright/test, not \`page\`.
API base URL: ${apiBaseUrl || '(not configured - use relative paths)'}
The Playwright config's baseURL is set to the API base URL, so relative paths (e.g. "/users")
work directly with the request fixture.`
    : `This is a browser test. Use the \`page\` fixture from @playwright/test and import
  \`gotoWithTransientRetry\` from \`../../utils/navigation.js\`.
Target URL: ${targetUrl || '(not configured - use the full URL for any navigation)'}
  IMPORTANT: to navigate to the target URL above, use \`await gotoWithTransientRetry(page, '${targetUrl || '<target URL>'}')\`
with the COMPLETE absolute URL, exactly as written above. Do NOT use a relative path like
page.goto('/') or page.goto('/login') for this - the target URL above may already include a
path (e.g. a specific page, not just the site root), and a leading-slash relative path resolves
against the origin, discarding that path and landing on the wrong page. If the test needs to
  navigate to a DIFFERENT page after the target URL, also use that page's complete absolute URL,
  never a bare relative path. Do not use page.goto directly.`}

  ${!isApi && pageObjectContext
    ? `A generated Page Object is available. Import and use it for all browser interactions:
  ${pageObjectContext}
  Do not invent IDs, names, values, roles, or CSS selectors. If an element is not represented
  by the Page Object, do not guess a locator; use only a locator you can prove from the supplied
  Page Object source.`
    : !isApi
      ? 'No Page Object source was supplied. Do not invent selectors from visible text; prefer stable getByRole/getByLabel locators only when the description proves them.'
      : ''}

Instructions:
1. Write a complete, valid Playwright Test spec file body: start with
  \`import { test, expect } from '@playwright/test';\` and, for browser tests,
  \`import { gotoWithTransientRetry } from '../../utils/navigation.js';\` then a single
   \`test('${title}', async ({ ${isApi ? 'request' : 'page'} }) => { ... });\` block that
   implements the description above using real Playwright/expect API calls.
2. Use clear, meaningful assertions (\`expect(...)\`) that actually verify the described
   behavior, not just that the page/request didn't crash.
3. For browser tests, every locator used with an assertion or action must identify exactly one
  element. Prefer \`getByRole\`, \`getByLabel\`, \`getByTestId\`, or a unique \`#id\`.
  Never use comma-separated CSS fallback selectors such as \`page.locator('.primary, #fallback')\`;
  inspect the target element and choose one stable locator instead. For native select elements,
  select by visible label using \`selectOption({ label: 'Visible option text' })\`; do not assume
  that the visible label equals the HTML option value. Assert the actual value only when it is
  known from the Page Object or DOM source. Never call \`fill()\` on a readonly input; click it
  and interact with the date picker or other associated widget instead.
4. Keep it self-contained - no references to external fixtures, helper files, or test data
   that doesn't exist.
5. Do not add extra tests, describe blocks, comments explaining what you're doing, or any
   prose.

Output requirement (critical):
Return ONLY the raw JavaScript source code of the spec file, with no prose, no explanation,
and no markdown code fences (no \`\`\`). The response body must be valid, directly-runnable
JavaScript and nothing else.`;
}

function buildJavaFailureSummaryPrompt(failures) {
  const failureList = Array.isArray(failures)
    ? failures
        .map((f, i) => `${i + 1}. ${f.testName}: ${f.message}`)
        .join('\n')
    : String(failures);

  return `You are summarizing Java test failures for a QA report aimed at a developer audience.

Failures:
${failureList}

Write a short, plain-English paragraph (3-6 sentences) summarizing what went wrong across
these failures, grouping similar failures together where possible, and noting any likely
root cause if it's evident from the failure messages. Do not include code fences or JSON,
just plain prose.`;
}

function buildRunSummaryPrompt(runData) {
  return `You are writing a concise, plain-English narrative summary of an automated QA run
for a non-technical stakeholder.

Run data (JSON):
${JSON.stringify(runData, null, 2)}

Write a short paragraph (3-6 sentences) summarizing: how many test cases passed/failed,
whether Java tests were included and their result, and any notable failures worth
highlighting. Do not include code fences or JSON, just plain prose.`;
}

module.exports = {
  buildDiscoverTestsPrompt,
  buildScenarioTestCasesPrompt,
  buildDraftSpecPrompt,
  buildJavaFailureSummaryPrompt,
  buildRunSummaryPrompt
};
