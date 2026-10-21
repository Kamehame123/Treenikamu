import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../core.js';
import { chromium, webkit, devices, AxeBuilder, startServer, tap, tapConfirm } from './support.mjs';
import { configuredState, workout, baselineHistory, statisticsRoutine, DAY } from './statistics-fixtures.mjs';

const { server, url } = await startServer();
const button = (page, name) => page.getByRole('button', { name, exact: true });
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('gym-tracker-v1')));
const idle = (page) => page.waitForFunction(() => document.getElementById('app').getAttribute('aria-busy') !== 'true');
async function seed(page, state) {
  await page.goto(url);
  await page.evaluate((state) => localStorage.setItem('gym-tracker-v1', JSON.stringify(state)), state);
  await page.reload();
  await page.locator('h1').waitFor();
}
async function openStatistics(page) {
  await tap(button(page, 'Tilastot ja kehitys'));
  await page.getByRole('heading', { name: 'Tilastot', exact: true }).waitFor();
}

try {
  for (const [name, engine, device] of [['chromium', chromium, 'Pixel 7'], ['webkit', webkit, 'iPhone 14']]) {
    const browser = await engine.launch();
    try {
      await test(`${name}: comprehensive local statistics`, async (t) => {
        const run = async (title, work, options = {}) => t.test(title, { timeout: 60000 }, async () => {
          const context = await browser.newContext({ ...devices[device], reducedMotion: 'reduce', serviceWorkers: 'block', ...options });
          const page = await context.newPage();
          page.setDefaultTimeout(8000);
          const errors = [];
          page.on('pageerror', (e) => errors.push(e.message));
          try { await work(page, context); assert.deepEqual(errors, []); }
          finally { await context.close(); }
        });

        await run('empty dashboard is useful, read-only and has explicit custom-date errors', async (page) => {
          await page.goto(url);
          const before = await saved(page);
          await openStatistics(page);
          assert.equal(await page.locator('.index-value').innerText(), '—');
          assert.match(await page.locator('.statistics-content').innerText(), /Ei tallennettuja harjoituksia/);
          assert.doesNotMatch(await page.locator('.statistics-content').innerText(), /NaN|Infinity/);
          assert.deepEqual(await saved(page), before);
          await tap(button(page, 'Oma jakso'));
          await page.locator('[data-stat-date="from"]').fill('');
          await page.locator('[data-stat-date="from"]').press('Tab');
          await page.getByRole('alert').filter({ hasText: 'Valitse kelvollinen' }).waitFor();
          await tap(button(page, '4 viikkoa'));
          assert.equal(await page.getByRole('alert').count(), 0);
          await tap(button(page, 'Harjoituksiin'));
          await page.getByRole('heading', { name: 'Treenipäiväkirja', exact: true }).waitFor();
        });

        await run('exact 110 index, independent filters, accessible charts and narrow light/dark layouts', async (page) => {
          const now = Date.now(), state = configuredState(now - 4 * DAY);
          state.history.push(...[0, 1, 2].map((i) => workout(`progress-${i}`, now - (2 - i) * DAY, [110, 110])));
          await seed(page, state);
          const before = await saved(page);
          await openStatistics(page);
          assert.equal(await page.locator('.index-value').innerText(), '110');
          await tap(button(page, 'Kaikki'));
          const menu = page.locator('.stat-filters .choice-menu').nth(1);
          await menu.locator('summary').click();
          await menu.locator('[data-stat-filter="exerciseKey"]').nth(1).check();
          assert.equal(await page.locator('.index-value').innerText(), '110');
          assert.equal(await page.locator('[data-key="stat-exerciseKey"]').evaluate((e) => e === document.activeElement), true);
          await page.getByRole('heading', { name: /suoritushistoria/ }).waitFor();
          assert.ok(await page.locator('svg[role="img"]').count() >= 2);
          const violations = [];
          await page.setViewportSize({ width: 320, height: 740 });
          for (const colorScheme of ['dark', 'light']) {
            await page.emulateMedia({ colorScheme });
            const result = await new AxeBuilder({ page }).analyze();
            violations.push(...result.violations);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          }
          assert.deepEqual(violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })), []);
          assert.deepEqual(await saved(page), before);
        });

        await run('benchmark setup persists, reloads and never commits a baseline on storage failure', async (page) => {
          const state = core.defaultState();
          state.routines = [statisticsRoutine()]; state.history = baselineHistory(Date.now());
          await seed(page, state); await openStatistics(page);
          await tap(button(page, 'Valitse vertailuliikkeet'));
          const checkboxes = page.locator('input[name="benchmark"]');
          assert.equal(await checkboxes.count(), 2);
          await checkboxes.nth(0).check(); await checkboxes.nth(1).check();
          await page.evaluate(() => {
            window.originalStatisticsSetItem = Storage.prototype.setItem;
            Storage.prototype.setItem = function (key, value) {
              if (key === 'gym-tracker-v1') throw new DOMException('quota', 'QuotaExceededError');
              return window.originalStatisticsSetItem.call(this, key, value);
            };
          });
          await tap(button(page, 'Aloita kehityksen seuranta'));
          assert.equal((await saved(page)).statistics, undefined);
          await page.getByRole('alert').getByText('Tallennus vaatii huomiota', { exact: true }).waitFor();
          await page.evaluate(() => { Storage.prototype.setItem = window.originalStatisticsSetItem; });
          await tap(button(page, 'Valitse vertailuliikkeet'));
          await page.locator('input[name="benchmark"]').nth(0).check();
          await page.locator('input[name="benchmark"]').nth(1).check();
          await tap(button(page, 'Aloita kehityksen seuranta'));
          assert.equal((await saved(page)).statistics.benchmarks.length, 2);
          assert.equal(await page.locator('.index-value').innerText(), '100');
          await page.reload(); await openStatistics(page);
          assert.equal(await page.locator('.index-value').innerText(), '100');
        });

        await run('tracking metadata and optional per-set inputs survive training, reload and completion without rewriting history', async (page) => {
          const state = configuredState(Date.now() - DAY);
          state.settings.autoRest = false;
          state.settings.advancedLogging = true;
          await seed(page, state);
          await tap(button(page, 'Muokkaa: Vertailutreeni'));
          const panel = page.locator('.tracking-editor').first();
          await panel.locator('summary').click();
          await panel.locator('[data-tracking="loadType"][value="per-hand"]').check();
          await panel.locator('[data-tracking="variant"]').fill('Yksi käsipaino, sali A');
          await tap(button(page, 'Tallenna harjoitus'));
          assert.equal((await saved(page)).routines[0].exercises[0].tracking.loadType, 'per-hand');
          await tap(button(page, 'Aloita harjoitus'));
          await tap(page.locator('[data-key="s0-0"]'));
          const log = page.locator('.exercise-log').first();
          await log.locator('summary').click();
          await log.locator('[data-log="actualReps"][data-s="0"]').fill('7'); await idle(page);
          await tap(page.locator('[data-action="setrir"][data-s="0"][data-value="2"]').first()); await idle(page);
          await log.locator('[data-log="kind"][data-s="0"][value="warmup"]').check(); await idle(page);
          let current = await saved(page);
          assert.equal(current.session.exercises[0].sets[0].actualReps, '7');
          assert.equal(current.session.exercises[0].sets[0].setRir, '2');
          assert.equal(current.session.exercises[0].sets[0].kind, 'warmup');
          assert.equal(current.session.exercises[0].tracking.variant, 'Yksi käsipaino, sali A');
          assert.deepEqual(current.history, state.history);
          await page.reload();
          current = await saved(page);
          assert.equal(current.session.exercises[0].sets[0].kind, 'warmup');
          await tapConfirm(button(page, 'Lopeta kesken'));
          current = await saved(page);
          assert.equal(current.session, null);
          assert.equal(current.history[0].exercises[0].tracking.loadType, 'per-hand');
          assert.equal(current.history[0].exercises[0].sets[0].kind, 'warmup');
          assert.deepEqual(current.history.slice(1), state.history);
          await openStatistics(page);
          assert.match(await page.locator('.statistics-content').innerText(), /osittaista/);
        });

        await run('library selection snapshots its canonical identity, category and equipment', async (page) => {
          await page.goto(url);
          await tap(button(page, 'Uusi harjoitus'));
          await page.locator('[data-f="rname"]').fill('Tilastokirjasto');
          await page.getByRole('button', { name: 'Valitse kirjastosta', exact: true }).first().click(); await idle(page);
          await page.locator('#exercise-search').fill('penkkipunnerrus käsipainoilla');
          await page.locator('.exercise-choice').filter({ hasText: 'Penkkipunnerrus käsipainoilla' }).first().click(); await idle(page);
          await tap(button(page, 'Tallenna harjoitus'));
          const exercise = (await saved(page)).routines.find((r) => r.name === 'Tilastokirjasto').exercises[0];
          assert.match(exercise.tracking.sourceId, /^lib-/);
          assert.equal(exercise.tracking.category, 'Rinta');
          assert.equal(exercise.tracking.equipment, 'Käsipainot');
          assert.equal(exercise.tracking.loadType, 'per-hand');
        });

        await run('statistics modules are cached together and usable after an offline relaunch', async (page, context) => {
          await page.goto(url);
          await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20000 });
          await page.evaluate((state) => localStorage.setItem('gym-tracker-v1', JSON.stringify(state)), configuredState(Date.now() - DAY));
          await page.reload();
          const cached = await page.evaluate(async () => {
            const keys = await caches.keys();
            const cache = await caches.open(keys.find((k) => k.startsWith('gym-tracker-v')));
            return (await cache.keys()).map((r) => new URL(r.url).pathname);
          });
          assert.ok(cached.includes('/statistics.js'));
          assert.ok(cached.includes('/statistics-ui.js'));
          await context.setOffline(true);
          await page.reload(); await openStatistics(page);
          assert.equal(await page.locator('.index-value').innerText(), '100');
          await tap(button(page, '4 viikkoa'));
          await page.getByRole('heading', { name: 'Viikoittainen harjoitusmäärä', exact: true }).waitFor();
        }, { serviceWorkers: 'allow' });
      });
    } finally { await browser.close(); }
  }
} finally { server.kill(); }
