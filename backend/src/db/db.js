const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Repo root is three levels up from backend/src/db/db.js
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DB_PATH = path.join(REPO_ROOT, 'aiqa.sqlite');

const dbExisted = fs.existsSync(DB_PATH);
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  target_url TEXT,
  api_base_url TEXT,
  java_repo_path TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS test_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  type TEXT NOT NULL CHECK(type IN ('browser','api')),
  title TEXT NOT NULL,
  description TEXT,
  spec_code TEXT,
  source TEXT NOT NULL CHECK(source IN ('manual','ai_discovered')),
  origin TEXT NOT NULL DEFAULT 'manual',
  approved INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  status TEXT NOT NULL CHECK(status IN ('pending','running','passed','failed','error')),
  include_java INTEGER NOT NULL DEFAULT 0,
  ai_summary INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  finished_at TEXT,
  summary_text TEXT,
  report_path TEXT
);

CREATE TABLE IF NOT EXISTS run_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES runs(id),
  test_case_id INTEGER,
  category TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_test_cases (
  run_id INTEGER NOT NULL REFERENCES runs(id),
  test_case_id INTEGER NOT NULL REFERENCES test_cases(id),
  PRIMARY KEY (run_id, test_case_id)
);
`;

db.exec(SCHEMA);

const testCaseColumns = db.prepare(`PRAGMA table_info(test_cases)`).all().map((column) => column.name);
if (!testCaseColumns.includes('origin')) {
  db.exec(`ALTER TABLE test_cases ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual'`);
  db.exec(`UPDATE test_cases SET origin = CASE WHEN source = 'ai_discovered' THEN 'ai_discovered' ELSE 'manual' END`);
}

// ---------- Helpers ----------

function nowIso() {
  return new Date().toISOString();
}

// --- projects ---
function createProject({ name, target_url, api_base_url, java_repo_path }) {
  const stmt = db.prepare(
    `INSERT INTO projects (name, target_url, api_base_url, java_repo_path, created_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  const info = stmt.run(name, target_url || null, api_base_url || null, java_repo_path || null, nowIso());
  return getProject(info.lastInsertRowid);
}

function getProject(id) {
  return db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id);
}

function listProjects() {
  return db.prepare(`SELECT * FROM projects ORDER BY id DESC`).all();
}

// --- test_cases ---
function createTestCase({ project_id, type, title, description, spec_code, source, origin, approved }) {
  const stmt = db.prepare(
    `INSERT INTO test_cases (project_id, type, title, description, spec_code, source, origin, approved, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const info = stmt.run(
    project_id,
    type,
    title,
    description === undefined ? null : description,
    spec_code === undefined ? null : spec_code,
    source,
    origin || source,
    approved ? 1 : 0,
    nowIso()
  );
  return getTestCase(info.lastInsertRowid);
}

function getTestCase(id) {
  return db.prepare(`SELECT * FROM test_cases WHERE id = ?`).get(id);
}

function listTestCasesByProject(projectId) {
  return db.prepare(`SELECT * FROM test_cases WHERE project_id = ? ORDER BY id ASC`).all(projectId);
}

function deleteTestCase(id) {
  return db.prepare(`DELETE FROM test_cases WHERE id = ?`).run(id);
}

function listGeneratedTestCasesByProject(projectId) {
  return db.prepare(
    `SELECT * FROM test_cases
     WHERE project_id = ? AND approved = 0
       AND (origin IN ('scenario_generated', 'ai_discovered') OR source = 'ai_discovered')
     ORDER BY id ASC`
  ).all(projectId);
}

function deleteGeneratedTestCasesByProject(projectId) {
  return db.prepare(
    `DELETE FROM test_cases
     WHERE project_id = ? AND approved = 0
       AND (origin IN ('scenario_generated', 'ai_discovered') OR source = 'ai_discovered')`
  ).run(projectId);
}

function deleteAllTestCasesByProject(projectId) {
  const transaction = db.transaction(() => {
    db.prepare(
      `DELETE FROM run_test_cases
       WHERE test_case_id IN (SELECT id FROM test_cases WHERE project_id = ?)`
    ).run(projectId);
    db.prepare(
      `UPDATE run_events SET test_case_id = NULL
       WHERE test_case_id IN (SELECT id FROM test_cases WHERE project_id = ?)`
    ).run(projectId);
    return db.prepare(`DELETE FROM test_cases WHERE project_id = ?`).run(projectId);
  });
  return transaction();
}

const TEST_CASE_PATCH_FIELDS = ['title', 'description', 'spec_code', 'approved'];

function updateTestCase(id, patch) {
  const fields = Object.keys(patch || {}).filter((key) => TEST_CASE_PATCH_FIELDS.includes(key));
  if (!fields.length) return getTestCase(id);

  const setClause = fields.map((f) => `${f} = ?`).join(', ');
  const values = fields.map((f) => {
    if (f === 'approved') return patch[f] ? 1 : 0;
    return patch[f];
  });
  db.prepare(`UPDATE test_cases SET ${setClause}, updated_at = ? WHERE id = ?`).run(
    ...values,
    nowIso(),
    id
  );
  return getTestCase(id);
}

function approveTestCase(id) {
  db.prepare(`UPDATE test_cases SET approved = 1, updated_at = ? WHERE id = ?`).run(nowIso(), id);
  return getTestCase(id);
}

// --- runs ---
function createRun({ project_id, include_java, ai_summary }) {
  const stmt = db.prepare(
    `INSERT INTO runs (project_id, status, include_java, ai_summary, started_at, finished_at, summary_text, report_path)
     VALUES (?, 'pending', ?, ?, NULL, NULL, NULL, NULL)`
  );
  const info = stmt.run(project_id, include_java ? 1 : 0, ai_summary ? 1 : 0);
  return getRun(info.lastInsertRowid);
}

function getRun(id) {
  return db.prepare(`SELECT * FROM runs WHERE id = ?`).get(id);
}

function listRunsByProject(projectId) {
  return db.prepare(`SELECT * FROM runs WHERE project_id = ? ORDER BY id DESC`).all(projectId);
}

function updateRunStatus(id, status) {
  db.prepare(`UPDATE runs SET status = ? WHERE id = ?`).run(status, id);
  return getRun(id);
}

function startRun(id) {
  db.prepare(`UPDATE runs SET status = 'running', started_at = ? WHERE id = ?`).run(nowIso(), id);
  return getRun(id);
}

function finishRun(id, { status, summary_text, report_path }) {
  db.prepare(
    `UPDATE runs SET status = ?, finished_at = ?, summary_text = COALESCE(?, summary_text), report_path = COALESCE(?, report_path) WHERE id = ?`
  ).run(status, nowIso(), summary_text || null, report_path || null, id);
  return getRun(id);
}

// --- run_events ---
function insertRunEvent({ run_id, test_case_id, category, type, payload, created_at }) {
  const stmt = db.prepare(
    `INSERT INTO run_events (run_id, test_case_id, category, type, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const info = stmt.run(
    run_id,
    test_case_id === undefined ? null : test_case_id,
    category,
    type,
    JSON.stringify(payload || {}),
    created_at || nowIso()
  );
  return getRunEvent(info.lastInsertRowid);
}

function getRunEvent(id) {
  const row = db.prepare(`SELECT * FROM run_events WHERE id = ?`).get(id);
  if (!row) return row;
  return {
    id: row.id,
    runId: row.run_id,
    testCaseId: row.test_case_id,
    category: row.category,
    type: row.type,
    payload: JSON.parse(row.payload_json),
    createdAt: row.created_at
  };
}

function listRunEvents(runId) {
  const rows = db
    .prepare(`SELECT * FROM run_events WHERE run_id = ? ORDER BY id ASC`)
    .all(runId);
  return rows.map((row) => ({
    id: row.id,
    runId: row.run_id,
    testCaseId: row.test_case_id,
    category: row.category,
    type: row.type,
    payload: JSON.parse(row.payload_json),
    createdAt: row.created_at
  }));
}

// --- run_test_cases ---
function linkRunTestCase(runId, testCaseId) {
  db.prepare(
    `INSERT OR IGNORE INTO run_test_cases (run_id, test_case_id) VALUES (?, ?)`
  ).run(runId, testCaseId);
}

function listRunTestCases(runId) {
  return db
    .prepare(
      `SELECT tc.* FROM run_test_cases rtc
       JOIN test_cases tc ON tc.id = rtc.test_case_id
       WHERE rtc.run_id = ? ORDER BY tc.id ASC`
    )
    .all(runId);
}

module.exports = {
  db,
  REPO_ROOT,
  DB_PATH,
  dbExisted,
  nowIso,
  // projects
  createProject,
  getProject,
  listProjects,
  // test_cases
  createTestCase,
  getTestCase,
  listTestCasesByProject,
  deleteTestCase,
  listGeneratedTestCasesByProject,
  deleteGeneratedTestCasesByProject,
  deleteAllTestCasesByProject,
  updateTestCase,
  approveTestCase,
  // runs
  createRun,
  getRun,
  listRunsByProject,
  updateRunStatus,
  startRun,
  finishRun,
  // run_events
  insertRunEvent,
  getRunEvent,
  listRunEvents,
  // run_test_cases
  linkRunTestCase,
  listRunTestCases
};
