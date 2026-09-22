# AutomationToolEngine Development Guide

## Local AI test-case generation

The scenario generator supports a local Ollama model through its OpenAI-compatible API.
No cloud API key is required.

1. Install Ollama and download a model, for example: `ollama run llama3.2`
2. Start the backend with `LOCAL_AI_ENABLED=true`.
3. Optionally set `LOCAL_AI_MODEL`, `LOCAL_AI_BASE_URL`, and `LOCAL_AI_TIMEOUT_MS`.

Example:

```sh
LOCAL_AI_ENABLED=true LOCAL_AI_MODEL=llama3.2 npm start
```

When the local model is disabled or unavailable, the backend falls back to deterministic
scenario templates. Generated cases are still reviewable and must receive executable
Playwright spec code before approval and execution.

## Project conventions

- Keep browser and API specs under `playwright/tests/browser` and `playwright/tests/api`.
- Validate generated JavaScript before writing spec files.
- Do not commit credentials, model tokens, or machine-specific configuration.
- Run backend tests from `backend` with `node --test src/orchestrator/aiService.test.js`.