import { useEffect, useRef } from 'react';

function defaultRenderItem(event, idx) {
  const { type, payload = {} } = event;
  const key = event.id ?? idx;
  switch (type) {
    case 'step_start':
      return (
        <div key={key} className="log-line log-step-start">
          ▶ Step started: {payload.title}
        </div>
      );
    case 'tool_call':
      return (
        <div key={key} className="log-line log-tool-call">
          → {payload.tool}({JSON.stringify(payload.input)})
        </div>
      );
    case 'tool_result':
      return (
        <div key={key} className="log-line log-tool-result">
          ← {payload.tool}: {payload.summary}
        </div>
      );
    case 'step_result':
      return (
        <div key={key} className={`log-line log-step-result log-${payload.status}`}>
          {payload.status === 'passed' ? '✓' : '✗'} {payload.message}
        </div>
      );
    case 'java_log':
      return (
        <div key={key} className="log-line log-java">
          {payload.line}
        </div>
      );
    case 'error':
      return (
        <div key={key} className="log-line log-error">
          ⚠ {payload.message}
        </div>
      );
    case 'summary':
      return (
        <div key={key} className="log-line log-summary">
          {payload.text}
        </div>
      );
    default:
      return (
        <div key={key} className="log-line">
          {type}: {JSON.stringify(payload)}
        </div>
      );
  }
}

// Scrolling log of events, auto-scrolls to bottom on new entries.
// `events`: array of run_event objects. `renderItem(event, idx)` optional render-prop.
export default function LiveLogPanel({ events, renderItem, emptyText = 'No events yet.' }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events]);

  const render = renderItem || defaultRenderItem;

  return (
    <div className="live-log-panel" ref={scrollRef}>
      {events.length === 0 ? (
        <div className="log-empty">{emptyText}</div>
      ) : (
        events.map((event, idx) => render(event, idx))
      )}
    </div>
  );
}
