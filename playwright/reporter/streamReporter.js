// Custom Playwright Reporter — streams one NDJSON event per line to stdout.
// Runs inside the `npx playwright test` child process. Consumed by the backend
// runner (playwrightRunner.js) which reads stdout line-by-line and JSON.parses
// each line. This contract (field names/shape) is fixed — do not deviate.
//
// Shape: { category, type, payload, testCaseId, createdAt }

const fs = require('fs');
const path = require('path');

// Module-level counter for sequential screenshot filenames (persists across
// the whole reporter run, i.e. across every test in this process).
let screenshotCounter = 0;

function pad3(n) {
  return String(n).padStart(3, '0');
}

function nowIso() {
  return new Date().toISOString();
}

function truncate(str, max = 500) {
  if (typeof str !== 'string') return str;
  return str.length > max ? str.slice(0, max) + '...' : str;
}

function testCaseIdFromTest(test) {
  try {
    const m = test.location.file.match(/tc-(\d+)\.spec\.js$/);
    return m ? Number(m[1]) : null;
  } catch (_e) {
    return null;
  }
}

function categoryFromTest(test) {
  try {
    return test.parent.project().name;
  } catch (_e) {
    return null;
  }
}

function emit(obj) {
  try {
    process.stdout.write(JSON.stringify(obj) + '\n');
  } catch (_e) {
    // last resort — never throw from the emitter itself
  }
}

function emitSystemError(err) {
  emit({
    category: 'system',
    type: 'error',
    payload: { message: err && err.message ? err.message : String(err) },
    testCaseId: null,
    createdAt: nowIso(),
  });
}

const STEP_CATEGORIES = new Set(['pw:api', 'expect', 'test.step']);

class StreamReporter {
  onBegin() {
    // no-op
  }

  onTestBegin(test, _result) {
    try {
      const testCaseId = testCaseIdFromTest(test);
      const category = categoryFromTest(test);
      emit({
        category,
        type: 'step_start',
        payload: { testCaseId, title: test.title },
        testCaseId,
        createdAt: nowIso(),
      });
    } catch (err) {
      emitSystemError(err);
    }
  }

  onStepBegin(test, _result, step) {
    try {
      if (!STEP_CATEGORIES.has(step.category)) return;
      const testCaseId = testCaseIdFromTest(test);
      const category = categoryFromTest(test);
      emit({
        category,
        type: 'tool_call',
        payload: { tool: step.title, input: {} },
        testCaseId,
        createdAt: nowIso(),
      });
    } catch (err) {
      emitSystemError(err);
    }
  }

  onStepEnd(test, _result, step) {
    try {
      if (!STEP_CATEGORIES.has(step.category)) return;
      const testCaseId = testCaseIdFromTest(test);
      const category = categoryFromTest(test);
      const summary = step.error
        ? truncate('FAILED: ' + step.error.message)
        : 'ok';
      emit({
        category,
        type: 'tool_result',
        payload: { tool: step.title, summary },
        testCaseId,
        createdAt: nowIso(),
      });
    } catch (err) {
      emitSystemError(err);
    }
  }

  onTestEnd(test, result) {
    try {
      const testCaseId = testCaseIdFromTest(test);
      const category = categoryFromTest(test);
      const attachments = result.attachments || [];

      for (const attachment of attachments) {
        try {
          if (attachment.contentType === 'image/png' && attachment.path) {
            const screenshotsDir = process.env.PW_SCREENSHOTS_DIR;
            if (screenshotsDir) {
              screenshotCounter += 1;
              const filename = `${pad3(screenshotCounter)}.png`;
              const destPath = path.join(screenshotsDir, filename);
              fs.mkdirSync(screenshotsDir, { recursive: true });
              fs.copyFileSync(attachment.path, destPath);
              emit({
                category,
                type: 'screenshot',
                payload: { path: `screenshots/${filename}` },
                testCaseId,
                createdAt: nowIso(),
              });
            }
            // If PW_SCREENSHOTS_DIR is not set, skip copying silently (per spec)
            // but still no-op emit (no event without a copied file).
          } else if (attachment.name === 'video' && attachment.path) {
            emit({
              category,
              type: 'tool_result',
              payload: { tool: 'artifact', summary: `video saved: ${attachment.path}` },
              testCaseId,
              createdAt: nowIso(),
            });
          } else if (attachment.name === 'trace' && attachment.path) {
            emit({
              category,
              type: 'tool_result',
              payload: { tool: 'artifact', summary: `trace saved: ${attachment.path}` },
              testCaseId,
              createdAt: nowIso(),
            });
          }
        } catch (err) {
          emitSystemError(err);
        }
      }

      const status = result.status === 'passed' ? 'passed' : 'failed';
      const message =
        result.status === 'passed'
          ? 'PASS'
          : result.error && result.error.message
          ? result.error.message
          : result.status;

      emit({
        category,
        type: 'step_result',
        payload: { testCaseId, status, message },
        testCaseId,
        createdAt: nowIso(),
      });
    } catch (err) {
      emitSystemError(err);
    }
  }

  onEnd() {
    // no-op
  }
}

module.exports = StreamReporter;
