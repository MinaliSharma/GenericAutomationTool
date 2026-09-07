const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function truncate(str, max = 500) {
  if (typeof str !== 'string') {
    try {
      str = JSON.stringify(str);
    } catch (e) {
      str = String(str);
    }
  }
  if (str.length > max) {
    return str.slice(0, max) + `... [truncated, ${str.length} chars total]`;
  }
  return str;
}

function pad3(n) {
  return String(n).padStart(3, '0');
}

/**
 * Runs a tool-using Claude task, streaming normalized run_event objects as they happen.
 * Resolves when the subprocess exits.
 *
 * @param {object} opts
 * @param {string} opts.prompt - prompt text
 * @param {string} [opts.cwd] - working directory (defaults to repo root so relative
 *   --mcp-config path resolves)
 * @param {function} opts.onEvent - called with each normalized event:
 *   { category: 'browser', type: 'tool_call'|'tool_result'|'screenshot'|'error', payload, createdAt }
 * @param {string} [opts.screenshotDir] - absolute directory to write screenshot PNG files into.
 *   Files are named NNN.png (sequential). If omitted, screenshots are skipped (a tool_result
 *   event with a note is emitted instead).
 * @param {string} [opts.screenshotRelPrefix] - relative path prefix to use in the emitted
 *   screenshot event's `path` field (e.g. 'screenshots'). Defaults to 'screenshots'.
 * @returns {Promise<{exitCode: number, fullText: string}>}
 */
async function runClaudeTask({ prompt, cwd, onEvent, screenshotDir, screenshotRelPrefix }) {
  const workingDir = cwd || REPO_ROOT;
  const relPrefix = screenshotRelPrefix || 'screenshots';
  const emit = typeof onEvent === 'function' ? onEvent : () => {};

  if (screenshotDir) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(
        'claude',
        [
          '-p',
          prompt,
          '--output-format',
          'stream-json',
          '--mcp-config',
          'mcp-configs/playwright.json',
          '--allowedTools',
          'mcp__playwright__*',
          '--permission-mode',
          'bypassPermissions',
          '--verbose'
        ],
        { cwd: workingDir, stdio: ['ignore', 'pipe', 'pipe'] }
      );
    } catch (err) {
      emit({
        category: 'system',
        type: 'error',
        payload: { message: `Failed to spawn claude CLI: ${err.message}` },
        createdAt: new Date().toISOString()
      });
      resolve({ exitCode: -1, fullText: '' });
      return;
    }

    let fullText = '';
    let screenshotCounter = 0;
    // map of tool_use_id -> tool name, so tool_result lines can report which tool ran
    const toolNameById = new Map();
    let stderrBuf = '';

    const rl = readline.createInterface({ input: child.stdout });

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let obj;
      try {
        obj = JSON.parse(trimmed);
      } catch (e) {
        // malformed / non-JSON line - skip defensively
        return;
      }

      try {
        handleStreamObject(obj);
      } catch (e) {
        emit({
          category: 'system',
          type: 'error',
          payload: { message: `Error handling claude stream event: ${e.message}` },
          createdAt: new Date().toISOString()
        });
      }
    });

    child.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString();
    });

    child.on('error', (err) => {
      emit({
        category: 'system',
        type: 'error',
        payload: { message: `claude process error: ${err.message}` },
        createdAt: new Date().toISOString()
      });
    });

    child.on('close', (exitCode) => {
      if (exitCode !== 0 && stderrBuf.trim()) {
        emit({
          category: 'system',
          type: 'error',
          payload: { message: `claude exited with code ${exitCode}: ${truncate(stderrBuf, 800)}` },
          createdAt: new Date().toISOString()
        });
      }
      resolve({ exitCode, fullText, stderr: stderrBuf.trim() });
    });

    function handleStreamObject(obj) {
      if (obj.type === 'assistant' && obj.message && Array.isArray(obj.message.content)) {
        for (const block of obj.message.content) {
          if (block.type === 'text' && typeof block.text === 'string') {
            fullText += block.text;
          } else if (block.type === 'tool_use') {
            toolNameById.set(block.id, block.name);
            emit({
              category: 'browser',
              type: 'tool_call',
              payload: { tool: block.name, input: block.input || {} },
              createdAt: new Date().toISOString()
            });
          }
        }
      } else if (obj.type === 'user' && obj.message && Array.isArray(obj.message.content)) {
        for (const block of obj.message.content) {
          if (block.type === 'tool_result') {
            handleToolResult(block);
          }
        }
      } else if (obj.type === 'result') {
        if (typeof obj.result === 'string' && obj.result) {
          fullText += obj.result;
        }
      }
      // other stream types (system/init, etc.) are ignored
    }

    function handleToolResult(block) {
      const toolName = toolNameById.get(block.tool_use_id) || 'unknown';
      const contentItems = Array.isArray(block.content)
        ? block.content
        : typeof block.content === 'string'
        ? [{ type: 'text', text: block.content }]
        : [];

      let textParts = [];
      let imageHandled = false;

      for (const item of contentItems) {
        if (item && item.type === 'image' && item.source && item.source.data) {
          imageHandled = true;
          const relPath = writeScreenshot(item.source.data);
          if (relPath) {
            emit({
              category: 'browser',
              type: 'screenshot',
              payload: { path: relPath },
              createdAt: new Date().toISOString()
            });
          } else {
            emit({
              category: 'browser',
              type: 'tool_result',
              payload: { tool: toolName, summary: '[screenshot received but no screenshotDir configured]' },
              createdAt: new Date().toISOString()
            });
          }
        } else if (item && item.type === 'text' && typeof item.text === 'string') {
          textParts.push(item.text);
        }
      }

      if (!imageHandled) {
        const summary = truncate(textParts.join('\n') || '[no text content]', 500);
        emit({
          category: 'browser',
          type: 'tool_result',
          payload: { tool: toolName, summary },
          createdAt: new Date().toISOString()
        });
      } else if (textParts.length) {
        // image plus accompanying text - emit the text as a secondary tool_result
        emit({
          category: 'browser',
          type: 'tool_result',
          payload: { tool: toolName, summary: truncate(textParts.join('\n'), 500) },
          createdAt: new Date().toISOString()
        });
      }
    }

    function writeScreenshot(base64Data) {
      if (!screenshotDir) return null;
      screenshotCounter += 1;
      const filename = `${pad3(screenshotCounter)}.png`;
      const filePath = path.join(screenshotDir, filename);
      try {
        fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
      } catch (e) {
        return null;
      }
      return `${relPrefix}/${filename}`;
    }
  });
}

/**
 * Runs a single non-streaming prompt (no tools). Returns the plain text result.
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {string} [opts.cwd]
 * @returns {Promise<string>}
 */
function runClaudePrompt({ prompt, cwd, timeoutMs = 60_000 }) {
  const workingDir = cwd || REPO_ROOT;

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn('claude', ['-p', prompt, '--output-format', 'json'], {
        cwd: workingDir,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (err) {
      reject(new Error(`Failed to spawn claude CLI: ${err.message}`));
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`claude process error: ${err.message}`));
    });

    child.on('close', (exitCode) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error(`claude timed out after ${timeoutMs}ms`));
        return;
      }
      if (exitCode !== 0 && !stdout.trim()) {
        reject(new Error(`claude exited with code ${exitCode}: ${stderr.trim()}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        const text = typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed);
        resolve(text);
      } catch (e) {
        // Defensive: if output isn't valid JSON, return raw stdout rather than crashing.
        resolve(stdout.trim());
      }
    });
  });
}

module.exports = { runClaudeTask, runClaudePrompt };
