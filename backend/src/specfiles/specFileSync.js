const fs = require('fs');
const path = require('path');
const db = require('../db/db');

const PLAYWRIGHT_DIR = path.join(db.REPO_ROOT, 'playwright');

function specFilePath(testCase) {
  // testCase.type is 'browser' or 'api'
  return path.join(PLAYWRIGHT_DIR, 'tests', testCase.type, `tc-${testCase.id}.spec.js`);
}

function featureFilePath(testCase) {
  return path.join(PLAYWRIGHT_DIR, 'features', testCase.type, `tc-${testCase.id}.feature`);
}

function stepDefinitionFilePath(testCase) {
  return path.join(PLAYWRIGHT_DIR, 'features', 'step_definitions', `tc-${testCase.id}.steps.js`);
}

function escapeGherkin(value) {
  return String(value || '').replace(/\r?\n/g, ' ').trim();
}

function writeFeatureFile(testCase) {
  const filePath = featureFilePath(testCase);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const relativeSpecPath = path.relative(PLAYWRIGHT_DIR, specFilePath(testCase)).split(path.sep).join('/');
  const content = [
    `@tc-${testCase.id}`,
    `Feature: ${escapeGherkin(testCase.title)}`,
    '',
    `  Scenario: ${escapeGherkin(testCase.title)}`,
    `    Given approved test case ${testCase.id} has an executable Playwright spec`,
    `    When approved test case ${testCase.id} is executed`,
    `    Then approved test case ${testCase.id} should pass`,
    '',
    `    # Description: ${escapeGherkin(testCase.description)}`,
    ''
  ].join('\n');
  fs.writeFileSync(filePath, content, 'utf8');
  writeStepDefinitionFile(testCase, relativeSpecPath);
}

function writeStepDefinitionFile(testCase, relativeSpecPath) {
  const filePath = stepDefinitionFilePath(testCase);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const id = Number(testCase.id);
  const content = `const { Given, When, Then, setDefaultTimeout } = require('@cucumber/cucumber');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

setDefaultTimeout(120_000);

Given('approved test case ${id} has an executable Playwright spec', function () {
  const specPath = path.resolve(process.cwd(), ${JSON.stringify(relativeSpecPath)});
  if (!specPath.startsWith(\`\${process.cwd()}\${path.sep}\`) || !fs.existsSync(specPath)) {
    throw new Error(\`Approved Playwright test not found: ${relativeSpecPath}\`);
  }
  this.specPath = ${JSON.stringify(relativeSpecPath)};
});

When('approved test case ${id} is executed', async function () {
  this.playwrightResult = await new Promise((resolve, reject) => {
    const cliPath = require.resolve('@playwright/test/cli');
    const child = spawn(process.execPath, [cliPath, 'test', this.specPath], {
      cwd: process.cwd(),
      env: process.env
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (exitCode) => resolve({ exitCode, output }));
  });
});

Then('approved test case ${id} should pass', function () {
  if (!this.playwrightResult || this.playwrightResult.exitCode !== 0) {
    throw new Error(this.playwrightResult?.output || 'The approved Playwright test was not executed');
  }
});
`;
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeSpecFile(testCase) {
  const filePath = specFilePath(testCase);
  const featurePath = featureFilePath(testCase);
  const stepDefinitionPath = stepDefinitionFilePath(testCase);
  if (!testCase.approved || !testCase.spec_code) {
    if (fs.existsSync(filePath)) fs.rmSync(filePath);
    if (fs.existsSync(featurePath)) fs.rmSync(featurePath);
    if (fs.existsSync(stepDefinitionPath)) fs.rmSync(stepDefinitionPath);
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, testCase.spec_code, 'utf8');
  writeFeatureFile(testCase);
}

function deleteSpecFile(testCase) {
  const filePath = specFilePath(testCase);
  if (fs.existsSync(filePath)) fs.rmSync(filePath);
  const featurePath = featureFilePath(testCase);
  if (fs.existsSync(featurePath)) fs.rmSync(featurePath);
  const stepDefinitionPath = stepDefinitionFilePath(testCase);
  if (fs.existsSync(stepDefinitionPath)) fs.rmSync(stepDefinitionPath);
}

module.exports = {
  specFilePath,
  featureFilePath,
  stepDefinitionFilePath,
  writeSpecFile,
  writeFeatureFile,
  writeStepDefinitionFile,
  deleteSpecFile
};
