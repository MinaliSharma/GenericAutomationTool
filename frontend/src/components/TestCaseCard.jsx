import { useState } from 'react';

// A single test case: title, type badge, description/spec preview, and optional actions.
// Props:
//   testCase: { id, type, title, description, spec_code, source, approved }
//   selected, onToggleSelect: for the approved-list checkbox flow
//   onApprove, onDiscard: for the discovered-candidates flow (either may be omitted)
//   onDraftSpec(id): calls the AI-draft endpoint, resolves to a spec_code string (or null on failure)
//   onSaveSpec(id, patch): persists a spec_code edit via PATCH, resolves to true/false
export default function TestCaseCard({
  testCase,
  selected,
  onToggleSelect,
  onApprove,
  onDiscard,
  onDraftSpec,
  onSaveSpec,
  serialNumber,
}) {
  const [authoring, setAuthoring] = useState(false);
  const [draftCode, setDraftCode] = useState(testCase.spec_code || '');
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);

  const isUnauthored = !testCase.spec_code || !testCase.spec_code.trim();

  const descriptionPreview =
    testCase.description && testCase.description.length > 160
      ? `${testCase.description.slice(0, 160)}…`
      : testCase.description;

  const specPreview = isUnauthored
    ? null
    : testCase.spec_code.split('\n').slice(0, 2).join('\n');

  function openAuthoring() {
    setDraftCode(testCase.spec_code || '');
    setAuthoring(true);
  }

  function cancelAuthoring() {
    setAuthoring(false);
    setDraftCode(testCase.spec_code || '');
  }

  async function handleAiDraft() {
    if (!onDraftSpec) return;
    setDrafting(true);
    try {
      const spec = await onDraftSpec(testCase.id);
      if (spec) setDraftCode(spec);
    } finally {
      setDrafting(false);
    }
  }

  async function handleSave() {
    if (!onSaveSpec) return;
    setSaving(true);
    try {
      const ok = await onSaveSpec(testCase.id, { spec_code: draftCode });
      if (ok) setAuthoring(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="test-case-card">
      <div className="test-case-card-header">
        {serialNumber !== undefined && <span className="test-case-serial">TC-{serialNumber}</span>}
        {onToggleSelect && (
          <input
            type="checkbox"
            checked={!!selected}
            onChange={() => onToggleSelect(testCase.id)}
            aria-label={`Select ${testCase.title}`}
          />
        )}
        <span className={`type-badge type-${testCase.type}`}>{testCase.type}</span>
        <span className="test-case-title">{testCase.title}</span>
        {testCase.origin === 'scenario_generated' ? (
          <span className="source-badge">Scenario generated</span>
        ) : testCase.source === 'ai_discovered' ? (
          <span className="source-badge">AI discovered</span>
        ) : null}
        {isUnauthored && <span className="source-badge badge-warning">Unauthored</span>}
      </div>

      {descriptionPreview && <p className="test-case-description-preview">{descriptionPreview}</p>}

      {specPreview ? (
        <pre className="test-case-steps-preview">{specPreview}</pre>
      ) : (
        <p className="muted">No spec code yet — author a Playwright spec to run this test.</p>
      )}

      {authoring && (
        <div className="test-case-spec-editor">
          <textarea
            rows={8}
            className="code-textarea"
            value={draftCode}
            onChange={(e) => setDraftCode(e.target.value)}
          />
          <div className="test-case-card-actions">
            {onDraftSpec && (
              <button type="button" className="btn btn-secondary" onClick={handleAiDraft} disabled={drafting}>
                {drafting ? 'Drafting…' : 'AI Draft'}
              </button>
            )}
            {onSaveSpec && (
              <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={cancelAuthoring} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="test-case-card-actions">
        {!authoring && (onDraftSpec || onSaveSpec) && (
          <button type="button" className="btn btn-secondary" onClick={openAuthoring}>
            {isUnauthored ? 'Author spec' : 'Edit spec'}
          </button>
        )}
        {onApprove && (
          <button
            type="button"
            className="btn btn-approve"
            onClick={() => onApprove(testCase.id)}
            disabled={isUnauthored}
            title={isUnauthored ? 'Author a spec before approving' : undefined}
          >
            Approve
          </button>
        )}
        {isUnauthored && onApprove && <span className="muted">Author a spec first</span>}
        {onDiscard && (
          <button type="button" className="btn btn-discard" onClick={() => onDiscard(testCase.id)}>
            {onApprove ? 'Discard' : 'Delete'}
          </button>
        )}
      </div>
    </div>
  );
}
