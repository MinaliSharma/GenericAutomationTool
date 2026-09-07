'use strict';

/**
 * backend/src/report/reportBuilder.js
 *
 * Templating approach: `{{PLACEHOLDER}}`-style tokens in ./template.html.
 * template.html is loaded, its top-level placeholders (project/status/duration/
 * timestamps/AI summary/run id) are substituted, and two placeholders
 * (`{{TEST_CASES_HTML}}`, `{{JAVA_SECTION_HTML}}`) are substituted with larger
 * HTML fragments that are themselves built with plain JS template literals
 * (one fragment per test case, one for the Java results table). This avoids
 * pulling in a templating-engine dependency while keeping the overall page
 * layout/CSS/script easy to review and edit as a real .html file.
 *
 * No external assets: all CSS/JS is inline in template.html, all screenshots
 * are inlined as base64 data: URIs read from disk at build time.
 */

const fs = require('fs');
const path = require('path');

const db = require('../db/db');
const claudeRunner = require('../orchestrator/claudeRunner');

let buildRunSummaryPrompt;
try {
  // Prefer the shared prompt-builder if the orchestrator subagent has provided one.
  ({ buildRunSummaryPrompt } = require('../orchestrator/promptTemplates'));
} catch (e) {
  buildRunSummaryPrompt = null;
}

const TEMPLATE_PATH = path.join(__dirname, 'template.html');
const REPO_ROOT = db.REPO_ROOT || path.resolve(__dirname, '..', '..', '..');

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fallbackRunSummaryPrompt(runData) {
  return `You are writing a concise, plain-English narrative summary of an automated QA run
for a non-technical stakeholder.

Run data (JSON):
${JSON.stringify(runData, null, 2)}

Write a short paragraph (3-6 sentences) summarizing: how many test cases passed/failed,
whether Java tests were included and their result, and any notable failures worth
highlighting. Do not include code fences or JSON, just plain prose.`;
}

function formatDuration(startIso, endIso) {
  if (!startIso || !endIso) return 'N/A';
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 'N/A';
  let totalSec = Math.round((end - start) / 1000);
  const hrs = Math.floor(totalSec / 3600);
  totalSec -= hrs * 3600;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec - mins * 60;
  const parts = [];
  if (hrs) parts.push(`${hrs}h`);
  if (mins) parts.push(`${mins}m`);
  parts.push(`${secs}s`);
  return parts.join(' ');
}

function formatTimestamp(iso) {
  if (!iso) return 'N/A';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toUTCString();
}

/** Reads a screenshot file relative to runs/<runId>/ and returns a data: URI, or null. */
function loadScreenshotDataUri(runId, relPath) {
  try {
    const abs = path.join(REPO_ROOT, 'runs', String(runId), relPath);
    const buf = fs.readFileSync(abs);
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// event rendering
// ---------------------------------------------------------------------------

function renderEvent(runId, ev) {
  const timeLabel = formatTimestamp(ev.createdAt);
  const payload = ev.payload || {};
  let statusClass = '';
  let detailHtml = '';

  switch (ev.type) {
    case 'step_start': {
      detailHtml = `<div class="event-detail">Started: <strong>${escapeHtml(payload.title || '')}</strong></div>`;
      break;
    }
    case 'tool_call': {
      detailHtml = `<div class="event-detail"><code>${escapeHtml(payload.tool || 'unknown tool')}(${escapeHtml(
        JSON.stringify(payload.input || {})
      )})</code></div>`;
      break;
    }
    case 'tool_result': {
      detailHtml = `<div class="event-detail"><pre>${escapeHtml(payload.summary || '')}</pre></div>`;
      break;
    }
    case 'screenshot': {
      const dataUri = loadScreenshotDataUri(runId, payload.path);
      if (dataUri) {
        detailHtml = `<div class="event-detail"><img src="${dataUri}" alt="Screenshot ${escapeHtml(
          payload.path
        )}" loading="lazy" /></div>`;
      } else {
        detailHtml = `<div class="event-detail screenshot-missing">Screenshot file not found on disk: ${escapeHtml(
          payload.path
        )}</div>`;
      }
      break;
    }
    case 'step_result': {
      statusClass = payload.status === 'passed' ? 'status-passed' : 'status-failed';
      detailHtml = `<div class="event-detail">Result: <strong>${escapeHtml(
        (payload.status || '').toUpperCase()
      )}</strong>${payload.message ? ` &mdash; ${escapeHtml(payload.message)}` : ''}</div>`;
      break;
    }
    case 'error': {
      detailHtml = `<div class="event-detail">${escapeHtml(payload.message || 'Unknown error')}</div>`;
      break;
    }
    default: {
      detailHtml = `<div class="event-detail"><pre>${escapeHtml(JSON.stringify(payload))}</pre></div>`;
    }
  }

  return `<li class="event type-${escapeHtml(ev.type)} ${statusClass}">
    <div class="event-head">
      <span class="event-kind">${escapeHtml(ev.type)}</span>
      <span class="event-time">${escapeHtml(timeLabel)}</span>
    </div>
    ${detailHtml}
  </li>`;
}

// ---------------------------------------------------------------------------
// per-test-case section
// ---------------------------------------------------------------------------

function computeTestCaseStatus(events) {
  let last = null;
  for (const ev of events) {
    if (ev.type === 'step_result') last = ev;
  }
  if (!last) return 'unknown';
  return last.payload && last.payload.status === 'passed' ? 'passed' : 'failed';
}

function renderTestCaseSection(runId, testCase, events) {
  const status = computeTestCaseStatus(events);
  const statusLabel = status === 'unknown' ? 'NO RESULT' : status.toUpperCase();
  const timelineHtml = events.length
    ? `<ol class="timeline">${events.map((ev) => renderEvent(runId, ev)).join('\n')}</ol>`
    : `<p class="no-events">No events recorded for this test case.</p>`;

  return `<div class="tc-card collapsed" data-status="${escapeHtml(status)}">
    <div class="tc-header">
      <span class="tc-toggle">&#9654;</span>
      <span class="tc-title">${escapeHtml(testCase.title)}</span>
      <span class="tc-type-badge">${escapeHtml(testCase.type)}</span>
      <span class="tc-status-badge ${escapeHtml(status)}">${escapeHtml(statusLabel)}</span>
    </div>
    <div class="tc-body">
      ${timelineHtml}
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// java section
// ---------------------------------------------------------------------------

function renderJavaSection(javaResult) {
  if (!javaResult) {
    return `<section class="java-section">
      <h2>Java Tests</h2>
      <p class="no-events">Java tests were included in this run, but no result was reported.</p>
    </section>`;
  }

  const { total = 0, passed = 0, failed = 0, errors = 0, failures = [] } = javaResult;
  const failuresByName = new Map();
  for (const f of failures || []) {
    failuresByName.set(f.testName, f.message);
  }

  // Build a synthetic set of rows: failing/erroring tests get a row with their
  // message; we don't have individual passing test names in the aggregated
  // payload, so passing tests are represented by the summary line + failure rows.
  const rows = (failures || []).map((f) => {
    return `<tr>
      <td>${escapeHtml(f.testName)}</td>
      <td><span class="java-row-status failed">FAILED</span></td>
      <td>${escapeHtml(f.message || '')}</td>
    </tr>`;
  });

  const rowsHtml = rows.length
    ? rows.join('\n')
    : `<tr><td colspan="3">No individual failures reported.</td></tr>`;

  return `<section class="java-section">
    <h2>Java Tests</h2>
    <p class="java-summary-line">Total: <strong>${total}</strong> &middot; Passed: <strong>${passed}</strong> &middot; Failed: <strong>${failed}</strong> &middot; Errors: <strong>${errors}</strong></p>
    <table class="java-table">
      <thead>
        <tr><th>Test</th><th>Status</th><th>Failure Message</th></tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  </section>`;
}

// ---------------------------------------------------------------------------
// main entry point
// ---------------------------------------------------------------------------

/**
 * Builds the self-contained HTML report for a run, writes it to
 * runs/<runId>/report.html, and updates the run row (status, finished_at,
 * report_path, summary_text).
 *
 * @param {object} opts
 * @param {number} opts.runId
 * @returns {Promise<{ reportPath: string, absoluteReportPath: string, status: string }>}
 */
async function buildReport({ runId }) {
  const run = db.getRun(runId);
  if (!run) {
    throw new Error(`buildReport: no run found with id ${runId}`);
  }

  const project = db.getProject(run.project_id) || {};
  const testCases = db.listRunTestCases(runId) || [];
  const events = db.listRunEvents(runId) || [];

  // Group events by test case id (browser/api categories), and pull out
  // java-category and system/summary events separately.
  const eventsByTestCase = new Map();
  for (const tc of testCases) eventsByTestCase.set(tc.id, []);

  const javaEvents = [];
  let summaryEvent = null;

  for (const ev of events) {
    if (ev.category === 'java') {
      javaEvents.push(ev);
      continue;
    }
    if (ev.category === 'system' && ev.type === 'summary') {
      summaryEvent = ev;
      continue;
    }
    if (ev.testCaseId !== null && ev.testCaseId !== undefined) {
      if (!eventsByTestCase.has(ev.testCaseId)) eventsByTestCase.set(ev.testCaseId, []);
      eventsByTestCase.get(ev.testCaseId).push(ev);
    }
  }

  const javaResultEvent = javaEvents.find((ev) => ev.type === 'java_result');
  const javaResult = javaResultEvent ? javaResultEvent.payload : null;

  // ---- per-test-case status + HTML ----
  const testCaseStatuses = testCases.map((tc) => ({
    id: tc.id,
    title: tc.title,
    type: tc.type,
    status: computeTestCaseStatus(eventsByTestCase.get(tc.id) || [])
  }));

  const testCasesHtml = testCases.length
    ? testCases
        .map((tc) => renderTestCaseSection(runId, tc, eventsByTestCase.get(tc.id) || []))
        .join('\n')
    : `<p class="no-events">No test cases were associated with this run.</p>`;

  const includeJava = !!run.include_java;
  const javaSectionHtml = includeJava ? renderJavaSection(javaResult) : '';

  // ---- overall status ----
  const allTestCasesPassed = testCaseStatuses.length > 0 && testCaseStatuses.every((tc) => tc.status === 'passed');
  const javaPassed = !includeJava || (javaResult && javaResult.failed === 0 && javaResult.errors === 0);
  const overallStatus = allTestCasesPassed && javaPassed ? 'passed' : 'failed';

  // ---- summary: AI-written (opt-in via run.ai_summary) or deterministic ----
  let summaryText = summaryEvent ? summaryEvent.payload.text : run.summary_text;

  if (!summaryText) {
    if (run.ai_summary) {
      const runData = {
        projectName: project.name,
        targetUrl: project.target_url,
        includeJava,
        testCases: testCaseStatuses.map(({ title, type, status }) => ({ title, type, status })),
        javaResult: includeJava ? javaResult : null,
        overallStatus
      };
      const prompt = buildRunSummaryPrompt ? buildRunSummaryPrompt(runData) : fallbackRunSummaryPrompt(runData);
      try {
        summaryText = await claudeRunner.runClaudePrompt({ prompt, cwd: REPO_ROOT });
      } catch (e) {
        summaryText = `(AI summary unavailable: ${e.message})`;
      }
    } else {
      const passedCount = testCaseStatuses.filter((tc) => tc.status === 'passed').length;
      const totalCount = testCaseStatuses.length;
      let text = `${passedCount}/${totalCount} test cases passed.`;
      if (includeJava && javaResult) {
        text += ` Java: ${javaResult.passed}/${javaResult.total} passed.`;
      }
      const failedTitles = testCaseStatuses.filter((tc) => tc.status !== 'passed').map((tc) => tc.title);
      if (failedTitles.length > 0) {
        text += '\n\nFailed test cases:\n' + failedTitles.map((t) => `- ${t}`).join('\n');
      }
      summaryText = text;
    }
  }

  // ---- duration / timestamps ----
  const finishedAtIso = new Date().toISOString();
  const duration = formatDuration(run.started_at, finishedAtIso);
  const generatedAt = formatTimestamp(finishedAtIso);

  // ---- render template ----
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');

  const html = template
    .replace(/{{PROJECT_NAME}}/g, escapeHtml(project.name || 'Untitled project'))
    .replace(/{{STATUS_BADGE_CLASS}}/g, overallStatus)
    .replace(/{{STATUS_TEXT}}/g, overallStatus.toUpperCase())
    .replace(/{{TARGET_URL}}/g, escapeHtml(project.target_url || project.api_base_url || 'N/A'))
    .replace(/{{DURATION}}/g, escapeHtml(duration))
    .replace(/{{GENERATED_AT}}/g, escapeHtml(generatedAt))
    .replace(/{{SUMMARY_LABEL}}/g, run.ai_summary ? 'AI Summary' : 'Summary')
    .replace(/{{AI_SUMMARY}}/g, escapeHtml(summaryText || 'No summary available.'))
    .replace('{{TEST_CASES_HTML}}', testCasesHtml)
    .replace('{{JAVA_SECTION_HTML}}', javaSectionHtml)
    .replace(/{{RUN_ID}}/g, escapeHtml(String(runId)));

  // ---- write report to disk ----
  const runDir = path.join(REPO_ROOT, 'runs', String(runId));
  fs.mkdirSync(runDir, { recursive: true });
  const absoluteReportPath = path.join(runDir, 'report.html');
  fs.writeFileSync(absoluteReportPath, html, 'utf8');

  const reportPath = path.posix.join('runs', String(runId), 'report.html');

  // ---- update run row ----
  db.finishRun(runId, {
    status: overallStatus,
    summary_text: summaryText,
    report_path: reportPath
  });

  return { reportPath, absoluteReportPath, status: overallStatus };
}

module.exports = { buildReport };
