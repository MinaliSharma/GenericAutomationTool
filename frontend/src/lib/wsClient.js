import { API_BASE } from './api';

// Derives a ws:// or wss:// host from VITE_API_BASE (e.g. http://localhost:4000).
function wsBase() {
  try {
    const url = new URL(API_BASE);
    const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${url.host}`;
  } catch {
    return 'ws://localhost:4000';
  }
}

// Opens a WS connection for a run, calling onEvent(event) for every message.
// Returns a close() function that stops reconnect attempts and closes the socket.
export function connectRunSocket(runId, onEvent, { onStatusChange } = {}) {
  let socket = null;
  let closedByCaller = false;
  let retryDelay = 1000;
  const maxRetryDelay = 15000;
  let retryTimer = null;

  function setStatus(status) {
    if (onStatusChange) onStatusChange(status);
  }

  function connect() {
    if (closedByCaller) return;
    const url = `${wsBase()}/ws?runId=${encodeURIComponent(runId)}`;
    socket = new WebSocket(url);

    socket.onopen = () => {
      retryDelay = 1000;
      setStatus('open');
    };

    socket.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data);
        if (parsed && parsed.event) {
          onEvent(parsed.event);
        }
      } catch (err) {
        console.error('Failed to parse WS message', err);
      }
    };

    socket.onclose = () => {
      setStatus('closed');
      if (!closedByCaller) {
        retryTimer = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, maxRetryDelay);
      }
    };

    socket.onerror = () => {
      // onclose will fire right after; reconnect handled there.
    };
  }

  connect();

  return function close() {
    closedByCaller = true;
    if (retryTimer) clearTimeout(retryTimer);
    if (socket) socket.close();
  };
}
