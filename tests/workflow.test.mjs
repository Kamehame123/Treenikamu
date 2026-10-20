import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../core.js';
import { chromium, webkit, devices, AxeBuilder, startServer, tap } from './support.mjs';

const { server, url } = await startServer();
const button = (page, name) => page.getByRole('button', { name, exact: true });
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('gym-tracker-v1')));

// Synthetic fixtures stay in isolated browser contexts, never the live preview.
async function seedWorkout(page, { current = 0, almostDone = false, tall = false, autoRest = true } = {}) {
  const state = core.defaultState();
  state.settings.autoRest = autoRest;
  state.session = core.startSession(state.routines[0]);
  state.session.exercises.forEach((exercise, i) => {
    if (i < current) exercise.sets.forEach((set) => { set.done = true; });
  });
  if (almostDone) state.session.exercises[current].sets.slice(0, -1).forEach((set) => { set.done = true; });
  if (tall) state.session.exercises[current].sets = Array.from({ length: 20 }, (_, i) => ({ done: i < 18 }));
  if (current && autoRest) state.restEnd = Date.now() + 90000;
  await page.goto(url);
  await page.evaluate((value) => localStorage.setItem('gym-tracker-v1', JSON.stringify(value)), state);
  await page.reload();
  await page.locator('.ex.current').waitFor();
  await page.evaluate(() => { window.scrollCalls = []; });
  return state;
}

async function centered(page, selector) {
  await page.waitForFunction((selector) => {
    const element = document.querySelector(selector);
    const rect = element.getBoundingClientRect();
    const viewport = window.visualViewport;
    const top = (viewport?.offsetTop ?? 0) + document.querySelector('.session-header').getBoundingClientRect().height + 12;
    const rest = document.getElementById('rest');
    const viewportBottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight);
    const bottom = Math.min(viewportBottom, rest.hidden ? viewportBottom : rest.getBoundingClientRect().top) - 12;
    return rect.top >= top - 2 && rect.bottom <= bottom + 2 && Math.abs((rect.top + rect.bottom) / 2 - (top + bottom) / 2) < 3;
  }, selector);
}

async function openLibrary(page) {
  await page.goto(url);
  await tap(button(page, 'Uusi harjoitus'));
  await page.locator('[data-f="rname"]').fill('Testiohjelma');
  await tap(button(page, 'Lisää liike'));
}

async function selectFilter(page, id, value) {
  await page.locator(`#${id} > summary`).click();
  await page.locator(`#${id} input[value="${value}"]`).check();
}

try {
  for (const [name, engine, device] of [['chromium', chromium, 'Pixel 7'], ['webkit', webkit, 'iPhone 14']]) {
    const browser = await engine.launch();
    try {
      await test(`${name}: faster mobile workflows`, async (t) => {
        const run = async (title, work, options = {}) => t.test(title, { timeout: 30000 }, async () => {
          const context = await browser.newContext({ ...devices[device], reducedMotion: 'reduce', serviceWorkers: 'block', ...options });
          const page = await context.newPage(); page.setDefaultTimeout(5000);
          const errors = [];
          page.on('pageerror', (error) => errors.push(error.message));
          page.on('console', (message) => { if (/Content Security Policy|violates.*directive/.test(message.text())) errors.push(message.text()); });
          await page.addInitScript(() => {
            const scrollTo = window.scrollTo.bind(window);
            window.scrollCalls = [];
            window.scrollTo = (...args) => {
              if (typeof args[0] === 'object') window.scrollCalls.push(args[0]);
              return scrollTo(...args);
            };
          });
          try { await work(page); assert.deepEqual(errors, []); } finally { await context.close(); }
        });

        await run('resume and reload center the current exercise without losing the session', async (p) => {
          const state = await seedWorkout(p, { current: 3 });
          await centered(p, '#exercise-3');
          await tap(button(p, 'Takaisin harjoituksiin'));
          assert.equal((await saved(p)).session.id, state.session.id);
          await tap(button(p, 'Jatka harjoitusta'));
          await centered(p, '#exercise-3');
          assert.equal(await p.locator('.set.next').evaluate((e) => e === document.activeElement), true);
          assert.equal(await p.evaluate(() => window.scrollCalls.at(-1).behavior), 'instant');
          await p.reload();
          await centered(p, '#exercise-3');
          assert.equal((await saved(p)).session.exercises[0].sets.every((s) => s.done), true);
        });

        await run('jump uses smooth centering when reduced motion is not requested', async (p) => {
          await seedWorkout(p, { current: 2 });
          await p.evaluate(() => window.scrollTo(0, 0));
          await tap(p.locator('[data-action="jump"]'));
          await centered(p, '#exercise-2');
          assert.equal(await p.evaluate(() => window.scrollCalls.at(-1).behavior), 'smooth');
        }, { reducedMotion: 'no-preference' });

        await run('only finishing the current exercise advances; keyboard focus stays available for undo', async (p) => {
          await p.clock.install();
          await seedWorkout(p, { almostDone: true });
          await p.locator('[data-key="s0-2"]').focus();
          await p.keyboard.press('Space');
          await p.waitForFunction(() => document.getElementById('app').getAttribute('aria-busy') === 'false');
          await p.clock.runFor(400);
          await centered(p, '#exercise-1');
          assert.equal(await p.locator('[data-key="s0-2"]').evaluate((e) => e === document.activeElement), true);
          assert.equal(await p.evaluate(() => window.scrollCalls.length), 1);
          assert.ok(await p.locator('#rest').isVisible());
        });

        await run('ordinary sets, out-of-order completion, and undo do not auto-scroll', async (p) => {
          await p.clock.install();
          await seedWorkout(p, { autoRest: false });
          await tap(p.locator('[data-key="s0-0"]'));
          for (let i = 0; i < 3; i++) await tap(p.locator(`[data-key="s2-${i}"]`));
          await p.clock.runFor(400);
          await tap(p.locator('[data-key="s2-2"]'));
          await p.clock.runFor(400);
          assert.equal(await p.evaluate(() => window.scrollCalls.length), 0);
          assert.equal(await p.locator('.ex.current').getAttribute('id'), 'exercise-0');
        });

        await run('an immediate undo or a manual gesture cancels scheduled advancement', async (p) => {
          await p.clock.install();
          await seedWorkout(p, { almostDone: true });
          await tap(p.locator('[data-key="s0-2"]'));
          await tap(p.locator('[data-key="s0-2"]'));
          await p.clock.runFor(400);
          assert.equal(await p.evaluate(() => window.scrollCalls.length), 0);
          await tap(p.locator('[data-key="s0-2"]'));
          await p.evaluate(() => document.dispatchEvent(new Event('touchstart')));
          await p.clock.runFor(400);
          assert.equal(await p.evaluate(() => window.scrollCalls.length), 0);
        });

        await run('queued taps cancel an earlier advancement', async (p) => {
          await p.clock.install();
          await seedWorkout(p, { almostDone: true });
          await p.evaluate(() => {
            document.querySelector('[data-key="s0-2"]').click();
            document.querySelector('[data-key="s1-0"]').click();
          });
          await p.waitForFunction(() => document.getElementById('app').getAttribute('aria-busy') === 'false');
          await p.clock.runFor(400);
          assert.equal(await p.evaluate(() => window.scrollCalls.length), 0);
        });

        await run('large exercises center the next set on narrow and landscape screens', async (p) => {
          for (const viewport of [{ width: 320, height: 640 }, { width: 844, height: 390 }]) {
            await p.setViewportSize(viewport);
            await seedWorkout(p, { current: 2, tall: true });
            await centered(p, '[data-key="s2-18"]');
            const rect = await p.locator('[data-key="s2-18"]').boundingBox();
            assert.equal(await p.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.set')?.dataset.key, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }), 's2-18');
          }
        });

        await run('storage warnings are not scrolled offscreen after a failed save', async (p) => {
          await p.clock.install();
          await seedWorkout(p, { almostDone: true });
          await p.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('quota'); }; });
          await tap(p.locator('[data-key="s0-2"]'));
          await p.clock.runFor(400);
          assert.equal(await p.evaluate(() => window.scrollCalls.length), 0);
          assert.ok(await p.getByRole('alert').isVisible());
        });

        await run('multi-add keeps search, avoids double additions, fills the blank row, and survives reload', async (p) => {
          await openLibrary(p);
          await tap(button(p, 'Lisää useita peräkkäin'));
          await p.locator('#exercise-search').fill('lankku');
          const choice = p.locator('[data-id="lib-lankku"]');
          await choice.evaluate((e) => { e.click(); e.click(); });
          await p.waitForFunction(() => document.getElementById('app').getAttribute('aria-busy') === 'false');
          assert.equal(await choice.getAttribute('aria-disabled'), 'true');
          assert.equal(await p.locator('#exercise-search').inputValue(), 'lankku');
          assert.match(await p.locator('.library-done').innerText(), /1 lisätty/);
          await p.locator('#exercise-search').fill('bench press');
          await tap(p.locator('[data-id="lib-penkkipunnerrus"]'));
          assert.match(await p.locator('.library-done').innerText(), /2 lisätty/);
          await p.reload();
          assert.deepEqual(await p.locator('[data-f="name"]').evaluateAll((es) => es.map((e) => e.value)), ['Lankku', 'Penkkipunnerrus']);
          assert.equal(await p.locator('[data-f="reps"]').first().inputValue(), '30 s');
          await tap(button(p, 'Tallenna harjoitus'));
          assert.equal((await saved(p)).routines.at(-1).exercises.length, 2);
        });

        await run('reset clears all filters but preserves multi-add choices and custom input', async (p) => {
          await openLibrary(p);
          await tap(button(p, 'Lisää useita peräkkäin'));
          await p.locator('#exercise-search').fill('lankku');
          await tap(p.locator('[data-id="lib-lankku"]'));
          await p.locator('.custom-exercise > summary').click();
          await p.locator('[data-custom="name"]').fill('Säilytä oma luonnos');
          await selectFilter(p, 'library-category', 'Selkä');
          await selectFilter(p, 'library-equipment', 'Talja');
          await p.locator('#library-own').check();
          assert.ok(await p.locator('#library-empty').isVisible());
          await tap(button(p, 'Tyhjennä haku ja suodattimet'));
          assert.equal(await p.locator('#exercise-search').inputValue(), '');
          assert.equal(await p.locator('#exercise-search').evaluate((e) => e === document.activeElement), true);
          assert.equal(await p.locator('#library-category-value').innerText(), 'Kaikki lihasryhmät');
          assert.equal(await p.locator('#library-equipment-value').innerText(), 'Kaikki välineet');
          assert.equal(await p.locator('#library-own').isChecked(), false);
          assert.equal(await p.locator('.exercise-choice').count(), 40);
          assert.equal(await p.locator('[data-custom="name"]').inputValue(), 'Säilytä oma luonnos');
          assert.match(await p.locator('.library-done').innerText(), /1 lisätty/);
          await tap(button(p, 'Valmis · takaisin harjoitukseen'));
          assert.equal(await p.locator('[data-f="name"]').inputValue(), 'Lankku');
        });

        await run('replacement stays single-choice and multi-add respects the 60-exercise limit', async (p) => {
          const state = core.defaultState();
          state.routines[0].exercises = Array.from({ length: 59 }, (_, i) => ({ id: `fixture-${i}`, name: `Testiliike ${i}`, sets: 3, reps: '7', weight: '25 kg' }));
          await p.goto(url);
          await p.evaluate((value) => localStorage.setItem('gym-tracker-v1', JSON.stringify(value)), state);
          await p.reload();
          await tap(button(p, 'Muokkaa: Koko keho A'));
          await tap(button(p, 'Valitse kirjastosta').first());
          assert.equal(await p.locator('[data-action="multiex"]').count(), 0);
          await p.locator('#exercise-search').fill('lankku');
          await tap(p.locator('[data-id="lib-lankku"]'));
          assert.equal(await p.locator('[data-f="reps"]').first().inputValue(), '7');
          assert.equal(await p.locator('[data-f="weight"]').first().inputValue(), '25 kg');
          await tap(button(p, 'Lisää liike'));
          await tap(button(p, 'Lisää useita peräkkäin'));
          await p.locator('#exercise-search').fill('lankku');
          await tap(p.locator('[data-id="lib-lankku"]'));
          await p.locator('#exercise-search').fill('bench press');
          await tap(p.locator('[data-id="lib-penkkipunnerrus"]'));
          assert.match(await p.locator('.library-done').innerText(), /1 lisätty/);
          await tap(button(p, 'Valmis · takaisin harjoitukseen'));
          assert.equal(await p.locator('[data-f="name"]').count(), 60);
          assert.ok(await button(p, 'Lisää liike').isDisabled());
        });

        await run('own exercises work in multi-add and draft storage failures remain visible', async (p) => {
          await openLibrary(p);
          await tap(button(p, 'Lisää useita peräkkäin'));
          await p.locator('.custom-exercise > summary').click();
          await p.locator('[data-custom="name"]').fill('Oma testiliike');
          await tap(button(p, 'Tallenna ja lisää harjoitukseen'));
          assert.match(await p.locator('.library-done').innerText(), /1 lisätty/);
          assert.equal(await p.evaluate(() => !!document.activeElement.closest('.exercise-choice, .library-done')), true);
          assert.equal((await saved(p)).customExercises.length, 1);
          await p.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('quota'); }; });
          await p.locator('#exercise-search').fill('lankku');
          await tap(p.locator('[data-id="lib-lankku"]'));
          assert.match(await p.locator('.library-done').innerText(), /Luonnos ei tallentunut/);
          await tap(button(p, 'Valmis · takaisin harjoitukseen'));
          assert.equal(await p.locator('[data-f="name"]').count(), 2);
        });

        await run('multi-add, filter reset and draft recovery work fully offline', async (p) => {
          await p.goto(url);
          await p.evaluate(() => navigator.serviceWorker.ready);
          await p.reload();
          await p.context().setOffline(true);
          await openLibrary(p);
          await tap(button(p, 'Lisää useita peräkkäin'));
          await p.locator('#exercise-search').fill('lankku');
          await tap(p.locator('[data-id="lib-lankku"]'));
          await tap(button(p, 'Tyhjennä haku ja suodattimet'));
          await p.locator('#exercise-search').fill('bench press');
          await tap(p.locator('[data-id="lib-penkkipunnerrus"]'));
          await p.reload();
          assert.equal(await p.locator('[data-f="name"]').count(), 2);
          await tap(button(p, 'Tallenna harjoitus'));
          assert.equal((await saved(p)).routines.at(-1).exercises.length, 2);
        }, { serviceWorkers: 'allow' });

        await run('new controls meet accessibility, touch-size and overflow checks', async (p) => {
          await openLibrary(p);
          await tap(button(p, 'Lisää useita peräkkäin'));
          await p.locator('#exercise-search').fill('lankku');
          await tap(p.locator('[data-id="lib-lankku"]'));
          for (const colorScheme of ['dark', 'light']) {
            await p.emulateMedia({ colorScheme });
            for (const viewport of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
              await p.setViewportSize(viewport);
              const violations = (await new AxeBuilder({ page: p }).analyze()).violations;
              assert.deepEqual(violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })), []);
              assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
              assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('button, input, summary')].filter((e) => {
                const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 47.9 || r.height < 47.9);
              }).map((e) => e.outerHTML.slice(0, 100))), []);
              const rect = await p.locator('[data-key="library-done"]').boundingBox();
              assert.ok(rect.y >= 0 && rect.y + rect.height <= viewport.height);
            }
          }
        }, { bypassCSP: true });
      });
    } finally { await browser.close(); }
  }
} finally { server.kill(); }