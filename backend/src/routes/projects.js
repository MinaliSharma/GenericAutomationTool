const express = require('express');
const path = require('path');
const { spawn } = require('child_process');
const db = require('../db/db');

const router = express.Router();
const PLAYWRIGHT_DIR = path.join(db.REPO_ROOT, 'playwright');

function validateHttpUrl(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return `${fieldName} must be a valid http(s) URL`;

  try {
    const parsed = new URL(value.trim());
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
      return `${fieldName} must be a valid http(s) URL`;
    }
  } catch {
    return `${fieldName} must be a valid http(s) URL`;
  }
  return null;
}

// Fire-and-forget: auto-generates a Page Object (locators + methods) for the
// project's target_url, so the user never has to run the generator by hand.
function autoGeneratePageObject(url) {
  if (!url) return;
  const child = spawn('node', ['scripts/generatePageObject.js', url], {
    cwd: PLAYWRIGHT_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => (output += d.toString()));
  child.stderr.on('data', (d) => (output += d.toString()));
  child.on('close', (code) => {
    console.log(`[auto page-object generation] exit ${code}: ${output.trim()}`);
  });
}

// POST /api/projects
router.post('/projects', (req, res) => {
  const { name, target_url, api_base_url, java_repo_path } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const targetUrlError = validateHttpUrl(target_url, 'target_url');
  if (targetUrlError) return res.status(400).json({ error: targetUrlError });
  const apiBaseUrlError = validateHttpUrl(api_base_url, 'api_base_url');
  if (apiBaseUrlError) return res.status(400).json({ error: apiBaseUrlError });

  const normalizedTargetUrl = typeof target_url === 'string' ? target_url.trim() : target_url;
  const normalizedApiBaseUrl = typeof api_base_url === 'string' ? api_base_url.trim() : api_base_url;
  const project = db.createProject({
    name: name.trim(),
    target_url: normalizedTargetUrl,
    api_base_url: normalizedApiBaseUrl,
    java_repo_path
  });
  res.status(201).json(project);
  autoGeneratePageObject(normalizedTargetUrl);
});

// GET /api/projects
router.get('/projects', (req, res) => {
  const projects = db.listProjects().map((p) => ({ ...p, runs: db.listRunsByProject(p.id) }));
  res.json(projects);
});

// GET /api/projects/:id
router.get('/projects/:id', (req, res) => {
  const project = db.getProject(Number(req.params.id));
  if (!project) return res.status(404).json({ error: 'project not found' });
  res.json({ ...project, runs: db.listRunsByProject(project.id) });
});

module.exports = router;
