'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

let claudeRunner = null;
let promptTemplates = null;
try {
  // eslint-disable-next-line global-require
  claudeRunner = require('../orchestrator/claudeRunner');
} catch (e) {
  claudeRunner = null;
}
try {
  // eslint-disable-next-line global-require
  promptTemplates = require('../orchestrator/promptTemplates');
} catch (e) {
  promptTemplates = null;
}

/**
 * Recursively find all files under `dir` matching the given predicate on their
 * relative path, without pulling in a glob dependency.
 */
function findFilesRecursive(dir, predicate, results = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // avoid descending into obviously irrelevant huge dirs
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      findFilesRecursive(full, predicate, results);
    } else if (entry.isFile()) {
      if (predicate(full)) results.push(full);
    }
  }
  return results;
}

function findSurefireReportFiles(repoPath) {
  return findFilesRecursive(repoPath, (filePath) => {
    const normalized = filePath.split(path.sep).join('/');
    return (
      normalized.includes('/target/surefire-reports/') &&
      path.extname(filePath) === '.xml'
    );
  });
}

/**
 * Minimal regex-based extraction of surefire XML reports. Surefire XML report
 * files are well-formed and simple enough that a full XML parser is overkill;
 * we only need the <testsuite> summary attributes and any <testcase> with a
 * nested <failure>/<error> element.
 */
function parseSurefireXml(xmlText) {
  const result = { tests: 0, failures: 0, errors: 0, skipped: 0, failureDetails: [] };

  const suiteMatch = xmlText.match(/<testsuite\b[^>]*>/);
  if (suiteMatch) {
    const suiteTag = suiteMatch[0];
    const getAttr = (name) => {
      const m = suiteTag.match(new RegExp(name + '="([^"]*)"'));
      return m ? Number(m[1]) : 0;
    };
    result.tests = getAttr('tests');
    result.failures = getAttr('failures');
    result.errors = getAttr('errors');
    result.skipped = getAttr('skipped');
  }

  // Extract each <testcase ...>...</testcase> (self-closing testcases have no failures)
  const testcaseRegex = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  let match;
  while ((match = testcaseRegex.exec(xmlText)) !== null) {
    const attrs = match[1];
    const inner = match[3] || '';

    const nameMatch = attrs.match(/name="([^"]*)"/);
    const classnameMatch = attrs.match(/classname="([^"]*)"/);
    const name = nameMatch ? nameMatch[1] : 'unknown';
    const classname = classnameMatch ? classnameMatch[1] : '';
    const testName = classname ? `${classname}.${name}` : name;

    const failureOrErrorMatch = inner.match(
      /<(failure|error)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/
    );
    if (failureOrErrorMatch) {
      const feAttrs = failureOrErrorMatch[2];
      const feInner = failureOrErrorMatch[4] || '';
      const messageMatch = feAttrs.match(/message="([^"]*)"/);
      let message = messageMatch ? messageMatch[1] : '';
      if (!message) {
        // fall back to first line of the inner text (e.g. stack trace) if no message attr
        const firstLine = feInner.trim().split('\n')[0];
        message = firstLine || 'Test failed';
      }
      message = decodeXmlEntities(message);
      result.failureDetails.push({ testName, message });
    }
  }

  return result;
}

function decodeXmlEntities(str) {
  return String(str)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#10;/g, '\n')
    .replace(/&#13;/g, '\r')
    .replace(/&amp;/g, '&');
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Run `mvn -f <repoPath> test`, stream logs, parse surefire XML reports, and
 * emit a java_result event. Optionally emits an AI-written summary of failures.
 *
 * @param {{ repoPath: string, runId: number|string, aiSummary: boolean, onEvent: Function }} args
 */
async function runJavaTests({ repoPath, runId, aiSummary, onEvent }) {
  const emit = (event) => {
    try {
      onEvent({ createdAt: nowIso(), ...event });
    } catch (e) {
      // never let a bad listener crash the runner
    }
  };

  // --- Validate repoPath ---
  if (!repoPath || typeof repoPath !== 'string' || !fs.existsSync(repoPath)) {
    emit({
      category: 'java',
      type: 'error',
      payload: { message: `repoPath does not exist: ${repoPath}` },
    });
    return;
  }

  let stat;
  try {
    stat = fs.statSync(repoPath);
  } catch (e) {
    emit({
      category: 'java',
      type: 'error',
      payload: { message: `Unable to stat repoPath: ${repoPath} (${e.message})` },
    });
    return;
  }

  if (!stat.isDirectory()) {
    emit({
      category: 'java',
      type: 'error',
      payload: { message: `repoPath is not a directory: ${repoPath}` },
    });
    return;
  }

  const pomPath = path.join(repoPath, 'pom.xml');
  if (!fs.existsSync(pomPath)) {
    emit({
      category: 'java',
      type: 'error',
      payload: { message: `repoPath does not look like a Maven project (no pom.xml found): ${repoPath}` },
    });
    return;
  }

  // --- Spawn mvn test ---
  let exitInfo;
  try {
    exitInfo = await new Promise((resolve, reject) => {
      let child;
      try {
        child = spawn('mvn', ['-f', repoPath, 'test'], { cwd: repoPath });
      } catch (spawnErr) {
        reject(spawnErr);
        return;
      }

      child.on('error', (err) => {
        // e.g. ENOENT if mvn binary isn't found
        reject(err);
      });

      const handleStream = (stream) => {
        let buffer = '';
        stream.on('data', (chunk) => {
          buffer += chunk.toString('utf8');
          let idx;
          // eslint-disable-next-line no-cond-assign
          while ((idx = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, idx).replace(/\r$/, '');
            buffer = buffer.slice(idx + 1);
            emit({ category: 'java', type: 'java_log', payload: { line } });
          }
        });
        stream.on('end', () => {
          if (buffer.length > 0) {
            emit({ category: 'java', type: 'java_log', payload: { line: buffer } });
            buffer = '';
          }
        });
      };

      handleStream(child.stdout);
      handleStream(child.stderr);

      child.on('close', (code) => {
        resolve({ code });
      });
    });
  } catch (err) {
    emit({
      category: 'java',
      type: 'error',
      payload: { message: `Failed to spawn mvn: ${err.message}` },
    });
    return;
  }

  // --- Parse surefire reports (regardless of mvn exit code) ---
  const reportFiles = findSurefireReportFiles(repoPath);

  let total = 0;
  let failedCount = 0;
  let errorsCount = 0;
  const failures = [];

  for (const file of reportFiles) {
    let xmlText;
    try {
      xmlText = fs.readFileSync(file, 'utf8');
    } catch (e) {
      continue;
    }
    const parsed = parseSurefireXml(xmlText);
    total += parsed.tests;
    failedCount += parsed.failures;
    errorsCount += parsed.errors;
    for (const f of parsed.failureDetails) {
      failures.push(f);
    }
  }

  const passed = Math.max(0, total - failedCount - errorsCount);

  const javaResultPayload = {
    total,
    passed,
    failed: failedCount,
    errors: errorsCount,
    failures,
  };

  emit({ category: 'java', type: 'java_result', payload: javaResultPayload });

  // --- Summary: AI-written (opt-in) or deterministic fallback ---
  let aiSummaryEmitted = false;
  if (aiSummary && failures.length > 0) {
    try {
      if (!claudeRunner) {
        // try re-requiring in case it became available after module load
        // (e.g. the orchestrator subagent finished after this module was first required)
        claudeRunner = require('../orchestrator/claudeRunner');
      }
      if (!promptTemplates) {
        promptTemplates = require('../orchestrator/promptTemplates');
      }

      if (
        claudeRunner &&
        typeof claudeRunner.runClaudePrompt === 'function' &&
        promptTemplates &&
        typeof promptTemplates.buildJavaFailureSummaryPrompt === 'function'
      ) {
        const prompt = promptTemplates.buildJavaFailureSummaryPrompt(failures);
        const repoRootForPrompt = path.resolve(__dirname, '..', '..', '..');
        const summaryText = await claudeRunner.runClaudePrompt({
          prompt,
          cwd: repoRootForPrompt,
        });
        emit({ category: 'java', type: 'summary', payload: { text: summaryText } });
        aiSummaryEmitted = true;
      }
    } catch (e) {
      // AI summary is best-effort; never fail the runner because of it.
    }
  }

  if (!aiSummaryEmitted) {
    const deterministicText =
      failures.length > 0
        ? `${failures.length} test(s) failed: ${failures.map((f) => f.testName).join(', ')}`
        : `All ${total} Java tests passed.`;
    emit({ category: 'java', type: 'summary', payload: { text: deterministicText } });
  }
}

module.exports = { runJavaTests, __internal: { parseSurefireXml, findSurefireReportFiles } };
