'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const db = require('../db/db');

const PLAYWRIGHT_DIR = path.join(db.REPO_ROOT, 'playwright');
const REPORTER_PATH = path.join(PLAYWRIGHT_DIR, 'reporter', 'streamReporter.js');

function truncate(str, max = 800) {
  if (typeof str !== 'string') {
    try {
      str = JSON.stringify(str);
    } catch (e) {
      str = String(str);
    }
  }
  if (str.length > max) {
    return str.slice(0, max) + `... [truncated, ${str.length} chars total]`;
  }
  return str;
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Runs a single test case (browser or api type) via the real Playwright test
 * runner, streaming normalized run_event objects (as produced by the custom
 * streamReporter.js) via onEvent as they happen.
 *
 * @param {{ testCase: object, project: object, runId: number|string, onEvent: Function }} args
 * @returns {Promise<void>}
 */
async function runPlaywrightTest({ testCase, project, runId, onEvent }) {
  const category = testCase.type === 'api' ? 'api' : 'browser';
  const emit = typeof onEvent === 'function' ? onEvent : () => {};

  // relative spec path from PLAYWRIGHT_DIR, e.g. tests/browser/tc-42.spec.js
  const relSpecPath = path.join('tests', testCase.type, `tc-${testCase.id}.spec.js`);
  const absSpecPath = path.join(PLAYWRIGHT_DIR, relSpecPath);

  if (!fs.existsSync(absSpecPath)) {
    emit({
      category,
      type: 'error',
      payload: { message: `no authored spec file found for test case ${testCase.id} at ${relSpecPath}` },
      testCaseId: testCase.id,
      createdAt: nowIso(),
    });
    emit({
      category,
      type: 'step_result',
      payload: { testCaseId: testCase.id, status: 'failed', message: 'no authored spec file' },
      testCaseId: testCase.id,
      createdAt: nowIso(),
    });
    return;
  }

  return new Promise((resolve) => {
    let child;
    let sawStepResult = false;
    let stderrBuf = '';

    try {
      child = spawn(
        'npx',
        ['playwright', 'test', relSpecPath, '--reporter', REPORTER_PATH],
        {
          cwd: PLAYWRIGHT_DIR,
          env: {
            ...process.env,
            PW_BASE_URL: project.target_url || '',
            PW_API_BASE_URL: project.api_base_url || '',
            PW_SCREENSHOTS_DIR: path.join(db.REPO_ROOT, 'runs', String(runId), 'screenshots'),
            PW_OUTPUT_DIR: path.join(db.REPO_ROOT, 'runs', String(runId), 'artifacts', `tc-${testCase.id}`),
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );
    } catch (spawnErr) {
      emit({
        category,
        type: 'error',
        payload: { message: `Failed to spawn playwright test: ${spawnErr.message}` },
        testCaseId: testCase.id,
        createdAt: nowIso(),
      });
      emit({
        category,
        type: 'step_result',
        payload: { testCaseId: testCase.id, status: 'failed', message: `Failed to spawn playwright test: ${spawnErr.message}` },
        testCaseId: testCase.id,
        createdAt: nowIso(),
      });
      resolve();
      return;
    }

    const rl = readline.createInterface({ input: child.stdout });

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let obj;
      try {
        obj = JSON.parse(trimmed);
      } catch (e) {
        // malformed / non-JSON line - skip defensively
        return;
      }
      if (obj && obj.type === 'step_result') {
        sawStepResult = true;
      }
      emit(obj);
    });

    child.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString();
    });

    child.on('error', (err) => {
      // e.g. ENOENT if npx binary isn't found
      emit({
        category,
        type: 'error',
        payload: { message: `playwright process error: ${err.message}` },
        testCaseId: testCase.id,
        createdAt: nowIso(),
      });
    });

    child.on('close', (exitCode) => {
      if (exitCode !== 0 && !sawStepResult) {
        emit({
          category,
          type: 'error',
          payload: { message: `playwright test exited with code ${exitCode}: ${truncate(stderrBuf, 800)}` },
          testCaseId: testCase.id,
          createdAt: nowIso(),
        });
        emit({
          category,
          type: 'step_result',
          payload: {
            testCaseId: testCase.id,
            status: 'failed',
            message: stderrBuf.trim()
              ? truncate(stderrBuf, 800)
              : `playwright test exited with code ${exitCode} and produced no result`,
          },
          testCaseId: testCase.id,
          createdAt: nowIso(),
        });
      }
      resolve();
    });
  });
}

module.exports = { runPlaywrightTest };
