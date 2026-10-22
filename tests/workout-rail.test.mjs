import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../core.js';
import { chromium, webkit, devices, AxeBuilder, startServer, tap, expandRoutines } from './support.mjs';

const { server, url } = await startServer();
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('gym-tracker-v1')));

test('detailed logging defaults to off for new and existing data, and only an explicit true enables it', () => {
  assert.equal(core.defaultState().settings.advancedLogging, false);
  const legacy = { v: core.SCHEMA, routines: core.defaultState().routines, settings: { restSeconds: 60, autoRest: false } };
  const loaded = core.sanitizeState(legacy);
  assert.deepEqual(loaded.settings, { restSeconds: 60, autoRest: false, restMode: 'auto', advancedLogging: false, cheers: true });
  for (const value of ['true', 1, null]) assert.equal(core.sanitizeState({ ...legacy, settings: { advancedLogging: value } }).settings.advancedLogging, false);
  assert.equal(core.sanitizeState({ ...legacy, settings: { advancedLogging: true } }).settings.advancedLogging, true);
});

test('Swedish cheers stay on for existing data and only an explicit false turns them off', () => {
  assert.equal(core.defaultState().settings.cheers, true);
  const legacy = { v: core.SCHEMA, routines: core.defaultState().routines, settings: { restSeconds: 60, autoRest: false } };
  for (const value of ['false', 0, null]) assert.equal(core.sanitizeState({ ...legacy, settings: { cheers: value } }).settings.cheers, true);
  assert.equal(core.sanitizeState({ ...legacy, settings: { cheers: false } }).settings.cheers, false);
});

test('own rest time is opt-in: existing data keeps the automatic recommendation and only a valid fixed mode is honoured', () => {
  const legacy = { v: core.SCHEMA, routines: core.defaultState().routines, settings: { restSeconds: 45, autoRest: true } };
  const exercise = core.defaultState().routines[0].exercises[0];
  const auto = core.sanitizeState(legacy).settings;
  assert.equal(auto.restMode, 'auto');
  assert.equal(core.restFor(auto, exercise), core.recommendedRestSeconds(exercise));
  const fixed = core.sanitizeState({ ...legacy, settings: { restSeconds: 45, autoRest: true, restMode: 'fixed' } }).settings;
  assert.equal(core.restFor(fixed, exercise, 0), 45);
  assert.equal(core.sanitizeState({ ...legacy, settings: { restMode: 'other' } }).settings.restMode, 'auto');
  assert.equal(core.restFor({ restMode: 'fixed', restSeconds: 9999 }, exercise), 600);
});

async function seedWorkout(page, { finished = 0, rir = null } = {}) {
  const state = core.defaultState();
  state.settings.autoRest = false;
  state.session = core.startSession(state.routines[0]);
  state.session.exercises.forEach((exercise, i) => {
    if (i < finished) exercise.sets.forEach((set) => { set.done = true; });
  });
  if (rir !== null) state.session.exercises[0].rir = rir;
  await page.goto(url);
  await page.evaluate((value) => localStorage.setItem('gym-tracker-v1', JSON.stringify(value)), state);
  await page.reload();
  await page.locator('.ex').first().waitFor();
  return state;
}

async function seedProgram(page) {
  const state = core.defaultState();
  state.settings.autoRest = false;
  state.routines = [core.sanitizeRoutine({
    id: 'r', name: 'Kasvu',
    exercises: [{ id: 'e', name: 'Kyykky', sets: 4, reps: '10', weight: '100 kg', progression: { minReps: 8, maxReps: 15, weightStep: 2.5, autoLoad: true } }],
  })];
  await page.goto(url);
  await page.evaluate((value) => localStorage.setItem('gym-tracker-v1', JSON.stringify(value)), state);
  await page.reload();
  await page.locator('.routine').first().waitFor();
}

try {
  for (const [name, engine, device] of [['chromium', chromium, 'Pixel 7'], ['webkit', webkit, 'iPhone 14']]) {
    const browser = await engine.launch();
    try {
      await test(`${name}: simplified workout view`, async (t) => {
        const run = async (title, work, options = {}) => t.test(title, { timeout: 30000 }, async () => {
          const context = await browser.newContext({ ...devices[device], reducedMotion: 'reduce', serviceWorkers: 'block', ...options });
          const page = await context.newPage(); page.setDefaultTimeout(5000);
          const errors = [];
          page.on('pageerror', (error) => errors.push(error.message));
          try { await work(page); assert.deepEqual(errors, []); } finally { await context.close(); }
        });

        await run('the logging panel is hidden by default, keeps saved values, and returns when enabled in settings', async (p) => {
          const before = await seedWorkout(p, { rir: '2' });
          assert.equal(await p.locator('.exercise-log').count(), 0);
          assert.equal(await p.locator('[data-rir-box="0"] [aria-pressed="true"]').innerText(), '2', 'RIR is visible without the logging panel');
          assert.deepEqual((await saved(p)).session, before.session);
          await tap(p.getByRole('button', { name: 'Takaisin harjoituksiin' }));
          await p.locator('.settings > summary').click();
          const toggle = p.getByRole('switch', { name: 'Näytä kuormittavuuden kirjaus harjoituksen aikana' });
          assert.equal(await toggle.isChecked(), false);
          await toggle.click();
          await p.waitForFunction(() => JSON.parse(localStorage.getItem('gym-tracker-v1')).settings.advancedLogging === true);
          assert.equal((await saved(p)).settings.advancedLogging, true);
          await p.reload();
          await p.locator('.exercise-log summary').first().click();
          assert.equal(await p.locator('[data-rir-box="0"] [aria-pressed="true"]').innerText(), '2');
        });

        await run('a user-defined rest time persists and drives the rest timer after a set', async (p) => {
          await seedWorkout(p);
          await tap(p.getByRole('button', { name: 'Takaisin harjoituksiin' }));
          await p.locator('.settings > summary').click();
          await p.getByRole('switch', { name: 'Käynnistä lepoajastin sarjan jälkeen' }).click();
          await p.waitForFunction(() => document.getElementById('app').getAttribute('aria-busy') !== 'true');
          await p.getByRole('switch', { name: 'Käytä omaa lepoaikaa sarjojen välillä' }).click();
          await p.waitForFunction(() => document.getElementById('app').getAttribute('aria-busy') !== 'true');
          await p.locator('[data-action="restsecs"]').fill('45');
          await p.locator('[data-action="restsecs"]').press('Enter');
          await p.waitForFunction(() => JSON.parse(localStorage.getItem('gym-tracker-v1')).settings.restSeconds === 45);
          assert.equal((await saved(p)).settings.restMode, 'fixed');
          await tap(p.locator('[data-action="resume"]'));
          const before = Date.now();
          await tap(p.locator('[data-action="set"]').first());
          await p.waitForFunction(() => JSON.parse(localStorage.getItem('gym-tracker-v1')).restEnd);
          const remaining = (await saved(p)).restEnd - before;
          assert.ok(remaining > 40000 && remaining <= 46000, `rest ${remaining} ms`);
        });

        await run('an opened program offers Kevennetty and Super starts below the normal start, and the Kevennetty workout is lightened and flagged', async (p) => {
          await seedProgram(p);
          await expandRoutines(p);
          const normal = p.getByRole('button', { name: 'Aloita harjoitus', exact: true });
          const light = p.getByRole('button', { name: 'Kevennetty treeni: Kasvu', exact: true });
          const boosted = p.getByRole('button', { name: 'Super treeni: Kasvu', exact: true });
          assert.match(await light.innerText(), /^Kevennetty\n/);
          assert.match(await boosted.innerText(), /^Super\n/);
          assert.match(await light.innerText(), /Toistot ja painot -15 %/);
          assert.match(await boosted.innerText(), /Lisäsarja liikkeisiin/);
          const [n, l, s] = await Promise.all([normal, light, boosted].map((b) => b.boundingBox()));
          assert.ok(l.y >= n.y + n.height && s.y >= n.y + n.height, 'variant starts sit below the normal start');
          await tap(light);
          await p.locator('.ex').first().waitFor();
          const { session, routines } = await saved(p);
          assert.equal(session.fatigued, true);
          assert.deepEqual([session.exercises[0].sets.length, session.exercises[0].reps, session.exercises[0].weight, session.exercises[0].deload], [4, '8', '85 kg', true]);
          assert.deepEqual([routines[0].exercises[0].sets, routines[0].exercises[0].reps, routines[0].exercises[0].weight], [4, '10', '100 kg']);
          assert.match(await p.locator('.notice[role="status"]').innerText(), /Kevennetty treeni/);
          assert.equal(await p.locator('[data-log="fatigued"]').count(), 0);
        });

        await run('the Super workout adds one set per exercise and leaves the program, load and recovery flag alone', async (p) => {
          await seedProgram(p);
          await tap(p.getByRole('button', { name: 'Super treeni: Kasvu', exact: true }));
          await p.locator('.ex').first().waitFor();
          const { session, routines } = await saved(p);
          assert.equal('fatigued' in session, false);
          const [exercise] = session.exercises;
          assert.deepEqual([exercise.sets.length, exercise.weight, exercise.reps, 'deload' in exercise], [5, '100 kg', '10', false]);
          assert.equal(routines[0].exercises[0].sets, 4);
          assert.equal(await p.locator('.notice[role="status"]').count(), 0);
        });

        await run('the rail lists every exercise with its set count, greens finished ones and jumps on tap', async (p) => {
          const state = await seedWorkout(p, { finished: 2 });
          const boxes = p.locator('.track-box');
          assert.equal(await boxes.count(), state.session.exercises.length);
          assert.deepEqual(await boxes.allInnerTexts(), state.session.exercises.map((e) => String(e.sets.length)));
          assert.deepEqual(await boxes.evaluateAll((list) => list.map((b) => b.classList.contains('done'))), state.session.exercises.map((_, i) => i < 2));
          assert.equal(await boxes.nth(2).getAttribute('aria-current'), 'step');
          const done = boxes.first();
          const colors = await done.evaluate((b) => { const s = getComputedStyle(b); return [s.backgroundColor, s.color]; });
          assert.deepEqual(colors, ['rgb(168, 240, 156)', 'rgb(0, 0, 0)']);
          const last = state.session.exercises.length - 1;
          await p.evaluate(() => window.scrollTo(0, 0));
          const railTop = await p.locator('.track-rail').evaluate((r) => r.getBoundingClientRect().top);
          await boxes.nth(last).click();
          await p.waitForFunction((i) => {
            const card = document.getElementById(`exercise-${i}`);
            const set = card.querySelector('.set.next') || card.querySelector('.set');
            const r = card.getBoundingClientRect().height <= innerHeight ? card.getBoundingClientRect() : set.getBoundingClientRect();
            return r.top >= 0 && r.bottom <= innerHeight;
          }, last);
          assert.equal(await p.locator('.track-rail').evaluate((r) => r.getBoundingClientRect().top), railTop);
          const before = (await saved(p)).session;
          await boxes.nth(0).click();
          assert.deepEqual((await saved(p)).session, before);
        });

        await run('the rail stays clear of the sets and meets accessibility, touch-size and overflow checks', async (p) => {
          await seedWorkout(p, { finished: 1 });
          for (const colorScheme of ['dark', 'light']) {
            await p.emulateMedia({ colorScheme });
            for (const viewport of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1280, height: 900 }]) {
              await p.setViewportSize(viewport);
              const label = `${colorScheme} ${viewport.width}px`;
              const violations = (await new AxeBuilder({ page: p }).analyze()).violations;
              assert.deepEqual(violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })), [], label);
              assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, label);
              assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('button, input, summary')].filter((e) => {
                const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 47.9 || r.height < 47.9);
              }).map((e) => e.outerHTML.slice(0, 100))), [], label);
              assert.equal(await p.evaluate(() => {
                const rail = document.querySelector('.track-rail').getBoundingClientRect();
                return [...document.querySelectorAll('.ex, .session-intro, .session-header button, .session-time')].every((e) => e.getBoundingClientRect().right <= rail.left + 0.5);
              }), true, `${label}: content clears the rail`);
              assert.equal(await p.evaluate(() => {
                const rail = document.querySelector('.track-rail').getBoundingClientRect();
                return rail.top >= 0 && rail.bottom <= innerHeight && rail.right <= innerWidth;
              }), true, `${label}: rail fits the viewport`);
            }
          }
        }, { bypassCSP: true });
      });
    } finally { await browser.close(); }
  }
} finally { server.kill(); }
