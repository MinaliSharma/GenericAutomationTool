// Thin fetch wrapper for the AI QA Tester REST API.
// Base URL defaults to http://localhost:4000 in dev; override with VITE_API_BASE
// (see .env.development).
export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      // ignore
    }
    throw new Error(`${options.method || 'GET'} ${path} failed: ${res.status} ${detail}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// --- Projects ---
export function createProject({ name, target_url, api_base_url, java_repo_path }) {
  return request('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ name, target_url, api_base_url, java_repo_path }),
  });
}

export function listProjects() {
  return request('/api/projects');
}

export function getProject(id) {
  return request(`/api/projects/${id}`);
}

// --- Test cases ---
export function createTestCase(projectId, { type, title, description, spec_code }) {
  return request(`/api/projects/${projectId}/test-cases`, {
    method: 'POST',
    body: JSON.stringify({ type, title, description, spec_code }),
  });
}

export function listTestCases(projectId) {
  return request(`/api/projects/${projectId}/test-cases`);
}

export function clearGeneratedTestCases(projectId) {
  return request(`/api/projects/${projectId}/generated-test-cases`, { method: 'DELETE' });
}

export function clearAllTestCases(projectId) {
  return request(`/api/projects/${projectId}/test-cases`, { method: 'DELETE' });
}

export function updateTestCase(id, patch) {
  return request(`/api/test-cases/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteTestCase(id) {
  return request(`/api/test-cases/${id}`, { method: 'DELETE' });
}

export function discoverTests(projectId) {
  return request(`/api/projects/${projectId}/discover`, { method: 'POST', body: JSON.stringify({}) });
}

export function generateScenarioTestCases(projectId, scenario) {
  return request(`/api/projects/${projectId}/scenario-test-cases`, {
    method: 'POST',
    body: JSON.stringify({ scenario }),
  });
}

export function approveTestCase(id) {
  return request(`/api/test-cases/${id}/approve`, { method: 'POST' });
}

export function draftTestCaseSpec(id, body = {}) {
  return request(`/api/test-cases/${id}/ai-draft`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// --- Runs ---
export function createRun(projectId, { test_case_ids, include_java, ai_summary = false }) {
  return request(`/api/projects/${projectId}/runs`, {
    method: 'POST',
    body: JSON.stringify({ test_case_ids, include_java, ai_summary }),
  });
}

export function getRun(id) {
  return request(`/api/runs/${id}`);
}

export function getRunEvents(id) {
  return request(`/api/runs/${id}/events`);
}

export function rerunFailedTests(id) {
  return request(`/api/runs/${id}/rerun`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}
