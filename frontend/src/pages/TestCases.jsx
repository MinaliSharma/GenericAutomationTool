import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  approveTestCase,
  clearAllTestCases,
  clearGeneratedTestCases,
  createRun,
  createTestCase,
  deleteTestCase,
  discoverTests,
  draftTestCaseSpec,
  generateScenarioTestCases,
  getProject,
  listTestCases,
  updateTestCase,
} from '../lib/api';
import TestCaseCard from '../components/TestCaseCard';

const SPEC_BOILERPLATE = {
  browser:
    "import { test, expect } from '@playwright/test';\n\ntest('title', async ({ page }) => {\n  await page.goto('/');\n  // TODO\n});\n",
  api:
    "import { test, expect } from '@playwright/test';\n\ntest('title', async ({ request }) => {\n  const res = await request.get('/');\n  expect(res.status()).toBe(200);\n});\n",
};

const EMPTY_FORM = { type: 'browser', title: '', description: '', spec_code: SPEC_BOILERPLATE.browser };

const DESCRIPTION_PLACEHOLDER = {
  browser: 'e.g.\n1. Go to /login\n2. Enter valid credentials\n3. Click "Sign in"\n4. Assert the dashboard page loads',
  api: 'e.g.\n1. POST /api/login with valid credentials\n2. Assert status 200\n3. GET /api/me with returned token\n4. Assert response contains the user email',
};

export default function TestCases() {
  const { projectId } = useParams();
  const navigate = useNavigate();

  const [project, setProject] = useState(null);
  const [testCases, setTestCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [form, setForm] = useState(EMPTY_FORM);
  const [specTouched, setSpecTouched] = useState(false);
  const [creating, setCreating] = useState(false);

  const [discovering, setDiscovering] = useState(false);
  const [scenario, setScenario] = useState('');
  const [generatingScenario, setGeneratingScenario] = useState(false);

  const [selectedIds, setSelectedIds] = useState(new Set());
  const [includeJava, setIncludeJava] = useState(false);
  const [aiSummary, setAiSummary] = useState(false);
  const [runSubmitting, setRunSubmitting] = useState(false);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [proj, cases] = await Promise.all([getProject(projectId), listTestCases(projectId)]);
      setProject(proj);
      setTestCases(cases || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const approvedCases = testCases.filter((tc) => tc.approved);
  const candidates = testCases.filter((tc) => !tc.approved);

  function handleTypeChange(type) {
    setForm((prev) => ({
      ...prev,
      type,
      // Only swap the boilerplate if the user hasn't started editing the spec yet.
      spec_code: specTouched ? prev.spec_code : SPEC_BOILERPLATE[type],
    }));
  }

  function handleSpecChange(value) {
    setSpecTouched(true);
    setForm((prev) => ({ ...prev, spec_code: value }));
  }

  async function handleCreateTestCase(e) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setCreating(true);
    try {
      await createTestCase(projectId, {
        type: form.type,
        title: form.title.trim(),
        description: form.description.trim(),
        spec_code: form.spec_code.trim(),
      });
      setForm(EMPTY_FORM);
      setSpecTouched(false);
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleDraftSpec(id) {
    try {
      const res = await draftTestCaseSpec(id, {});
      await refresh();
      return res.spec_code;
    } catch (err) {
      setError(err.message);
      return null;
    }
  }

  async function handleSaveSpec(id, patch) {
    try {
      await updateTestCase(id, patch);
      await refresh();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }

  async function handleDelete(id) {
    try {
      await deleteTestCase(id);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDiscover() {
    setDiscovering(true);
    setError(null);
    try {
      await discoverTests(projectId);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setDiscovering(false);
    }
  }

  async function handleClearGenerated() {
    if (!window.confirm('Clear all unapproved generated test cases for this project?')) return;
    try {
      await clearGeneratedTestCases(projectId);
      setSelectedIds(new Set());
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleClearAll() {
    if (!window.confirm('Delete ALL test cases in this project? This cannot be undone.')) return;
    try {
      await clearAllTestCases(projectId);
      setSelectedIds(new Set());
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleGenerateScenario(e) {
    e.preventDefault();
    if (!scenario.trim()) return;
    setGeneratingScenario(true);
    setError(null);
    try {
      await generateScenarioTestCases(projectId, scenario.trim());
      setScenario('');
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setGeneratingScenario(false);
    }
  }

  async function handleApprove(id) {
    try {
      await approveTestCase(id);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDiscard(id) {
    try {
      await deleteTestCase(id);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleRunSelected() {
    if (selectedIds.size === 0) return;
    setRunSubmitting(true);
    setError(null);
    try {
      const run = await createRun(projectId, {
        test_case_ids: Array.from(selectedIds),
        include_java: includeJava,
        ai_summary: aiSummary,
      });
      navigate(`/runs/${run.id}/live`);
    } catch (err) {
      setError(err.message);
      setRunSubmitting(false);
    }
  }

  if (loading) return <div className="page"><p>Loading…</p></div>;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <Link to="/" className="back-link">
            ← Dashboard
          </Link>
          <h1>{project ? project.name : `Project #${projectId}`}</h1>
        </div>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      <section className="panel">
        <div className="panel-header-row">
          <h2>Generate test cases from a scenario</h2>
        </div>
        <form className="form" onSubmit={handleGenerateScenario}>
          <label>
            Scenario
            <textarea
              rows={5}
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
              placeholder="e.g. A customer can search products, filter results, add an item to the cart, and remove it again."
              required
            />
          </label>
          <p className="muted">Generates reviewable test cases only. Specs are created later for the cases you approve.</p>
          <button type="submit" className="btn btn-primary" disabled={generatingScenario || !scenario.trim()}>
            {generatingScenario ? 'Generating…' : 'Generate test cases'}
          </button>
        </form>
      </section>

      <section className="panel">
        <h2>Add a manual test case</h2>
        <form className="form" onSubmit={handleCreateTestCase}>
          <div className="radio-group">
            <label>
              <input
                type="radio"
                name="type"
                value="browser"
                checked={form.type === 'browser'}
                onChange={() => handleTypeChange('browser')}
              />
              Browser
            </label>
            <label>
              <input
                type="radio"
                name="type"
                value="api"
                checked={form.type === 'api'}
                onChange={() => handleTypeChange('api')}
              />
              API
            </label>
          </div>
          <label>
            Title
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
            />
          </label>
          <label>
            Description (plain English, optional — used for AI Draft)
            <textarea
              rows={4}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder={DESCRIPTION_PLACEHOLDER[form.type]}
            />
          </label>
          <label>
            Playwright test code
            <textarea
              rows={8}
              className="code-textarea"
              value={form.spec_code}
              onChange={(e) => handleSpecChange(e.target.value)}
            />
          </label>
          <p className="muted">
            Note: "AI Draft" (auto-generating this spec from the description) is available after saving —
            open the test case below and click "Author spec".
          </p>
          <button type="submit" className="btn btn-primary" disabled={creating}>
            {creating ? 'Adding…' : 'Add Test Case'}
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="panel-header-row">
          <h2>Discover tests</h2>
          <div className="run-controls">
            <button type="button" className="btn btn-secondary" onClick={handleDiscover} disabled={discovering}>
              {discovering ? 'Discovering…' : 'Discover tests'}
            </button>
            <button
              type="button"
              className="btn btn-discard"
              onClick={handleClearGenerated}
              disabled={candidates.length === 0}
            >
              Clear generated tests
            </button>
            <button type="button" className="btn btn-danger" onClick={handleClearAll} disabled={testCases.length === 0}>
              Clear all test cases
            </button>
          </div>
        </div>
        {discovering && <p className="muted">Crawling target and asking Claude for candidate tests…</p>}
        {candidates.length > 0 && (
          <div className="test-case-list">
            {candidates.map((tc) => (
              <TestCaseCard
                key={tc.id}
                testCase={tc}
                serialNumber={testCases.findIndex((item) => item.id === tc.id) + 1}
                onApprove={handleApprove}
                onDiscard={handleDiscard}
                onDraftSpec={handleDraftSpec}
                onSaveSpec={handleSaveSpec}
              />
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-header-row">
          <h2>Approved test cases</h2>
          <div className="run-controls">
            {project?.java_repo_path && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={includeJava}
                  onChange={(e) => setIncludeJava(e.target.checked)}
                />
                Include Java tests
              </label>
            )}
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={aiSummary}
                onChange={(e) => setAiSummary(e.target.checked)}
              />
              AI summary
            </label>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleRunSelected}
              disabled={selectedIds.size === 0 || runSubmitting}
            >
              {runSubmitting ? 'Starting run…' : `Run Selected Tests (${selectedIds.size})`}
            </button>
          </div>
        </div>
        {approvedCases.length === 0 ? (
          <p className="muted">No approved test cases yet.</p>
        ) : (
          <div className="test-case-list">
            {approvedCases.map((tc) => (
              <TestCaseCard
                key={tc.id}
                testCase={tc}
                serialNumber={testCases.findIndex((item) => item.id === tc.id) + 1}
                selected={selectedIds.has(tc.id)}
                onToggleSelect={toggleSelect}
                onDiscard={handleDelete}
                onDraftSpec={handleDraftSpec}
                onSaveSpec={handleSaveSpec}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
