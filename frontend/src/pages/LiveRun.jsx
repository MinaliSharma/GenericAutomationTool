import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { API_BASE, getRun, getRunEvents, rerunFailedTests } from '../lib/api';
import { connectRunSocket } from '../lib/wsClient';
import LiveLogPanel from '../components/LiveLogPanel';
import ScreenshotPane from '../components/ScreenshotPane';
import StatusBadge from '../components/StatusBadge';

const TERMINAL_STATUSES = new Set(['passed', 'failed', 'error']);
const POLL_INTERVAL_MS = 4000;

function eventKey(event) {
  // Prefer server-assigned id; fall back to a composite key for events that
  // (in theory) might arrive without one.
  if (event.id !== undefined && event.id !== null) return `id:${event.id}`;
  return `k:${event.category}:${event.type}:${event.createdAt}:${JSON.stringify(event.payload)}`;
}

export default function LiveRun() {
  const { runId } = useParams();
  const [events, setEvents] = useState([]);
  const [run, setRun] = useState(null);
  const [wsStatus, setWsStatus] = useState('connecting');
  const [rerunning, setRerunning] = useState(false);
  const seenKeys = useRef(new Set());
  const navigate = useNavigate();

  function mergeEvents(newEvents) {
    if (!newEvents || newEvents.length === 0) return;
    // Dedup against seenKeys OUTSIDE the setEvents updater. React (in StrictMode dev
    // builds) invokes state-updater functions twice to detect impure updaters; mutating
    // seenKeys.current from inside the updater made it impure, so the discarded first
    // invocation would mark events as "seen" and the authoritative second invocation
    // would then treat them as duplicates and drop them.
    const toAdd = [];
    for (const event of newEvents) {
      const key = eventKey(event);
      if (seenKeys.current.has(key)) continue;
      seenKeys.current.add(key);
      toAdd.push(event);
    }
    if (toAdd.length === 0) return;
    setEvents((prev) => [...prev, ...toAdd]);
  }

  // Hydrate from REST first (covers events that happened before we connect),
  // then open the live socket. Both feeds are de-duplicated by event id.
  useEffect(() => {
    let cancelled = false;
    seenKeys.current = new Set();
    setEvents([]);

    getRunEvents(runId)
      .then((initial) => {
        if (!cancelled) mergeEvents(initial || []);
      })
      .catch((err) => console.error('Failed to load run events', err));

    const close = connectRunSocket(runId, (event) => mergeEvents([event]), {
      onStatusChange: setWsStatus,
    });

    return () => {
      cancelled = true;
      close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  // Poll run status until terminal.
  useEffect(() => {
    let cancelled = false;
    let timer = null;

    async function poll() {
      try {
        const data = await getRun(runId);
        if (cancelled) return;
        setRun(data);
        if (!TERMINAL_STATUSES.has(data.status)) {
          timer = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch (err) {
        console.error('Failed to poll run status', err);
        if (!cancelled) timer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId]);

  const byCategory = useMemo(() => {
    const groups = { browser: [], api: [], java: [] };
    for (const event of events) {
      if (groups[event.category]) groups[event.category].push(event);
    }
    return groups;
  }, [events]);

  const latestScreenshot = (categoryEvents) => {
    for (let i = categoryEvents.length - 1; i >= 0; i -= 1) {
      if (categoryEvents[i].type === 'screenshot') return categoryEvents[i];
    }
    return null;
  };

  const browserScreenshot = latestScreenshot(byCategory.browser);
  const apiScreenshot = latestScreenshot(byCategory.api);
  const javaResult = byCategory.java.slice().reverse().find((e) => e.type === 'java_result');

  const isTerminal = run && TERMINAL_STATUSES.has(run.status);

  async function handleRerun() {
    setRerunning(true);
    try {
      const nextRun = await rerunFailedTests(runId);
      navigate(`/runs/${nextRun.id}/live`);
    } catch (err) {
      console.error('Failed to rerun failed tests', err);
      setRerunning(false);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <Link to="/" className="back-link">
            ← Dashboard
          </Link>
          <h1>Run #{runId}</h1>
        </div>
        <div className="run-header-status">
          {run && <StatusBadge status={run.status} />}
          <span className={`ws-indicator ws-${wsStatus}`}>{wsStatus === 'open' ? 'live' : wsStatus}</span>
          {isTerminal && (
            <Link className="btn btn-primary" to={`/runs/${runId}/report`}>
              View Report
            </Link>
          )}
          {run && (run.status === 'failed' || run.status === 'error') && (
            <button type="button" className="btn btn-secondary" onClick={handleRerun} disabled={rerunning}>
              {rerunning ? 'Rerunning…' : 'Rerun failed tests'}
            </button>
          )}
        </div>
      </div>

      <div className="live-run-panels">
        <div className="panel live-panel">
          <h2>Browser</h2>
          <ScreenshotPane
            src={browserScreenshot ? `${API_BASE}/runs/${runId}/${browserScreenshot.payload.path}` : null}
            alt="Latest browser screenshot"
          />
          <LiveLogPanel
            events={byCategory.browser.filter((e) => e.type === 'tool_call' || e.type === 'tool_result' || e.type === 'step_start' || e.type === 'step_result' || e.type === 'error')}
          />
        </div>

        <div className="panel live-panel">
          <h2>API</h2>
          <ScreenshotPane
            src={apiScreenshot ? `${API_BASE}/runs/${runId}/${apiScreenshot.payload.path}` : null}
            alt="Latest API screenshot"
          />
          <LiveLogPanel
            events={byCategory.api.filter((e) => e.type === 'tool_call' || e.type === 'tool_result' || e.type === 'step_start' || e.type === 'step_result' || e.type === 'error')}
          />
        </div>

        <div className="panel live-panel">
          <h2>Java</h2>
          <LiveLogPanel
            events={byCategory.java.filter((e) => e.type === 'java_log')}
            emptyText="No Java output yet."
          />
          {javaResult && (
            <div className="java-summary-card">
              <div>Total: {javaResult.payload.total}</div>
              <div className="pass">Passed: {javaResult.payload.passed}</div>
              <div className="fail">Failed: {javaResult.payload.failed}</div>
              <div className="fail">Errors: {javaResult.payload.errors}</div>
              {javaResult.payload.failures?.length > 0 && (
                <ul className="java-failures">
                  {javaResult.payload.failures.map((f, i) => (
                    <li key={i}>
                      <strong>{f.testName}</strong>: {f.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
