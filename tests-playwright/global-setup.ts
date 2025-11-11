import { chromium, FullConfig } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

let serverProcess: ChildProcess | null = null;

async function waitForServer(url: string, timeout: number = 10000): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    try {
      const browser = await chromium.launch();
      const page = await browser.newPage();
      const response = await page.goto(url);
      await browser.close();
      if (response && response.ok()) {
        return;
      }
    } catch (error) {
      // Server not ready yet, wait and retry
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`Server did not start within ${timeout}ms`);
}

export default async function globalSetup(config: FullConfig) {
  console.log('Starting mock Plone API server...');

  // Start the mock Plone server
  const serverPath = path.join(__dirname, 'fixtures', 'mock-plone-server.js');
  serverProcess = spawn('node', [serverPath], {
    stdio: 'inherit',
    detached: false,
    env: {
      ...process.env,
      PORT: '9000',
    },
  });

  // Store PID for teardown
  if (serverProcess.pid) {
    process.env.TEST_SERVER_PID = serverProcess.pid.toString();
  }

  // Wait for server to be ready
  await waitForServer('http://localhost:9000/health');

  console.log('Mock Plone API server ready on http://localhost:9000');
  console.log('Volto will be started automatically by Playwright...');
}
