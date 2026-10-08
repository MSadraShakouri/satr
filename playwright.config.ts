import { availableParallelism } from 'node:os';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  // Every test builds its own page and storage, so files can run side by side.
  // Playwright's default is half the cores, which left a 2-core machine running
  // the whole suite one test at a time. Capped so a big machine doesn't run
  // more browsers than the memory it has.
  fullyParallel: true,
  workers: process.env.CI ? 2 : Math.min(8, availableParallelism()),
  use: {
    browserName: 'chromium',
    baseURL: 'http://127.0.0.1:5173',
    launchOptions: {
      // Optional system Chromium; otherwise use `npx playwright install chromium`.
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
    },
  },
  webServer: {
    // The production build (plus the test hook from tests/support/expose.ts),
    // served the way the app ships. Built fresh on every run, so the server is
    // never reused: a reused one could be serving last run's files.
    command: 'npx vite build --config tests/vite.test.config.ts && npx vite preview --config vite.config.ts --outDir test-dist --host 127.0.0.1 --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
