import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

export default defineConfig({
  testDir: path.join(__dirname, 'integration'),
  testMatch: '**/*.spec.ts',
  testIgnore: '**/src/**',
  timeout: 30000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:4001',
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

  /* Run Volto dev server before starting tests */
  webServer: [
    {
      name: 'Backend',
      command: 'pnpm run test:playwright:start-backend',
      port: 9000,
      reuseExistingServer: !process.env.CI,
    },
    {
      // Volto creates TWO servers:
      // - PORT 4001: Razzle SSR server (set by PORT env var)
      // - PORT 4002: webpack-dev-server frontend (auto-incremented from PORT)
      // Tests use port 4002 (webpack-dev-server)
      // NOTE: Dependencies must be built once first with: pnpm build:deps
      name: 'Frontend',
      command:
        'PORT=4001 RAZZLE_API_PATH=http://localhost:9000 VOLTOCONFIG=$(pwd)/volto.config.js pnpm --filter @plone/volto start',
      port: 4001,
      cwd: path.join(__dirname, '../../..'), // Run from admin project root
      // url: 'http://localhost:4001/', // Health check on SSR server (returns 200 when webpack ready)
      timeout: 300 * 1000, // 5 minutes for initial webpack compilation
      reuseExistingServer: true, // Always reuse - expect it to be running manually
      env: {
        PORT: '4001',
        RAZZLE_API_PATH: 'http://localhost:9000',
        VOLTOCONFIG: path.join(__dirname, '../../../volto.config.js'),
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
