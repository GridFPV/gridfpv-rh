import { defineConfig, devices } from '@playwright/test';

/**
 * The suite drives one RotorHazard: the dev rig on :5050 by default (`make rig-up`), or
 * whatever RH_URL names. RotorHazard is a single shared state machine (one current heat,
 * one race), so specs run one at a time, never in parallel.
 */
export const RH_URL = process.env.RH_URL ?? 'http://localhost:5050';
export const RH_USER = process.env.RH_USER ?? 'admin';
export const RH_PASS = process.env.RH_PASS ?? 'rotorhazard';

export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  outputDir: './test-results',
  use: {
    baseURL: RH_URL,
    // RotorHazard's admin pages and our admin screens share one basic-auth realm (#11).
    httpCredentials: { username: RH_USER, password: RH_PASS },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome']
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }]
});
