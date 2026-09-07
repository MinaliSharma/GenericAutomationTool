const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');

const db = require('./db/db');
const wsHub = require('./ws/hub');

const projectsRouter = require('./routes/projects');
const testcasesRouter = require('./routes/testcases');
const runsRouter = require('./routes/runs');

const app = express();

app.use(
  cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173']
  })
);
app.use(express.json());

app.use('/api', projectsRouter);
app.use('/api', testcasesRouter);
app.use('/api', runsRouter);

// Serve per-run artifacts (screenshots, report.html) statically.
const RUNS_DIR = path.join(db.REPO_ROOT, 'runs');
app.use('/runs', express.static(RUNS_DIR));

const server = http.createServer(app);
wsHub.attach(server);

const PORT = 4000;
server.listen(PORT, () => {
  console.log(`AI QA Tester backend listening on http://localhost:${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws?runId=<id>`);
});

module.exports = { app, server };
