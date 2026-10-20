import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as core from '../core.js';
import { chromium, webkit, devices, AxeBuilder, startServer, tap } from './support.mjs';

const { server, url } = await startServer();
const button = (page, name) => page.getByRole('button', { name, exact: true });
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('gym-tracker-v1')));

// Synthetic fixtures stay in isolated browser contexts, never the live preview.
async function seedWorkout(page, { current = 0, almostDone = false, tall = false, autoRest = true, setReps = null, weight = '' } = {}) {
  const state = core.defaultState();
  state.settings.autoRest = autoRest;
  state.routines[0].exercises[0].setReps = setReps;
  state.routines[0].exercises[0].weight = weight;
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
          await p.clock.pauseAt(new Date(Date.now() + 1000));
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

        await run('quick +/- reps stay separate from targets and persist through completion and export', async (p) => {
          const state = await seedWorkout(p, { setReps: ['5', '8', '12'], weight: '25 kg' });
          const minus = (si) => p.locator(`[data-key="reps-minus-0-${si}"]`);
          const plus = (si) => p.locator(`[data-key="reps-plus-0-${si}"]`);
          await tap(minus(0));
          await tap(plus(1));
          assert.equal(await p.locator('[data-key="s0-0"] .set-value').innerText(), '4 x 25kg');
          assert.equal(await p.locator('[data-key="s0-0"] .set-planned').innerText(), 'Tavoite: 5 x 25kg');
          let after = await saved(p);
          assert.deepEqual(after.routines, state.routines);
          assert.deepEqual(after.session.exercises[0].sets.map((s) => s.actualReps), ['4', '9', undefined]);
          assert.equal(core.progress(after.session).done, 0);
          assert.equal(after.restEnd, null);
          await tap(p.locator('[data-key="s0-0"]'));
          const restEnd = (await saved(p)).restEnd;
          await tap(minus(0));
          after = await saved(p);
          assert.equal(after.session.exercises[0].sets[0].done, true);
          assert.equal(after.restEnd, restEnd);
          assert.equal(await p.locator('[data-key="s0-0"] .set-value').innerText(), '3 x 25kg');
          await p.reload();
          assert.equal(await p.locator('[data-key="s0-0"] .set-value').innerText(), '3 x 25kg');
          await p.locator('.exercise-log summary').first().click();
          assert.equal(await p.locator('[data-log="actualReps"][data-e="0"][data-s="0"]').inputValue(), '3');
          p.once('dialog', (dialog) => dialog.accept());
          await tap(button(p, 'Lopeta kesken'));
          after = await saved(p);
          assert.equal(after.history[0].exercises[0].sets[0].actualReps, '3');
          assert.equal(after.history[0].exercises[0].sets[1].actualReps, '9');
          assert.deepEqual(after.routines, state.routines);
          const download = p.waitForEvent('download');
          await tap(button(p, 'Vie varmuuskopio'));
          const parsed = core.parseBackup(await readFile(await (await download).path(), 'utf8'));
          assert.equal(parsed.ok, true);
          assert.deepEqual(parsed.state.history, after.history);
        });

        await run('rep controls respect bounds, ranges, direct logs, keyboard input and timed sets', async (p) => {
          await seedWorkout(p, { setReps: ['1', '8–12', '45 s'], autoRest: false });
          const minus = p.locator('[data-key="reps-minus-0-0"]');
          const plus = p.locator('[data-key="reps-plus-0-0"]');
          await tap(minus);
          assert.equal(await minus.isDisabled(), true);
          assert.equal(await p.locator('[data-key="s0-0"] .set-value').innerText(), '0 toistoa');
          await tap(p.locator('[data-key="reps-minus-0-1"]'));
          assert.equal((await saved(p)).session.exercises[0].sets[1].actualReps, '11');
          assert.equal(await p.locator('#exercise-0 .set-entry').nth(2).locator('.rep-adjust').count(), 0);
          assert.equal(await p.locator('#exercise-4 .rep-adjust').count(), 0);
          assert.equal(await p.locator('[data-key="s0-2"] .set-value').innerText(), '45 s');
          await p.locator('.exercise-log summary').first().click();
          const direct = p.locator('[data-log="actualReps"][data-e="0"][data-s="0"]');
          await direct.fill('100');
          await p.waitForFunction(() => document.getElementById('app').getAttribute('aria-busy') === 'false');
          assert.equal(await plus.isDisabled(), true);
          await tap(minus);
          assert.equal(await direct.inputValue(), '99');
          await direct.fill('');
          await p.waitForFunction(() => document.getElementById('app').getAttribute('aria-busy') === 'false');
          assert.equal(await p.locator('[data-key="s0-0"] .set-value').innerText(), '1 toistoa');
          await plus.focus(); await p.keyboard.press('Space');
          await p.waitForFunction(() => document.getElementById('app').getAttribute('aria-busy') === 'false');
          assert.equal(await plus.evaluate((e) => e === document.activeElement), true);
          assert.equal(await direct.inputValue(), '2');
          await p.evaluate(() => {
            const plus = document.querySelector('[data-key="reps-plus-0-0"]');
            for (let i = 0; i < 5; i++) plus.click();
          });
          await p.waitForFunction(() => document.getElementById('app').getAttribute('aria-busy') === 'false');
          assert.equal((await saved(p)).session.exercises[0].sets[0].actualReps, '7');
          assert.equal((await saved(p)).session.exercises[0].sets[0].done, false);
        });

        await run('failed rep writes keep the original record and expose recoverable pending reps', async (p) => {
          const state = await seedWorkout(p, { autoRest: false });
          await p.evaluate(() => {
            window.originalSetItem = Storage.prototype.setItem;
            Storage.prototype.setItem = () => { throw new Error('quota'); };
          });
          await tap(p.locator('[data-key="reps-minus-0-0"]'));
          assert.ok(await p.getByRole('alert').isVisible());
          assert.equal(await p.locator('[data-key="s0-0"] .set-value').innerText(), '4 toistoa');
          assert.deepEqual((await saved(p)).session, state.session);
          await p.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; });
          await tap(button(p, 'Yritä tallentaa uudelleen'));
          await p.reload();
          assert.equal((await saved(p)).session.exercises[0].sets[0].actualReps, '4');
          assert.equal((await saved(p)).session.exercises[0].sets[0].done, false);
        });

        await run('per-set targets survive planning, set-count edits, reload, tracking and export', async (p) => {
          await p.goto(url);
          await tap(button(p, 'Uusi harjoitus'));
          await p.locator('[data-f="rname"]').fill('Sarjakohtainen treeni');
          await p.locator('[data-f="name"]').fill('Kyykky');
          await p.locator('[data-f="reps"]').fill('5');
          await p.locator('[data-f="weight"]').fill('25');
          await p.locator('[data-f="individualReps"]').check();
          const targets = () => p.locator('[data-f="setReps"]');
          assert.deepEqual(await targets().evaluateAll((es) => es.map((e) => e.value)), ['5', '5', '5']);
          await targets().nth(1).fill('');
          await tap(button(p, 'Tallenna harjoitus'));
          assert.match(await p.locator('#err').innerText(), /sarja 2/);
          await targets().nth(1).fill('8');
          await targets().nth(2).fill('12');
          const count = p.locator('[data-f="sets"]');
          for (const value of ['4', '2', '4']) {
            await count.fill(value); await count.press('Tab');
            assert.equal(await targets().count(), Number(value));
          }
          assert.deepEqual(await targets().evaluateAll((es) => es.map((e) => e.value)), ['5', '8', '12', '5']);
          await count.fill('3'); await count.press('Tab');
          await p.reload();
          assert.equal(await p.locator('[data-f="individualReps"]').isChecked(), true);
          assert.deepEqual(await targets().evaluateAll((es) => es.map((e) => e.value)), ['5', '8', '12']);
          await tap(button(p, 'Tallenna harjoitus'));
          assert.deepEqual((await saved(p)).routines.at(-1).exercises[0].setReps, ['5', '8', '12']);
          assert.match(await p.locator('.routine').last().innerText(), /5 \/ 8 \/ 12/);
          await tap(p.locator('.routine').last().getByRole('button', { name: 'Aloita harjoitus', exact: true }));
          assert.deepEqual(await p.locator('.set-value').allTextContents(), ['5 x 25kg', '8 x 25kg', '12 x 25kg']);
          assert.match(await p.locator('[data-key="s0-1"]').getAttribute('aria-label'), /8 x 25kg/);
          await p.locator('[data-key="s0-0"]').focus(); await p.keyboard.press('Space');
          await p.waitForFunction(() => document.getElementById('app').getAttribute('aria-busy') === 'false');
          assert.equal(await p.locator('[data-key="s0-0"]').getAttribute('aria-pressed'), 'true');
          assert.equal(await p.locator('[data-key="s0-0"] .set-value').innerText(), '5 x 25kg');
          await tap(button(p, 'Lisää sarja: Kyykky'));
          assert.equal(await p.locator('.set-value').last().innerText(), '12 x 25kg');
          await tap(button(p, 'Poista sarja: Kyykky'));
          await p.reload();
          assert.deepEqual(await p.locator('.set-value').allTextContents(), ['5 x 25kg', '8 x 25kg', '12 x 25kg']);
          assert.equal((await saved(p)).session.exercises[0].sets[0].done, true);
          await tap(button(p, 'Takaisin harjoituksiin'));
          await tap(button(p, 'Muokkaa: Sarjakohtainen treeni'));
          assert.deepEqual(await targets().evaluateAll((es) => es.map((e) => e.value)), ['5', '8', '12']);
          await tap(button(p, 'Peruuta'));
          const download = p.waitForEvent('download');
          await tap(button(p, 'Vie varmuuskopio'));
          const parsed = core.parseBackup(await readFile(await (await download).path(), 'utf8'));
          assert.equal(parsed.ok, true);
          assert.deepEqual(parsed.state.routines.at(-1).exercises[0].setReps, ['5', '8', '12']);
          assert.deepEqual(parsed.state.session, (await saved(p)).session);
        });

        await run('per-set mode is movement-specific and turning it off restores the shared target', async (p) => {
          await p.goto(url);
          await tap(button(p, 'Muokkaa: Koko keho A'));
          const toggles = p.locator('[data-f="individualReps"]');
          await toggles.first().check();
          await p.locator('[data-f="setReps"]').first().fill('15');
          assert.equal(await toggles.nth(1).isChecked(), false);
          await tap(button(p, 'Siirrä alas').first());
          assert.equal(await toggles.nth(1).isChecked(), true);
          assert.equal(await p.locator('[data-f="setReps"]').first().inputValue(), '15');
          await tap(button(p, 'Valitse kirjastosta').nth(1));
          await p.locator('#exercise-search').fill('front squat');
          await tap(p.locator('[data-id="lib-etukyykky"]'));
          assert.equal(await p.locator('[data-f="setReps"]').first().inputValue(), '15');
          await toggles.nth(1).uncheck();
          assert.equal(await p.locator('[data-f="setReps"]').count(), 0);
          await tap(button(p, 'Tallenna harjoitus'));
          assert.equal((await saved(p)).routines[0].exercises[1].setReps, null);
          await tap(button(p, 'Aloita harjoitus'));
          assert.deepEqual(await p.locator('#exercise-1 .set-value').allTextContents(), ['5 toistoa', '5 toistoa', '5 toistoa']);
        });

        await run('legacy sessions keep progress and display weights, unweighted reps and durations', async (p) => {
          const state = core.defaultState();
          state.history = [{ id: 'old', name: 'Vanha treeni', startedAt: 1000, endedAt: 2000, setsDone: 3, setsTotal: 3 }];
          for (const exercise of state.routines[0].exercises) delete exercise.setReps;
          state.routines[0].exercises[0].weight = '25 kg';
          state.session = core.startSession(state.routines[0], 1000);
          core.toggleSet(state.session, 0, 0);
          await p.goto(url);
          await p.evaluate((value) => localStorage.setItem('gym-tracker-v1', JSON.stringify(value)), state);
          await p.reload();
          assert.equal(await p.locator('[data-key="s0-0"] .set-value').innerText(), '5 x 25kg');
          assert.equal(await p.locator('[data-key="s1-0"] .set-value').innerText(), '5 toistoa');
          assert.equal(await p.locator('[data-key="s4-0"] .set-value').innerText(), '45 s');
          await tap(p.locator('[data-key="s0-1"]'));
          const after = await saved(p);
          assert.deepEqual(after.history, state.history);
          assert.equal(after.session.id, state.session.id);
          assert.deepEqual(after.session.exercises[0].sets.map((s) => s.done), [true, true, false]);
          assert.equal(after.routines[0].exercises[0].setReps, null);
        });

        await run('per-set planning and weighted buttons remain accessible on small screens', async (p) => {
          await p.goto(url);
          await tap(button(p, 'Muokkaa: Koko keho A'));
          await p.locator('[data-f="individualReps"]').first().check();
          await p.locator('[data-f="weight"]').first().fill('25 kg');
          for (const view of ['edit', 'workout']) {
            if (view === 'workout') {
              await tap(button(p, 'Tallenna harjoitus'));
              await tap(button(p, 'Aloita harjoitus'));
              await tap(p.locator('[data-key="s0-0"]'));
              await tap(p.locator('[data-key="reps-minus-0-0"]'));
            }
            for (const colorScheme of ['dark', 'light']) {
              await p.emulateMedia({ colorScheme });
              for (const viewport of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
                await p.setViewportSize(viewport);
                const violations = (await new AxeBuilder({ page: p }).analyze()).violations;
                assert.deepEqual(violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })), []);
                assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
                assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('.per-set-toggle input, .set-targets input, .set, .rep-adjust button')].filter((e) => {
                  const rect = e.getBoundingClientRect();
                  return rect.width < 48 || rect.height < 48;
                }).map((e) => e.outerHTML)), []);
              }
            }
          }
        }, { bypassCSP: true });

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