import { defineConfig } from '@playwright/test';

/**
 * Smoke tests against the output of `npm run dist:dir`, kept in their own
 * project so `npm run test:e2e` never needs a packaged build.
 */
export default defineConfig({
  testDir: './tests/packaged',
  // A packaged app's first launch is slower than the dev build's — a cold asar
  // and, on Windows, Defender scanning a freshly written exe.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
});
