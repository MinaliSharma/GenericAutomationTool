# AI QA Tester — Cross-module contracts

Hybrid architecture: **test execution is AI-free by default**, built on the real
`@playwright/test` runner (standard, portable, no AI/API key required to run a suite). AI
(the local `claude` CLI, already authenticated on this machine, no `ANTHROPIC_API_KEY`
anywhere) is used only in three optional, non-execution places:
1. **AI discovery** — crawl a site and propose candidate test cases (still uses
   `mcp-configs/playwright.json` + Playwright MCP tool-calling).
2. **AI Draft** — turn a plain-English description into a draft `.spec.js` body for a human
   to review/save (one-shot text generation, no tools).
3. **AI summary** — opt-in narrative summary in the report / Java-failure summary (off by
   default; `ai_summary` flag per run).

Scenario-based test generation is also available through
`POST /api/projects/:id/scenario-test-cases`. It accepts `{ "scenario": "..." }`, asks AI
for reviewable test-case titles and descriptions, and stores them as unapproved candidates
with `origin: "scenario_generated"`. It does not create or run Playwright code until a user
reviews the candidate and authors or generates its spec. Website discovery remains separate:
discovery explores the target URL, while scenario generation starts from a user-provided
requirement.

A prior, fully-AI-driven version of this app (where AI also executed every test) is preserved
untouched at `../AI QA Tester (AI-version-backup)`.

## Directory layout
```
backend/src/{orchestrator,runners,report,db,routes,ws,specfiles}/
frontend/
playwright/                   <- standard, independently-runnable @playwright/test workspace
  playwright.config.js
  tests/browser/tc-<id>.spec.js
  tests/api/tc-<id>.spec.js
  reporter/streamReporter.js  <- custom Reporter, emits run_event NDJSON to stdout
mcp-configs/playwright.json   <- points at `npx -y @playwright/mcp@latest` (AI discovery only)
runs/                         <- per-run artifacts land here, gitignored
```

## Test execution engine — `playwright/` (AI-free, default path)

Each test case's real Playwright Test source lives at
`playwright/tests/<type>/tc-<test_case.id>.spec.js` (`type` is `browser` or `api`), kept in
sync with the `test_cases.spec_code` DB column by `backend/src/specfiles/specFileSync.js` on
every create/patch/approve/delete.

Spec create, patch, and AI-draft persistence paths run a JavaScript syntax check before
updating the database or writing the spec file. Invalid generated code is rejected instead
of becoming runnable test data.

`playwright/playwright.config.js`: `testDir: './tests'`, `workers: 1` (sequential execution,
matches the run-order UX), `use: { baseURL: process.env.PW_BASE_URL, screenshot:
'only-on-failure', video: 'retain-on-failure', trace: 'retain-on-failure' }`, two `projects`
(`browser` using `devices['Desktop Chrome']`, `api` using `process.env.PW_API_BASE_URL`) —
`project.name` doubles as the emitted event's `category`.

`backend/src/runners/playwrightRunner.js` — `async function runPlaywrightTest({ testCase,
project, runId, onEvent })`: spawns `npx playwright test tests/<type>/tc-<id>.spec.js
--reporter <path-to-streamReporter.js>` with `cwd = playwright/`, env `PW_BASE_URL`,
`PW_API_BASE_URL`, `PW_SCREENSHOTS_DIR` (→ `runs/<runId>/screenshots/`), `PW_OUTPUT_DIR`.
Reads child stdout line-by-line (NDJSON), `JSON.parse`s each line defensively, calls
`onEvent(event)` per line. On non-zero exit with no `step_result` ever seen, synthesizes an
`error` + `step_result:failed` from stderr — mirrors the old `claudeRunner.js` fallback
pattern (kept for the AI-only helpers below).

`playwright/reporter/streamReporter.js` — custom Playwright Reporter (`onTestBegin`,
`onStepBegin`/`onStepEnd`, `onTestEnd`) that writes exactly one JSON object per stdout line,
in the **same normalized `run_event` shape** the old AI orchestrator used (see below) — no new
`type` values, so the existing frontend/WS/DB contract needed zero changes. `testCaseId` is
parsed from the spec filename (`tc-(\d+)\.spec\.js`). Screenshot attachments are copied into
`PW_SCREENSHOTS_DIR`; video/trace attachments are reported as informational `tool_result`
events. Runs standalone with no env vars too (`cd playwright && npx playwright test`).

## AI-only helpers — `backend/src/orchestrator/claudeRunner.js`

Still the only module that spawns the `claude` binary, now used only for discovery/AI-draft/
optional summaries — never for actual test execution.
```js
// Tool-using (discovery only): streams normalized events via onEvent, same shape as below.
async function runClaudeTask({ prompt, cwd, onEvent, screenshotDir, screenshotRelPrefix }) { ... }
// spawns: claude -p "<prompt>" --output-format stream-json --mcp-config mcp-configs/playwright.json
//         --allowedTools "mcp__playwright__*" --permission-mode bypassPermissions

// One-shot text (AI Draft, AI summaries): returns plain text, no tools.
async function runClaudePrompt({ prompt, cwd }) { ... }
// spawns: claude -p "<prompt>" --output-format json
```

## Normalized run_event shape (emitted by the Playwright reporter or claudeRunner, persisted, broadcast over WS)
```ts
{
  category: "browser" | "api" | "java" | "system",
  type: "step_start" | "tool_call" | "tool_result" | "screenshot" | "step_result" | "error" | "java_log" | "java_result" | "summary",
  payload: { ... },
  createdAt: <ISO string>
}
```
Payload by type (unchanged from the original build):
- `step_start`: `{ testCaseId, title }`
- `tool_call`: `{ tool: string, input: object }`
- `tool_result`: `{ tool: string, summary: string }` (truncate to ~500 chars)
- `screenshot`: `{ path: string }` — relative to `runs/<runId>/`, e.g. `screenshots/003.png`
- `step_result`: `{ testCaseId, status: "passed" | "failed", message: string }`
- `error`: `{ message: string }`
- `java_log`: `{ line: string }`
- `java_result`: `{ total, passed, failed, errors, failures: [{ testName, message }] }`
- `summary`: `{ text: string }` — deterministic plain text by default, AI narrative only when `ai_summary` is true for that run

## SQLite schema (`backend/src/db/db.js`, better-sqlite3, file at repo root: `aiqa.sqlite`)
```sql
CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  target_url TEXT,
  api_base_url TEXT,
  java_repo_path TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE test_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  type TEXT NOT NULL CHECK(type IN ('browser','api')),
  title TEXT NOT NULL,
  description TEXT,             -- plain-English notes; from AI discovery or the author; AI-Draft input
  spec_code TEXT,                -- full .spec.js body; NULL/empty = unauthored, cannot be approved/run
  source TEXT NOT NULL CHECK(source IN ('manual','ai_discovered')),
  approved INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  status TEXT NOT NULL CHECK(status IN ('pending','running','passed','failed','error')),
  include_java INTEGER NOT NULL DEFAULT 0,
  ai_summary INTEGER NOT NULL DEFAULT 0,   -- opt-in: use AI for report/Java-failure narrative
  started_at TEXT,
  finished_at TEXT,
  summary_text TEXT,
  report_path TEXT
);

CREATE TABLE run_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES runs(id),
  test_case_id INTEGER,
  category TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE run_test_cases (
  run_id INTEGER NOT NULL REFERENCES runs(id),
  test_case_id INTEGER NOT NULL REFERENCES test_cases(id),
  PRIMARY KEY (run_id, test_case_id)
);
```

## REST API (`backend/src/routes/*`, mounted under `/api`, Express, JSON bodies)
- `POST /api/projects` `{name, target_url, api_base_url?, java_repo_path?}` → 201 project
- `GET /api/projects` → list
- `GET /api/projects/:id` → project detail
- `POST /api/projects/:id/test-cases` `{type, title, description?, spec_code?}` → creates with
  `source: "manual"`; writes/syncs the spec file if `spec_code` given
- `GET /api/projects/:id/test-cases` → list
- `PATCH /api/test-cases/:id` `{title?, description?, spec_code?}` → partial update, re-syncs
  the spec file when `spec_code` changes
- `DELETE /api/test-cases/:id` → also deletes the spec file
- `POST /api/projects/:id/discover` `{}` → AI crawl against `target_url` via
  `claudeRunner.runClaudeTask`; parses a JSON array `[{type, title, description}]` from the
  streamed output; inserts rows with `source: "ai_discovered"`, `approved: 0`, `spec_code: null`
- `POST /api/test-cases/:id/ai-draft` `{description?}` → `claudeRunner.runClaudePrompt` turns
  the description into a draft `spec_code`, returns `{spec_code}`; **does not persist anything**
- `POST /api/test-cases/:id/approve` → 400 if `spec_code` is empty; else sets `approved = 1`
  and re-syncs the spec file
- `POST /api/projects/:id/runs` `{test_case_ids: number[], include_java: boolean, ai_summary:
  boolean}` → 400 if any selected test case has empty `spec_code`; else creates run row
  (status `pending`), starts orchestration async, returns `{id}` immediately
- `GET /api/runs/:id` → run row + parsed summary
- `GET /api/runs/:id/events` → full ordered event log for that run
- `GET /api/runs/:id/report` → serves `runs/<id>/report.html`

## WebSocket (`backend/src/ws/hub.js`) — unchanged
- Path: `ws://<host>/ws?runId=<id>`
- On connect: replays all persisted events for that run, then streams live ones.
- Message shape:
```json
{ "runId": 12, "event": { "id": 101, "testCaseId": 3, "category": "browser", "type": "screenshot", "payload": { "path": "screenshots/004.png" }, "createdAt": "2026-08-27T10:00:00.000Z" } }
```
- Screenshots served statically at `GET /runs/:runId/<path>`.

## Java runner (`backend/src/runners/javaRunner.js`)
`async function runJavaTests({ repoPath, runId, aiSummary, onEvent })`.
- Spawns `mvn -f <repoPath> test`, streams `java_log` events, parses surefire XML, emits one
  `java_result`.
- If `aiSummary` is true and there are failures, adds an AI-written failure summary
  (`claudeRunner.runClaudePrompt`) as the `summary` event's text. Otherwise emits a
  deterministic `summary` event (failed-test list, or "All N Java tests passed.").
- Never throws on test failures themselves; only emits `error` if `mvn` can't be
  found/spawned or the repo path is invalid.

## Report builder (`backend/src/report/reportBuilder.js`)
`async function buildReport({ runId })`.
- Reads the run row, `run_test_cases`, and all `run_events` from SQLite.
- Renders `template.html` (self-contained, screenshots embedded as base64 `data:` URIs) into
  `runs/<runId>/report.html`.
- If `run.ai_summary` is truthy: calls `claudeRunner.runClaudePrompt` for a narrative
  paragraph (same as before, with the same error fallback text).
- If falsy (default): builds a deterministic plain-text summary (pass/fail counts, Java
  counts if included, list of failed titles) — the report is always fully populated either way.
- Updates the `runs` row: `status`, `finished_at`, `report_path`.

## Frontend (`frontend/`, Vite + React) — unchanged pages/contracts except authoring
- `lib/wsClient.js`, `pages/LiveRun.jsx`, `pages/ReportView.jsx`, `pages/Dashboard.jsx`,
  `components/LiveLogPanel.jsx`, `components/ScreenshotPane.jsx`, `components/StatusBadge.jsx`
  — untouched by the rebuild; they only depend on the WS/REST contracts above, which are
  preserved.
- `pages/TestCases.jsx` — manual test-case form now has a `description` field (optional) and a
  required-for-running `spec_code` field (real Playwright code, prefilled with per-type
  boilerplate), plus an "AI Draft" action once a test case is saved; run-launch controls gained
  an "AI summary" opt-in checkbox alongside "Include Java tests".
- `components/TestCaseCard.jsx` — shows description/spec preview, an "Unauthored" badge and
  disabled Approve when `spec_code` is empty, and an inline spec editor (with AI Draft) for
  authoring/editing a test case's code.
- Dev ports: backend `4000`, frontend Vite `5173` (`VITE_API_BASE` configurable).

## Backend server assembly (`backend/src/server.js`) — unchanged
Express app, JSON body parsing, routes under `/api`, `runs/` served statically under `/runs`,
`ws` hub on the same HTTP server at `/ws`, `app.listen(4000)`, CORS for the Vite dev origin.

## One-time setup for a fresh checkout
```
cd backend && npm install
cd ../frontend && npm install
cd ../playwright && npm install && npx playwright install chromium
```
`claude` CLI must be installed and authenticated on the machine for discovery/AI-draft/AI-summary
features to work — none of it is required for plain test authoring/execution.
