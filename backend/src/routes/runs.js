const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db/db');
const hub = require('../ws/hub');
const { runPlaywrightTest } = require('../runners/playwrightRunner');
const { runJavaTests } = require('../runners/javaRunner');
const { buildReport } = require('../report/reportBuilder');

const router = express.Router();
const RUNS_DIR = path.join(db.REPO_ROOT, 'runs');

function startRun({ projectId, project, testCaseIds, includeJava, aiSummary }) {
  const run = db.createRun({ project_id: projectId, include_java: includeJava, ai_summary: aiSummary });
  for (const testCaseId of testCaseIds) {
    db.linkRunTestCase(run.id, testCaseId);
  }

  executeRun(run.id, projectId, project, testCaseIds, includeJava, aiSummary).catch((err) => {
    hub.persistAndBroadcast(run.id, {
      category: 'system',
      type: 'error',
      payload: { message: `orchestration crashed: ${err.message}` },
      createdAt: new Date().toISOString()
    });
    db.finishRun(run.id, { status: 'error' });
  });

  return run;
}

// POST /api/projects/:id/runs
router.post('/projects/:id/runs', (req, res) => {
  const projectId = Number(req.params.id);
  const project = db.getProject(projectId);
  if (!project) return res.status(404).json({ error: 'project not found' });

  const { test_case_ids, include_java, ai_summary } = req.body || {};
  if (!Array.isArray(test_case_ids) || test_case_ids.length === 0) {
    return res.status(400).json({ error: 'test_case_ids must be a non-empty array' });
  }

  const unauthoredIds = [];
  for (const tcId of test_case_ids) {
    const tc = db.getTestCase(Number(tcId));
    if (!tc || !tc.spec_code || !String(tc.spec_code).trim()) {
      unauthoredIds.push(Number(tcId));
    }
  }
  if (unauthoredIds.length > 0) {
    return res.status(400).json({ error: 'these test cases have no authored spec_code yet', ids: unauthoredIds });
  }

  const run = startRun({
    projectId,
    project,
    testCaseIds: test_case_ids.map(Number),
    includeJava: !!include_java,
    aiSummary: !!ai_summary
  });

  // Respond immediately; orchestration happens asynchronously.
  res.status(201).json({ id: run.id });
});

// GET /api/runs/:id
router.get('/runs/:id', (req, res) => {
  const run = db.getRun(Number(req.params.id));
  if (!run) return res.status(404).json({ error: 'run not found' });
  res.json(run);
});

// GET /api/runs/:id/events
router.get('/runs/:id/events', (req, res) => {
  const run = db.getRun(Number(req.params.id));
  if (!run) return res.status(404).json({ error: 'run not found' });
  res.json(db.listRunEvents(run.id));
});

// POST /api/runs/:id/rerun -> rerun failed browser/API test cases from a run
router.post('/runs/:id/rerun', (req, res) => {
  const sourceRun = db.getRun(Number(req.params.id));
  if (!sourceRun) return res.status(404).json({ error: 'run not found' });

  const runTestCases = db.listRunTestCases(sourceRun.id);
  const allowedIds = new Set(runTestCases.map((testCase) => testCase.id));
  const events = db.listRunEvents(sourceRun.id);
  const failedTestCaseIds = new Set();
  for (const event of events) {
    if (event.type === 'step_result' && event.testCaseId !== null) {
      if (!event.payload || event.payload.status !== 'passed') {
        failedTestCaseIds.add(event.testCaseId);
      }
    }
  }

  const requestedIds = req.body && req.body.test_case_ids;
  const testCaseIds = Array.isArray(requestedIds)
    ? requestedIds.map(Number)
    : runTestCases
        .filter((testCase) => failedTestCaseIds.has(testCase.id))
        .map((testCase) => testCase.id);

  const invalidIds = testCaseIds.filter((id) => !allowedIds.has(id));
  if (invalidIds.length > 0) {
    return res.status(400).json({ error: 'test cases must belong to the source run', ids: invalidIds });
  }
  if (testCaseIds.length === 0) {
    return res.status(400).json({ error: 'no failed test cases found to rerun' });
  }

  const unauthoredIds = testCaseIds.filter((id) => {
    const testCase = db.getTestCase(id);
    return !testCase || !testCase.spec_code || !String(testCase.spec_code).trim();
  });
  if (unauthoredIds.length > 0) {
    return res.status(400).json({ error: 'these test cases have no authored spec_code yet', ids: unauthoredIds });
  }

  const project = db.getProject(sourceRun.project_id);
  const run = startRun({
    projectId: sourceRun.project_id,
    project,
    testCaseIds,
    includeJava: false,
    aiSummary: !!sourceRun.ai_summary
  });
  res.status(201).json({ id: run.id, test_case_ids: testCaseIds });
});

// GET /api/runs/:id/report
router.get('/runs/:id/report', (req, res) => {
  const run = db.getRun(Number(req.params.id));
  if (!run) return res.status(404).json({ error: 'run not found' });
  const reportPath = path.join(RUNS_DIR, String(run.id), 'report.html');
  if (!fs.existsSync(reportPath)) {
    return res.status(404).json({ error: 'report not generated yet' });
  }
  res.type('text/html').sendFile(reportPath);
});

/**
 * Drives execution of a run: sets it to 'running', executes each selected test case
 * in order via the real Playwright test runner, persists+broadcasts normalized events
 * over the ws hub, and finally marks the run 'passed' or 'failed'.
 */
async function executeRun(runId, projectId, project, testCaseIds, includeJava, aiSummary) {
  db.startRun(runId);

  const screenshotBaseDir = path.join(RUNS_DIR, String(runId), 'screenshots');
  fs.mkdirSync(screenshotBaseDir, { recursive: true });

  let allPassed = true;

  for (const testCaseId of testCaseIds) {
    const testCase = db.getTestCase(testCaseId);
    if (!testCase) {
      hub.persistAndBroadcast(runId, {
        category: 'system',
        type: 'error',
        payload: { message: `test case ${testCaseId} not found, skipping` },
        createdAt: new Date().toISOString()
      });
      allPassed = false;
      continue;
    }

    if (testCase.type === 'browser' || testCase.type === 'api') {
      try {
        await runPlaywrightTest({
          testCase,
          project,
          runId,
          onEvent: (event) => {
            hub.persistAndBroadcast(runId, { ...event, testCaseId: testCase.id });
            if (event.type === 'step_result' && event.payload && event.payload.status !== 'passed') {
              allPassed = false;
            }
          }
        });
      } catch (err) {
        allPassed = false;
        hub.persistAndBroadcast(runId, {
          category: testCase.type === 'api' ? 'api' : 'browser',
          type: 'step_result',
          payload: { testCaseId: testCase.id, status: 'failed', message: `playwright runner crashed: ${err.message}` },
          testCaseId: testCase.id,
          createdAt: new Date().toISOString()
        });
      }
    }
  }

  if (includeJava) {
    try {
      await runJavaTests({
        repoPath: project.java_repo_path,
        runId,
        aiSummary,
        onEvent: (event) => {
          hub.persistAndBroadcast(runId, event);
          if (event.type === 'java_result' && event.payload && (event.payload.failed > 0 || event.payload.errors > 0)) {
            allPassed = false;
          }
          if (event.type === 'error') {
            allPassed = false;
          }
        }
      });
    } catch (err) {
      allPassed = false;
      hub.persistAndBroadcast(runId, {
        category: 'java',
        type: 'error',
        payload: { message: `Java runner crashed: ${err.message}` },
        createdAt: new Date().toISOString()
      });
    }
  }

  try {
    await buildReport({ runId });
  } catch (err) {
    hub.persistAndBroadcast(runId, {
      category: 'system',
      type: 'error',
      payload: { message: `report generation failed: ${err.message}` },
      createdAt: new Date().toISOString()
    });
    db.finishRun(runId, { status: allPassed ? 'passed' : 'failed' });
  }
}

module.exports = router;
