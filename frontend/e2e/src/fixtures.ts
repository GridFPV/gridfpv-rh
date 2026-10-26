/**
 * Test fixtures: a connected `rig` (RotorHazard's socket + JSON API, no browser) and `rh`
 * (page objects over RotorHazard's own pages for the RH-agrees assertions, #31).
 *
 * Every test starts from an empty database: RotorHazard is one shared state machine, so a
 * spec that inherited another spec's heats would be testing the order of the suite.
 */
import { test as base } from '@playwright/test';
import { RH_PASS, RH_URL, RH_USER } from '../playwright.config.js';
import { Rig } from './rig.js';
import { RhPages } from './rh-pages.js';

export const test = base.extend<{ rig: Rig; rh: RhPages }>({
  // eslint-disable-next-line no-empty-pattern
  rig: async ({}, use) => {
    const rig = new Rig(RH_URL, { user: RH_USER, pass: RH_PASS });
    await rig.connect();
    await rig.reset('all');
    await use(rig);
    rig.disconnect();
  },
  rh: async ({ page }, use) => {
    await use(new RhPages(page));
  }
});

export { expect } from '@playwright/test';
