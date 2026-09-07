import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.js',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: process.env.PW_OUTPUT_DIR || 'test-results',
  use: {
    baseURL: process.env.PW_BASE_URL || 'https://practicetestautomation.com',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'browser', testDir: './tests/browser', use: { ...devices['Desktop Chrome'] } },
    { name: 'api', testDir: './tests/api', use: { baseURL: process.env.PW_API_BASE_URL } },
  ],
});
