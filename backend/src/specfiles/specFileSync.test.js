const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const specFileSync = require('./specFileSync');

test('writes Cucumber feature only for approved test cases', () => {
  const testCase = {
    id: 999999,
    type: 'browser',
    title: 'Approved flow',
    description: 'Open the page and verify the result.',
    spec_code: "import { test } from '@playwright/test';\ntest('flow', async () => {});\n",
    approved: 0
  };
  const specPath = specFileSync.specFilePath(testCase);
  const featurePath = specFileSync.featureFilePath(testCase);
  const stepDefinitionPath = specFileSync.stepDefinitionFilePath(testCase);

  try {
    specFileSync.writeSpecFile(testCase);
    assert.equal(fs.existsSync(specPath), false);
    assert.equal(fs.existsSync(featurePath), false);
    assert.equal(fs.existsSync(stepDefinitionPath), false);

    specFileSync.writeSpecFile({ ...testCase, approved: 1 });
    assert.equal(fs.existsSync(specPath), true);
    assert.equal(fs.existsSync(featurePath), true);
    assert.equal(fs.existsSync(stepDefinitionPath), true);
    const feature = fs.readFileSync(featurePath, 'utf8');
    const steps = fs.readFileSync(stepDefinitionPath, 'utf8');
    assert.match(feature, /@tc-999999/);
    assert.match(feature, /Given approved test case 999999 has an executable Playwright spec/);
    assert.match(feature, /When approved test case 999999 is executed/);
    assert.match(feature, /Then approved test case 999999 should pass/);
    assert.match(steps, /Given\('approved test case 999999 has an executable Playwright spec'/);
    assert.match(steps, /When\('approved test case 999999 is executed'/);
    assert.match(steps, /Then\('approved test case 999999 should pass'/);
  } finally {
    specFileSync.deleteSpecFile(testCase);
  }
});