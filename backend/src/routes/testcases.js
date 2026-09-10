const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const db = require('../db/db');
const aiService = require('../orchestrator/aiService');
const specFileSync = require('../specfiles/specFileSync');

const router = express.Router();

function findPageObjectContext(targetUrl) {
  if (!targetUrl) return null;
  const pagesRoot = path.join(db.REPO_ROOT, 'playwright', 'pages');
  if (!fs.existsSync(pagesRoot)) return null;

  const pending = [pagesRoot];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
        continue;
      }
      if (!entry.name.endsWith('.js')) continue;
      const source = fs.readFileSync(entryPath, 'utf8');
      if (!source.includes(`from ${targetUrl}`) && !source.includes(`from ${targetUrl}/`)) continue;
      const relativeImport = path.relative(path.join(db.REPO_ROOT, 'playwright', 'tests', 'browser'), entryPath);
      return `Import path: ${relativeImport.startsWith('.') ? relativeImport : `../../${relativeImport}`}\n\n${source}`;
    }
  }
  return null;
}

// Some AI providers wrap "return raw code only" responses in a markdown fence.
// Strip that defensively so the result is always directly-writable, valid spec file content.
function stripCodeFences(text) {
  if (typeof text !== 'string') return text;
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
  return fenceMatch ? fenceMatch[1] : trimmed;
}

function validateSpecCode(specCode) {
  if (!specCode || !String(specCode).trim()) return null;

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiqa-spec-'));
  // .mjs forces Node to fully parse `import` syntax; a plain .js file is treated as
  // ambiguous and silently skips real validation, letting broken specs through.
  const tempFile = path.join(tempDir, 'spec.mjs');
  try {
    fs.writeFileSync(tempFile, String(specCode), 'utf8');
    const result = spawnSync(process.execPath, ['--check', tempFile], {
      encoding: 'utf8',
      timeout: 10_000
    });
    if (result.error) return `spec validation failed: ${result.error.message}`;
    if (result.status !== 0) {
      return `spec has invalid JavaScript: ${(result.stderr || result.stdout || '').trim()}`;
    }
    return null;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// POST /api/projects/:id/test-cases  -> manual test case
router.post('/projects/:id/test-cases', (req, res) => {
  const projectId = Number(req.params.id);
  const project = db.getProject(projectId);
  if (!project) return res.status(404).json({ error: 'project not found' });

  const { type, title, description, spec_code } = req.body || {};
  if (!type || !['browser', 'api'].includes(type)) {
    return res.status(400).json({ error: 'type must be "browser" or "api"' });
  }
  if (!title) {
    return res.status(400).json({ error: 'title is required' });
  }
  const specError = validateSpecCode(spec_code);
  if (specError) return res.status(400).json({ error: specError });

  const testCase = db.createTestCase({
    project_id: projectId,
    type,
    title,
    description: description || null,
    spec_code: spec_code || null,
    source: 'manual',
    origin: 'manual',
    approved: 1
  });

  specFileSync.writeSpecFile(testCase);

  res.status(201).json(testCase);
});

// POST /api/projects/:id/scenario-test-cases -> generate reviewable cases from user scenario
router.post('/projects/:id/scenario-test-cases', async (req, res) => {
  const projectId = Number(req.params.id);
  const project = db.getProject(projectId);
  if (!project) return res.status(404).json({ error: 'project not found' });

  const scenario = typeof req.body?.scenario === 'string' ? req.body.scenario.trim() : '';
  if (!scenario) return res.status(400).json({ error: 'scenario is required' });

  try {
    const cases = aiService.generateScenarioCandidates({ scenario, limit: 5 });

    const created = cases
      .filter((item) => item && item.title && item.description)
      .slice(0, 10)
      .map((item) => db.createTestCase({
        project_id: projectId,
        type: item.type === 'api' ? 'api' : 'browser',
        title: String(item.title),
        description: String(item.description),
        spec_code: null,
        source: 'ai_discovered',
        origin: 'scenario_generated',
        approved: 0
      }));

    if (created.length === 0) {
      return res.status(502).json({ error: 'scenario generation returned no usable test cases' });
    }
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: `scenario generation failed: ${err.message}` });
  }
});

// GET /api/projects/:id/test-cases
router.get('/projects/:id/test-cases', (req, res) => {
  const projectId = Number(req.params.id);
  const project = db.getProject(projectId);
  if (!project) return res.status(404).json({ error: 'project not found' });
  res.json(db.listTestCasesByProject(projectId));
});

// DELETE /api/projects/:id/generated-test-cases -> clear unapproved generated candidates
router.delete('/projects/:id/generated-test-cases', (req, res) => {
  const projectId = Number(req.params.id);
  const project = db.getProject(projectId);
  if (!project) return res.status(404).json({ error: 'project not found' });

  const generated = db.listGeneratedTestCasesByProject(projectId);
  for (const testCase of generated) specFileSync.deleteSpecFile(testCase);
  db.deleteGeneratedTestCasesByProject(projectId);
  res.json({ deleted: generated.length });
});

// DELETE /api/projects/:id/test-cases -> clear every test case in a project
router.delete('/projects/:id/test-cases', (req, res) => {
  const projectId = Number(req.params.id);
  const project = db.getProject(projectId);
  if (!project) return res.status(404).json({ error: 'project not found' });

  const testCases = db.listTestCasesByProject(projectId);
  for (const testCase of testCases) specFileSync.deleteSpecFile(testCase);
  db.deleteAllTestCasesByProject(projectId);
  res.json({ deleted: testCases.length });
});

// PATCH /api/test-cases/:id
router.patch('/test-cases/:id', (req, res) => {
  const id = Number(req.params.id);
  const testCase = db.getTestCase(id);
  if (!testCase) return res.status(404).json({ error: 'test case not found' });

  const { title, description, spec_code } = req.body || {};
  const patch = {};
  if (title !== undefined) patch.title = title;
  if (description !== undefined) patch.description = description;
  if (spec_code !== undefined) patch.spec_code = spec_code;

  const specError = validateSpecCode(patch.spec_code);
  if (specError) return res.status(400).json({ error: specError });

  const updated = db.updateTestCase(id, patch);

  if (Object.prototype.hasOwnProperty.call(patch, 'spec_code')) {
    specFileSync.writeSpecFile(updated);
  }

  res.json(updated);
});

// DELETE /api/test-cases/:id
router.delete('/test-cases/:id', (req, res) => {
  const id = Number(req.params.id);
  const testCase = db.getTestCase(id);
  if (!testCase) return res.status(404).json({ error: 'test case not found' });
  db.deleteTestCase(id);
  specFileSync.deleteSpecFile(testCase);
  res.status(204).end();
});

// POST /api/test-cases/:id/approve
router.post('/test-cases/:id/approve', (req, res) => {
  const id = Number(req.params.id);
  const testCase = db.getTestCase(id);
  if (!testCase) return res.status(404).json({ error: 'test case not found' });
  if (!testCase.spec_code) {
    return res.status(400).json({ error: 'test case has no authored spec_code yet' });
  }

  const updated = db.approveTestCase(id);
  specFileSync.writeSpecFile(updated);
  res.json(updated);
});

// POST /api/test-cases/:id/ai-draft
router.post('/test-cases/:id/ai-draft', async (req, res) => {
  const id = Number(req.params.id);
  const testCase = db.getTestCase(id);
  if (!testCase) return res.status(404).json({ error: 'test case not found' });

  const project = db.getProject(testCase.project_id);

  try {
    const specCode = aiService.generateDraftSpec({
      type: testCase.type,
      title: testCase.title,
      description: req.body && req.body.description ? req.body.description : testCase.description,
      targetUrl: project ? project.target_url : undefined,
      apiBaseUrl: project ? project.api_base_url : undefined
    });

    const specError = validateSpecCode(specCode);
    if (specError) return res.status(502).json({ error: specError });

    const updated = db.updateTestCase(id, { spec_code: specCode });
    specFileSync.writeSpecFile(updated);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: `ai draft failed: ${err.message}` });
  }
});

// POST /api/projects/:id/discover
router.post('/projects/:id/discover', async (req, res) => {
  const projectId = Number(req.params.id);
  const project = db.getProject(projectId);
  if (!project) return res.status(404).json({ error: 'project not found' });
  if (!project.target_url) {
    return res.status(400).json({ error: 'project has no target_url configured' });
  }

  try {
    const candidates = aiService.generateCandidateTests({ targetUrl: project.target_url, limit: 5 });

    const created = candidates
      .filter((item) => item && item.title && item.description)
      .map((item) =>
        db.createTestCase({
          project_id: projectId,
          type: item.type === 'api' ? 'api' : 'browser',
          title: String(item.title),
          description: String(item.description),
          spec_code: null,
          source: 'ai_discovered',
          origin: 'ai_discovered',
          approved: 0
        })
      );

    if (created.length === 0) {
      return res.status(502).json({
        error: 'AI discovery returned no usable test cases',
        detail: 'Each discovered item must include a title and description.',
        raw: candidates
      });
    }

    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: `discovery failed: ${err.message}` });
  }
});

module.exports = router;
