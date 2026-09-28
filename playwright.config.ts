import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  use: {
    browserName: 'chromium',
    baseURL: 'http://127.0.0.1:5173',
    launchOptions: {
      // Optional system Chromium; otherwise use `npx playwright install chromium`.
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
    },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
  },
});
