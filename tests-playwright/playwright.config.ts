import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

export default defineConfig({
  testDir: path.join(__dirname, 'integration'),
  testMatch: '**/*.spec.ts',
  testIgnore: '**/src/**',
  timeout: 30000,
  fullyParallel: !!process.env.CI,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:4001', // Razzle SSR server port (serves Volto content)
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Start mock API server and Volto dev server before running tests */
  webServer: [
    {
      // Mock Plone API server - must start BEFORE Volto
      name: 'Mock API',
      command: 'node fixtures/mock-plone-server.js',
      url: 'http://localhost:9000/health',
      timeout: 30 * 1000,
      reuseExistingServer: !process.env.CI,
      cwd: path.join(__dirname, '.'), // Run from tests-playwright directory
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        PORT: '9000',
      },
    },
    {
      // Volto creates TWO servers:
      // - PORT 4001: Razzle SSR server (set by PORT env var) - serves content, tests navigate here
      // - PORT 4002: webpack-dev-server (auto-incremented from PORT) - compiles assets, health check here
      // Tests navigate to port 4001 (SSR server for content)
      // Health check on port 4002 (webpack-dev-server) waits for compilation to complete
      // NOTE: Dependencies must be built once first with: pnpm build:deps
      name: 'Frontend',
      command:
        'PORT=4001 RAZZLE_API_PATH=http://localhost:9000 ADDONS=@eeacms/volto-chatbot pnpm --filter @plone/volto start',
      url: 'http://localhost:4002/health', // Health check on webpack-dev-server (returns 200 when ready)
      timeout: 300 * 1000, // 5 minutes for initial webpack compilation
      reuseExistingServer: !process.env.CI, // Reuse in local dev, start fresh in CI
      cwd: path.join(__dirname, '../../..'), // Run from workspace root
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        PORT: '4001',
        RAZZLE_API_PATH: 'http://localhost:9000',
        VOLTOCONFIG: path.join(__dirname, '../../../volto.config.js'),
        ADDONS: '@eeacms/volto-chatbot',
        // Prevent parcel from trying to access TTY
        CI: process.env.CI || 'true',
        // Mock Danswer credentials for testing
        DANSWER_USERNAME: 'test-user',
        DANSWER_PASSWORD: 'test-password',
        DANSWER_URL: 'http://localhost:9000',
      },
    },
  ],
});
