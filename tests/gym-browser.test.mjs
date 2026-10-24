import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, webkit, devices, AxeBuilder, startServer, tap } from './support.mjs';
import * as core from '../core.js';
import { GYM_PROGRAMS } from '../gym-programs.js';

const { server, url } = await startServer();
try {
  for (const [name, engine, device] of [['chromium', chromium, 'Pixel 7'], ['webkit', webkit, 'iPhone 14']]) {
    await test(`${name}: corrected gym templates can be selected, saved and started without rewriting existing data`, { timeout: 120000 }, async () => {
      const browser = await engine.launch();
      try {
        const context = await browser.newContext({ ...devices[device], serviceWorkers: 'block', reducedMotion: 'reduce' });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(url);
        const original = core.defaultState();
        const previous = core.startSession(original.routines[0], 1000);
        previous.exercises[0].sets[0].done = true;
        original.history = [core.summarize(previous, 2000)];
        await page.evaluate((state) => localStorage.setItem('gym-tracker-v1', JSON.stringify(state)), original);
        await page.reload();
        for (const program of GYM_PROGRAMS) {
          await tap(page.locator('[data-action="new"]'));
          await tap(page.locator('[data-action="newgymprogram"]'));
          assert.equal(await page.locator('[data-action="usegymprogram"]').count(), 7);
          if (program.id === 'fullbody-a') {
            assert.match(await page.locator('.gallery-controls').innerText(), /2–3 toistoa varalle/);
            const report = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
            assert.deepEqual(report.violations, []);
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          }
          await tap(page.locator(`[data-program="${program.id}"]`));
          assert.equal(await page.locator('[data-f="rname"]').inputValue(), program.name);
          assert.equal(await page.locator('[data-f="name"]').count(), program.exercises.length);
          await tap(page.locator('[data-action="save"]'));
          await page.reload();
          const state = await page.evaluate(() => JSON.parse(localStorage.getItem('gym-tracker-v1')));
          const added = state.routines.find((r) => r.name === program.name && !original.routines.some((old) => old.id === r.id));
          assert.deepEqual(added.exercises.map(({ name, sets, reps, weight }) => ({ name, sets, reps, weight })),
            program.exercises.map((e) => ({ ...e, weight: '' })));
          for (const routine of original.routines) {
            assert.deepEqual(state.routines.find((r) => r.id === routine.id), routine);
          }
          assert.deepEqual(state.history, original.history);
        }
        const state = await page.evaluate(() => JSON.parse(localStorage.getItem('gym-tracker-v1')));
        const routine = state.routines.find((r) => r.name === 'Core' && !original.routines.some((old) => old.id === r.id));
        await tap(page.locator(`[data-action="start"][data-mode="normal"][data-id="${routine.id}"], [data-action="start"]:not([data-mode])[data-id="${routine.id}"]`).first());
        const active = await page.evaluate(() => JSON.parse(localStorage.getItem('gym-tracker-v1')).session);
        assert.equal(active.exercises.reduce((n, e) => n + e.sets.length, 0), 8);
        assert.equal(active.exercises[0].reps, '20 s');
        assert.deepEqual(errors, []);
        await context.close();
      } finally {
        await browser.close();
      }
    });
  }
} finally {
  server.kill();
}
