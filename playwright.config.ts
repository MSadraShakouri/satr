import { availableParallelism, freemem } from 'node:os';
import { defineConfig } from '@playwright/test';

const MiB = 1024 * 1024;

// How many browsers this machine can actually afford. Playwright's default is
// half the cores, which left a 2-core machine running the whole suite one test
// at a time. The cap below stopped a big machine asking for more, but it
// counted cores and ignored memory — and a phone has eight little cores and a
// fraction of the memory, so it launched eight browsers' worth of renderer and
// starved them. The specs then ran 6-10x slower than the same specs do with
// room, and the ones carrying a real time budget (a receipt that folds in 2s, a
// flick that counts inside 88ms) failed on the clock rather than on anything
// they were testing. Workers are bounded by memory first, cores second.
const MiB_PER_WORKER = 700; // headless shell + its driver + one loaded renderer
const SHARE = 0.6; // the rest is the machine's own, and must stay usable
const ON_A_PHONE = 2; // a phone shares its cores with the reader, not just us

const onAndroid = process.platform === 'android'
  || process.env.TERMUX_VERSION !== undefined
  || process.env.ANDROID_DATA !== undefined;

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  // Every test builds its own page and storage, so files can run side by side.
  // Capped by what is free right now, so an oversubscribed box cannot quietly
  // turn every timeout in the suite into a failure.
  fullyParallel: true,
  workers: process.env.CI ? 2 : Math.max(1, Math.min(
    onAndroid ? ON_A_PHONE : 8,
    availableParallelism(),
    Math.floor((freemem() * SHARE) / (MiB_PER_WORKER * MiB)),
  )),
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
