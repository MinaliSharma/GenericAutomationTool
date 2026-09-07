const { WebSocketServer } = require('ws');
const url = require('url');
const db = require('../db/db');

// runId (number) -> Set of open WebSocket connections
const sockets = new Map();

function registerSocket(runId, ws) {
  if (!sockets.has(runId)) {
    sockets.set(runId, new Set());
  }
  sockets.get(runId).add(ws);
  ws.on('close', () => {
    const set = sockets.get(runId);
    if (set) {
      set.delete(ws);
      if (set.size === 0) sockets.delete(runId);
    }
  });
}

/**
 * Sends a single event to all currently-open sockets subscribed to runId.
 * Does NOT persist - callers that need persistence should use persistAndBroadcast.
 */
function broadcast(runId, event) {
  const set = sockets.get(Number(runId));
  if (!set || set.size === 0) return;
  const message = JSON.stringify({ runId: Number(runId), event });
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) {
      ws.send(message);
    }
  }
}

/**
 * Persists a normalized run_event to SQLite, then broadcasts it (with its DB id)
 * to any open sockets for that run. This is the function routes/orchestration
 * logic should call for every event produced during a run.
 *
 * @param {number} runId
 * @param {object} event - { category, type, payload, createdAt, testCaseId? }
 * @returns {object} the persisted event (with id), same shape sent over WS
 */
function persistAndBroadcast(runId, event) {
  const persisted = db.insertRunEvent({
    run_id: runId,
    test_case_id: event.testCaseId !== undefined ? event.testCaseId : null,
    category: event.category,
    type: event.type,
    payload: event.payload,
    created_at: event.createdAt
  });
  broadcast(runId, persisted);
  return persisted;
}

function attach(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const parsed = url.parse(req.url, true);
    const runIdRaw = parsed.query.runId;
    const runId = Number(runIdRaw);

    if (!runIdRaw || Number.isNaN(runId)) {
      ws.close(1008, 'runId query parameter is required');
      return;
    }

    registerSocket(runId, ws);

    // Send all persisted events for this run first, oldest first.
    try {
      const events = db.listRunEvents(runId);
      for (const event of events) {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ runId, event }));
        }
      }
    } catch (e) {
      // If the run doesn't exist yet or DB read fails, just keep the socket open
      // for future live events rather than crashing the connection.
    }
  });

  return wss;
}

module.exports = { attach, broadcast, persistAndBroadcast };
