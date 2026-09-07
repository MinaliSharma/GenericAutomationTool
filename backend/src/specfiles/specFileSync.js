const fs = require('fs');
const path = require('path');
const db = require('../db/db');

const PLAYWRIGHT_DIR = path.join(db.REPO_ROOT, 'playwright');

function specFilePath(testCase) {
  // testCase.type is 'browser' or 'api'
  return path.join(PLAYWRIGHT_DIR, 'tests', testCase.type, `tc-${testCase.id}.spec.js`);
}

function writeSpecFile(testCase) {
  if (!testCase.spec_code) return; // nothing to write yet (unauthored)
  const filePath = specFilePath(testCase);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, testCase.spec_code, 'utf8');
}

function deleteSpecFile(testCase) {
  const filePath = specFilePath(testCase);
  if (fs.existsSync(filePath)) fs.rmSync(filePath);
}

module.exports = { specFilePath, writeSpecFile, deleteSpecFile };
