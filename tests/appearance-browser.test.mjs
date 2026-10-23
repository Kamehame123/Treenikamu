import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../core.js';
import { chromium, webkit, devices, AxeBuilder, startServer, openSettings, expandRoutines } from './support.mjs';
import { configuredState } from './statistics-fixtures.mjs';
import { buildTimer } from '../timer.js';

const { server, url } = await startServer();
const KEY = 'gym-tracker-appearance-v1';
const raw = (page) => page.evaluate(() => localStorage.getItem('gym-tracker-v1'));
const theme = (page) => page.evaluate(() => document.documentElement.dataset.theme);

async function seed(browserContext, { appearance = null, state = configuredState(Date.now()), ready = '.routine' } = {}) {
  const page = await browserContext.newPage();
  await page.goto(url);
  await page.evaluate(([s, a, key]) => {
    localStorage.setItem('gym-tracker-v1', JSON.stringify(s));
    if (a) localStorage.setItem(key, a); else localStorage.removeItem(key);
  }, [state, appearance, KEY]);
  await page.reload();
  await page.locator(ready).first().waitFor();
  return page;
}

try {
  for (const [name, engine, device] of [['chromium', chromium, 'Pixel 7'], ['webkit', webkit, 'iPhone 14']]) {
    const browser = await engine.launch();
    try {
      await test(`${name}: appearance`, async (t) => {
        const run = (title, work, options = {}) => t.test(title, { timeout: 60000 }, async () => {
          const context = await browser.newContext({ ...devices[device], ...options });
          try { await work(context); } finally { await context.close(); }
        });

        await run('Dark mode is the default even when the operating system prefers light', async (context) => {
          const page = await seed(context);
          assert.equal(await theme(page), 'dark');
          assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(13, 17, 16)');
          assert.equal(await page.locator('meta[name="theme-color"]').getAttribute('content'), '#101313');
          assert.equal(await page.evaluate(() => localStorage.getItem('gym-tracker-appearance-v1')), null);
        }, { colorScheme: 'light' });

        await run('the choice sits first in Settings, switches in place, persists and never touches the training data', async (context) => {
          const page = await seed(context);
          await openSettings(page);
          const radios = page.locator('input[name="appearance"]');
          assert.deepEqual(await radios.evaluateAll((list) => list.map((r) => [r.value, r.checked])), [['dark', true], ['aurora', false]]);
          assert.equal(await page.locator('.settings-body > :first-child').evaluate((el) => el.classList.contains('appearance')), true);
          const before = await raw(page);
          await page.evaluate(() => { window.__marker = document.getElementById('app').firstElementChild; });
          await page.locator('.appearance-option', { hasText: 'Aurora' }).click();
          assert.equal(await theme(page), 'aurora');
          assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(247, 246, 252)');
          assert.equal(await page.locator('meta[name="theme-color"]').getAttribute('content'), '#f7f6fc');
          assert.equal(await raw(page), before, 'training data is byte-for-byte unchanged');
          assert.equal(await page.evaluate(() => window.__marker === document.getElementById('app').firstElementChild), true, 'the screen was not rebuilt');
          assert.equal(await radios.nth(1).isChecked(), true);
          await page.reload();
          assert.equal(await theme(page), 'aurora');
          await openSettings(page);
          assert.equal(await page.locator('input[name="appearance"][value="aurora"]').isChecked(), true);
          await page.locator('.appearance-option', { hasText: 'Dark mode' }).click();
          assert.equal(await theme(page), 'dark');
          assert.equal(await raw(page), before);
        });

        await run('the theme is applied before the app script runs, so reload never flashes the wrong look', async (context) => {
          const page = await seed(context, { appearance: 'aurora' });
          await page.addInitScript(() => {
            document.addEventListener('DOMContentLoaded', () => { window.__early = document.documentElement.dataset.theme; });
          });
          await page.reload();
          await page.locator('.routine').first().waitFor();
          assert.equal(await page.evaluate(() => window.__early), 'aurora');
        });

        await run('an unusable stored value falls back to Dark and is not overwritten', async (context) => {
          const page = await seed(context, { appearance: 'neon' });
          assert.equal(await theme(page), 'dark');
          assert.equal(await page.evaluate(() => localStorage.getItem('gym-tracker-appearance-v1')), 'neon');
        });

        await run('another tab changing the look is picked up without re-rendering or changing data', async (context) => {
          const page = await seed(context);
          const other = await context.newPage();
          await other.goto(url);
          const before = await raw(page);
          await page.evaluate(() => { window.__marker = document.getElementById('app').firstElementChild; });
          await other.evaluate(() => window.TrackerAppearance.set('aurora'));
          await page.waitForFunction(() => document.documentElement.dataset.theme === 'aurora');
          assert.equal(await page.evaluate(() => window.__marker === document.getElementById('app').firstElementChild), true);
          assert.equal(await raw(page), before);
        });

        await run('a failed save keeps the choice in the tab and says so', async (context) => {
          const page = await seed(context);
          await openSettings(page);
          await page.evaluate(() => {
            const original = Storage.prototype.setItem;
            Storage.prototype.setItem = function (k, v) { if (k === 'gym-tracker-appearance-v1') throw new Error('quota'); return original.call(this, k, v); };
          });
          await page.locator('.appearance-option', { hasText: 'Aurora' }).click();
          assert.equal(await theme(page), 'aurora');
          assert.match(await page.locator('#appearance-status').innerText(), /ei voitu tallentaa/);
        });

        await run('Aurora passes accessibility, contrast, touch-size and overflow checks on every main view', async (context) => {
          const seeded = configuredState(Date.now());
          seeded.timers = [buildTimer({ id: null, name: 'Sarja 1', repeats: '2', intervals: [{ id: 'a', label: 'Juoksu', min: '1', sec: '' }, { id: 'b', label: 'Kävely', min: '', sec: '30' }] }, []).timer];
          const page = await seed(context, { appearance: 'aurora', state: seeded });
          const check = async (label) => {
            await page.waitForTimeout(350);
            const violations = (await new AxeBuilder({ page }).analyze()).violations;
            assert.deepEqual(violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })), [], label);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${label}: no horizontal overflow`);
          };
          await expandRoutines(page);
          await openSettings(page);
          await check('home');
          for (const action of ['showhistory', 'timer', 'records']) {
            await page.evaluate(() => document.querySelector('[data-action="home"]')?.click());
            await page.locator(`[data-action="${action}"]`).first().click();
            await check(action);
          }
          await page.evaluate(() => document.querySelector('[data-action="home"]')?.click());
          const state = core.defaultState();
          state.settings.autoRest = true;
          state.session = core.startSession(state.routines[0]);
          state.session.exercises[0].sets.forEach((set) => { set.done = true; });
          state.restEnd = Date.now() + 90000;
          await page.evaluate((s) => localStorage.setItem('gym-tracker-v1', JSON.stringify(s)), state);
          await page.reload();
          await page.locator('.ex').first().waitFor();
          await check('workout');
          assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('button, input, summary')].filter((e) => {
            const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest('.appearance-option') && (r.width < 47.9 || r.height < 47.9);
          }).map((e) => e.outerHTML.slice(0, 100))), []);
        }, { bypassCSP: true });

        await run('reduced motion removes every Aurora animation and transition', async (context) => {
          const page = await seed(context, { appearance: 'aurora' });
          assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#app *')].filter((e) => {
            const s = getComputedStyle(e); return (s.animationName !== 'none' && s.animationDuration !== '0s') || (s.transitionDuration !== '0s' && s.transitionDuration !== '');
          }).map((e) => e.className).slice(0, 5)), []);
        }, { reducedMotion: 'reduce' });

        await run('the strict policy still blocks inline styles and scripts with Aurora on', async (context) => {
          const page = await seed(context, { appearance: 'aurora' });
          const reports = [];
          page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) reports.push(m.text()); });
          await openSettings(page);
          await page.locator('.appearance-option', { hasText: 'Dark mode' }).click();
          await page.locator('.appearance-option', { hasText: 'Aurora' }).click();
          assert.deepEqual(reports, []);
          assert.equal(await page.evaluate(() => document.querySelectorAll('[style]').length), 0);
        });

        await run('Dark mode renders the finished-set rail color exactly as before', async (context) => {
          const state = core.defaultState();
          state.settings.autoRest = false;
          state.session = core.startSession(state.routines[0]);
          state.session.exercises[0].sets.forEach((set) => { set.done = true; });
          const page = await seed(context, { state, ready: '.ex' });
          const colors = await page.locator('.track-box.done').first().evaluate((b) => { const s = getComputedStyle(b); return [s.backgroundColor, s.color]; });
          assert.deepEqual(colors, ['rgb(168, 240, 156)', 'rgb(0, 0, 0)']);
        }, { colorScheme: 'light' });
      });
    } finally { await browser.close(); }
  }
} finally { server.kill(); }
