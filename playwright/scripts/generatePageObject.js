'use strict';
// Given a URL, launches a browser, inspects the DOM, and fully auto-generates a
// Page Object (locators + action methods) into its own folder under playwright/pages/.
// Nothing needs to be hand-written — the file is ready to import and use immediately.
// Usage: node scripts/generatePageObject.js <url>

const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const PAGES_DIR = path.join(__dirname, '..', 'pages');

function toPascalCase(str) {
  return str
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('') || 'Untitled';
}

function toCamelCase(str) {
  const pascal = toPascalCase(str);
  const candidate = pascal[0].toLowerCase() + pascal.slice(1);
  return /^\d/.test(candidate) ? `item${candidate}` : candidate;
}

// Best-selector priority: data-testid > id > name > role+accessible-name > visible text.
function buildLocatorExpression(el) {
  if (el.testId) return `page.getByTestId('${el.testId}')`;
  if (el.id) return `page.locator('#${el.id}')`;
  if (el.name) return `page.locator('${el.tag}[name="${el.name}"]')`;
  if (el.role && el.accessibleName) {
    return `page.getByRole('${el.role}', { name: '${el.accessibleName.replace(/'/g, "\\'")}' })`;
  }
  if (el.text) {
    return `page.getByText('${el.text.replace(/'/g, "\\'")}', { exact: true })`;
  }
  return `page.locator('${el.tag}')`;
}

async function discoverElements(page) {
  return page.evaluate(() => {
    function accessibleName(el) {
      return (
        el.getAttribute('aria-label') ||
        el.innerText?.trim() ||
        el.getAttribute('placeholder') ||
        el.getAttribute('value') ||
        ''
      );
    }
    const nodes = Array.from(document.querySelectorAll('input, textarea, select, button, a[href]'));
    return nodes.slice(0, 60).map((el) => ({
      tag: el.tagName.toLowerCase(),
      id: el.id || '',
      name: el.getAttribute('name') || '',
      testId: el.getAttribute('data-testid') || '',
      role: el.getAttribute('role') || (el.tagName.toLowerCase() === 'button' ? 'button' : el.tagName.toLowerCase() === 'a' ? 'link' : ''),
      accessibleName: accessibleName(el),
      text: el.tagName.toLowerCase() === 'button' || el.tagName.toLowerCase() === 'a' ? el.innerText?.trim() || '' : '',
      placeholder: el.getAttribute('placeholder') || '',
      type: el.getAttribute('type') || '',
      readonly: el.hasAttribute('readonly')
    }));
  });
}

function nameForElement(el, usedNames) {
  const base = el.testId || el.id || el.name || el.placeholder || el.accessibleName || el.text || el.tag;
  let candidate = toCamelCase(base);
  let suffix = 1;
  while (usedNames.has(candidate)) {
    candidate = `${toCamelCase(base)}${++suffix}`;
  }
  usedNames.add(candidate);
  return candidate;
}

// Decides what action method(s) an element gets, so the page object is ready to
// use immediately with no hand-written code.
function buildActionMethod(el, propName) {
  const capitalized = propName[0].toUpperCase() + propName.slice(1);
  if (el.tag === 'select') {
    return `  async select${capitalized}(label) {\n    const options = Array.isArray(label) ? label.map((item) => ({ label: item })) : { label };\n    await this.${propName}.selectOption(options);\n  }`;
  }
  if (el.type === 'checkbox' || el.type === 'radio') {
    return `  async check${capitalized}() {\n    await this.${propName}.check();\n  }`;
  }
  if (el.tag === 'button' || el.tag === 'a' || el.type === 'submit' || el.type === 'button') {
    return `  async click${capitalized}() {\n    await this.${propName}.click();\n  }`;
  }
  if (el.readonly) {
    return `  async click${capitalized}() {\n    await this.${propName}.click();\n  }`;
  }
  // input/textarea default to fillable fields
  return `  async fill${capitalized}(value) {\n    await this.${propName}.fill(value);\n  }`;
}

async function generatePageObject(url) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  const title = await page.title();
  const elements = await discoverElements(page);
  await browser.close();

  const usedNames = new Set();
  const locatorLines = [];
  const methodBlocks = [];
  for (const el of elements) {
    if (!el.id && !el.name && !el.testId && !el.accessibleName && !el.text) continue; // skip unnamed noise
    const propName = nameForElement(el, usedNames);
    const expr = buildLocatorExpression(el);
    locatorLines.push(`    this.${propName} = ${expr};`);
    methodBlocks.push(buildActionMethod(el, propName));
  }

  const className = toPascalCase(title || new URL(url).pathname) + 'Page';
  const fileContent = `// Auto-generated Page Object from ${url} — fully generated, ready to use, edit if needed.
import { gotoWithTransientRetry } from '../../utils/navigation.js';

export class ${className} {
  constructor(page) {
    this.page = page;
${locatorLines.join('\n')}
  }

  async goto() {
    await gotoWithTransientRetry(this.page, '${url}');
  }

${methodBlocks.join('\n\n')}
}
`;

  const pageFolder = path.join(PAGES_DIR, className);
  fs.mkdirSync(pageFolder, { recursive: true });
  const filePath = path.join(pageFolder, `${className}.js`);
  fs.writeFileSync(filePath, fileContent, 'utf8');
  return { filePath, className, elementCount: locatorLines.length };
}

if (require.main === module) {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: node scripts/generatePageObject.js <url>');
    process.exit(1);
  }
  generatePageObject(url)
    .then(({ filePath, className, elementCount }) => {
      console.log(`Generated ${className} (${elementCount} locators + action methods) -> ${filePath}`);
    })
    .catch((err) => {
      console.error('Failed to generate page object:', err.message);
      process.exit(1);
    });
}

module.exports = { generatePageObject };
