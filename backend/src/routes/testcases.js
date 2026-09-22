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

function resolveDiscoveryTargetUrl(item, defaultUrl, pages) {
  const observedUrls = pages.map((page) => page.url);
  if (item.targetUrl && observedUrls.includes(item.targetUrl)) return item.targetUrl;

  const tokens = (value) => new Set(
    String(value || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2)
  );
  const requestedTokens = tokens(`${item.title} ${item.description}`);
  let bestMatch = null;
  let bestScore = 0;

  for (const page of pages) {
    const pageTokens = tokens(`${page.title} ${new URL(page.url).pathname} ${page.text?.slice(0, 500) || ''}`);
    const score = [...requestedTokens].filter((token) => pageTokens.has(token)).length;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = page.url;
    }
  }

  return bestMatch || defaultUrl;
}

function targetUrlFromSpec(testCase, fallbackUrl) {
  const match = String(testCase.spec_code || '').match(
    /gotoWithTransientRetry\s*\(\s*page\s*,\s*['"](https?:\/\/[^'"]+)['"]/
  );
  return match ? match[1] : fallbackUrl;
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
    target_url: project.target_url || null,
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
    const cases = await aiService.generateScenarioCandidatesFromScenario({ scenario, limit: 5 });

    const created = cases
      .filter((item) => item && item.title && item.description)
      .slice(0, 10)
      .map((item) => db.createTestCase({
        project_id: projectId,
        type: item.type === 'api' ? 'api' : 'browser',
        title: String(item.title),
        description: String(item.description),
        target_url: project.target_url || null,
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
router.post('/test-cases/:id/approve', async (req, res) => {
  const id = Number(req.params.id);
  const testCase = db.getTestCase(id);
  if (!testCase) return res.status(404).json({ error: 'test case not found' });

  try {
    let pageObject = null;
    let specCode = testCase.spec_code;
    const project = db.getProject(testCase.project_id);
    if (testCase.type === 'browser') {
      const targetUrl = testCase.target_url || targetUrlFromSpec(testCase, project?.target_url);
      if (!targetUrl) return res.status(400).json({ error: 'approved browser test has no target URL' });
      pageObject = await aiService.generatePageObjectForTarget(targetUrl);
      specCode = await aiService.generateDraftSpecFromTestCase({
        type: testCase.type,
        title: testCase.title,
        description: testCase.description,
        targetUrl,
        pageObjectContext: findPageObjectContext(targetUrl)
      });
    } else if (!specCode) {
      specCode = await aiService.generateDraftSpecFromTestCase({
        type: testCase.type,
        title: testCase.title,
        description: testCase.description,
        apiBaseUrl: project?.api_base_url
      });
    }

    const specError = validateSpecCode(specCode);
    if (specError) return res.status(502).json({ error: specError });
    db.updateTestCase(id, { spec_code: specCode });
    const updated = db.approveTestCase(id);
    specFileSync.writeSpecFile(updated);
    res.json({ ...updated, page_object: pageObject });
  } catch (err) {
    res.status(500).json({ error: `approval failed: ${err.message}` });
  }
});

// POST /api/test-cases/:id/ai-draft
router.post('/test-cases/:id/ai-draft', async (req, res) => {
  const id = Number(req.params.id);
  const testCase = db.getTestCase(id);
  if (!testCase) return res.status(404).json({ error: 'test case not found' });

  const project = db.getProject(testCase.project_id);

  try {
    const targetUrl = testCase.target_url || (project ? project.target_url : undefined);
    const specCode = await aiService.generateDraftSpecFromTestCase({
      type: testCase.type,
      title: testCase.title,
      description: req.body && req.body.description ? req.body.description : testCase.description,
      targetUrl,
      apiBaseUrl: project ? project.api_base_url : undefined,
      pageObjectContext: findPageObjectContext(targetUrl)
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
    const pages = await aiService.inspectTargetSite(project.target_url);
    const candidates = await aiService.discoverTests({ targetUrl: project.target_url, pages });

    if (candidates.length === 0) {
      return res.status(502).json({
        error: 'AI discovery returned no usable test cases',
        detail: 'Each discovered item must include a title and description.',
        raw: candidates
      });
    }

    const previousGenerated = db.listGeneratedTestCasesByProject(projectId);
    for (const testCase of previousGenerated) specFileSync.deleteSpecFile(testCase);
    db.deleteGeneratedTestCasesByProject(projectId);

    const created = [];
    for (const item of candidates.filter((candidate) => candidate && candidate.title && candidate.description)) {
      const targetUrl = resolveDiscoveryTargetUrl(item, project.target_url, pages);
      created.push(
        db.createTestCase({
          project_id: projectId,
          type: 'browser',
          title: String(item.title),
          description: String(item.description),
          target_url: targetUrl,
          spec_code: null,
          source: 'ai_discovered',
          origin: 'ai_discovered',
          approved: 0
        })
      );
    }

    res.status(201).json({ test_cases: created, pages, page_objects: [] });
  } catch (err) {
    res.status(500).json({ error: `discovery failed: ${err.message}` });
  }
});

module.exports = router;
