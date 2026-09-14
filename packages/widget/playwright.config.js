import { defineConfig, devices } from '@playwright/test';

// Runs against the BUILT widget, served statically — which is the whole point.
// The failures this exists to catch (module resolution, chunk order, CJS/ESM
// interop) only exist in the build, so testing the source would miss all of
// them, as it did four times.
export default defineConfig({
  testDir: './tests-browser',
  fullyParallel: true,
  reporter: [['list']],
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:4178',
    trace: 'retain-on-failure',
  },
  // Builds first: a stale dist would test the previous bundle and pass while
  // the shipped one is broken.
  webServer: {
    command: 'npm run build && npx http-server dist -p 4178 --silent',
    url: 'http://127.0.0.1:4178/widget.html',
    reuseExistingServer: false,
    timeout: 180_000,
  },
  // Uses the installed Chrome rather than Playwright's own download, which has
  // no build for older macOS. CI can drop the channel and use the bundled one.
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: process.env.PW_CHANNEL || 'chrome' },
    },
  ],
});
