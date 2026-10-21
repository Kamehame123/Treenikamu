import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as core from '../core.js';
import { configuredState } from './statistics-fixtures.mjs';
import { chromium, webkit, startServer, tap } from './support.mjs';

const { server, url } = await startServer();

async function gaps(page, selector, expected, label) {
  const values = await page.locator(selector).evaluateAll((elements) => {
    const boxes = elements.filter((e) => e.getClientRects().length && !['absolute', 'fixed'].includes(getComputedStyle(e).position))
      .map((e) => e.getBoundingClientRect());
    return boxes.slice(1).map((box, i) => box.top - boxes[i].bottom);
  });
  assert.ok(values.length, `${label}: at least two visible elements`);
  for (const value of values) assert.ok(Math.abs(value - expected) < 0.6, `${label}: expected ${expected}px, got ${value}px`);
}

async function fits(page, label) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${label}: no horizontal overflow`);
}

async function cardPadding(page, selector, expected) {
  const values = await page.locator(selector).evaluateAll((elements) => elements.map((e) => {
    const style = getComputedStyle(e);
    return [parseFloat(style.paddingLeft), parseFloat(style.paddingRight)];
  }));
  assert.ok(values.length, `${selector}: cards exist`);
  for (const sides of values) assert.deepEqual(sides, [expected, expected], `${selector}: shared horizontal padding`);
}

try {
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch();
    try {
      for (const width of [320, 390, 768, 1280]) {
        await test(`${name}/${width}: consistent spacing across app screens`, { timeout: 45000 }, async () => {
          const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
          const page = await context.newPage();
          page.setDefaultTimeout(5000);
          const state = configuredState();
          state.settings.restMode = 'fixed';
          const raw = JSON.stringify(state);
          const padding = width <= 380 ? 12 : 16;
          try {
            await page.goto(url);
            await page.evaluate((raw) => localStorage.setItem('gym-tracker-v1', raw), raw);
            await page.reload();
            await page.locator('.settings > summary').click();
            const backup = page.locator('.backup-group');
            assert.equal(await backup.evaluate((e) => e.open), false);
            await backup.locator('> summary').click();
            await gaps(page, '.backup-group [data-action="export"], .backup-group [data-action="import"], .backup-group [data-action="restore"]', 12, 'backup buttons');
            await gaps(page, '.backup.compact > *', 12, 'backup content');
            await gaps(page, '.settings-body > *', 16, 'settings sections');
            await gaps(page, '.rest-settings > *', 12, 'rest controls and help');
            if (await page.locator('.hr-setting > button').count()) await gaps(page, '.hr-setting > *', 12, 'heart-rate text and button');
            else assert.match(await page.locator('.hr-setting').innerText(), /ei tue Bluetooth-sykemittareita/);
            await cardPadding(page, '.settings, .backup-group, .routine', padding);
            await fits(page, 'settings');
            const download = page.waitForEvent('download');
            await tap(backup.getByRole('button', { name: 'Vie varmuuskopio', exact: true }));
            const parsed = core.parseBackup(await readFile(await (await download).path(), 'utf8'));
            assert.equal(parsed.ok, true);
            assert.deepEqual(parsed.state, state, 'export preserves all training data');
            assert.equal(await backup.evaluate((e) => e.open), true, 'export rerender retains expanded backup');
            await backup.locator('> summary').click();
            assert.equal(await backup.getByRole('button', { name: 'Vie varmuuskopio', exact: true }).isVisible(), false);
            const transform = await backup.locator('> summary .settings-chevron').evaluate((e) => getComputedStyle(e).transform);
            assert.equal(transform, 'none', 'opening settings does not rotate a closed nested disclosure');
            await page.getByRole('button', { name: 'Historia', exact: true }).click();
            await gaps(page, '.history-list > li', 12, 'history cards');
            await gaps(page, '.history-list > li:first-child > *', 12, 'history card content');
            await cardPadding(page, '.history-list > li', padding);
            await page.locator('.history-log > summary').first().click();
            await page.locator('.history-actions [data-action="edithistory"]').first().click();
            await gaps(page, '.history-list > li:first-child > *', 12, 'expanded history editor');
            await fits(page, 'history');
            await page.locator('[data-key="history-back"]').click();
            await page.locator('[data-action="new"]').click();
            await gaps(page, '.edit > *', 12, 'exercise editor sections');
            await cardPadding(page, '.edit', padding);
            await fits(page, 'editor');
            await page.getByRole('button', { name: 'Lisää liike', exact: true }).click();
            await gaps(page, '.library-filters > *', 12, 'library filters');
            await cardPadding(page, '.library-filters, .custom-exercise', padding);
            await fits(page, 'library');
            await page.locator('[data-action="backedit"]').click();
            await page.locator('[data-key="cancel"]').click();
            await page.getByRole('button', { name: 'Tilastot', exact: true }).click();
            await gaps(page, '.statistics-content > *', 16, 'statistics sections');
            await cardPadding(page, '.stat-filters, .stat-metric', padding);
            await fits(page, 'statistics');
            await page.locator('[data-key="statistics-back"]').click();
            assert.equal(await page.evaluate(() => localStorage.getItem('gym-tracker-v1')), raw, 'layout and navigation preserve saved data byte-for-byte');
            await tap(page.locator('.quick-start').first());
            await page.locator('.session-end').waitFor();
            await gaps(page, '#app > :not(.sr-only):not(.sr)', 16, 'workout sections');
            await gaps(page, '.session-end > *', 12, 'workout end actions');
            await fits(page, 'workout');
          } finally {
            await context.close();
          }
        });
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
