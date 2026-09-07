import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { API_BASE, getRun, rerunFailedTests } from '../lib/api';
import StatusBadge from '../components/StatusBadge';

export default function ReportView() {
  const { runId } = useParams();
  const [run, setRun] = useState(null);
  const [error, setError] = useState(null);
  const [rerunning, setRerunning] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    getRun(runId)
      .then(setRun)
      .catch((err) => setError(err.message));
  }, [runId]);

  async function handleRerun() {
    setRerunning(true);
    setError(null);
    try {
      const nextRun = await rerunFailedTests(runId);
      navigate(`/runs/${nextRun.id}/live`);
    } catch (err) {
      setError(err.message);
    } finally {
      setRerunning(false);
    }
  }

  const reportUrl = `${API_BASE}/api/runs/${runId}/report`;

  return (
    <div className="page report-page">
      <div className="page-header">
        <div>
          <Link to="/" className="back-link">
            ← Dashboard
          </Link>
          <h1>Run #{runId} Report</h1>
        </div>
        <div className="run-header-status">
          {run && <StatusBadge status={run.status} />}
          {run && (run.status === 'failed' || run.status === 'error') && (
            <button type="button" className="btn btn-primary" onClick={handleRerun} disabled={rerunning}>
              {rerunning ? 'Rerunning…' : 'Rerun failed tests'}
            </button>
          )}
          <a className="btn btn-secondary" href={reportUrl} target="_blank" rel="noreferrer">
            Download / Open Full Report
          </a>
        </div>
      </div>

      {error && <div className="banner banner-error">Failed to load run metadata: {error}</div>}

      <div className="report-frame-wrap">
        <iframe title={`Run ${runId} report`} src={reportUrl} className="report-frame" />
      </div>
    </div>
  );
}
