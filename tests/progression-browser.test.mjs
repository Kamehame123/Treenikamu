import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as core from '../core.js';
import { chromium, webkit, devices, AxeBuilder, startServer, tap } from './support.mjs';

const { server, url } = await startServer();
const button = (page, name) => page.getByRole('button', { name, exact: true });
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('gym-tracker-v1')));
const idle = (page) => page.waitForFunction(() => document.getElementById('app').getAttribute('aria-busy') !== 'true');
function fixture({ reps = '10', autoProgress = false, complete = false, fatigued = false, pain = false } = {}) {
  const state = core.defaultState();
  state.settings.autoRest = false;
  state.routines = [core.sanitizeRoutine({
    id: 'r', name: 'Kasvu', autoProgress,
    exercises: [{ id: 'e', name: 'Kyykky', sets: 3, reps, weight: '100 kg',
      progression: { minReps: 8, maxReps: 15, weightStep: 2.5, autoLoad: true } }],
  })];
  state.session = core.startSession(state.routines[0], Date.now() - 3600000);
  if (fatigued) state.session.fatigued = true;
  if (pain) state.session.exercises[0].pain = true;
  if (complete) {
    state.session.exercises[0].rir = '2';
    state.session.exercises[0].sets.forEach((set) => { set.done = true; set.actualReps = reps; });
  }
  return state;
}
async function seed(page, state) {
  await page.goto(url);
  await page.evaluate((state) => localStorage.setItem('gym-tracker-v1', JSON.stringify(state)), state);
  await page.reload();
  await page.locator('h1').waitFor();
}
async function log(page, field, value, si = 0) {
  const input = page.locator(`[data-log="${field}"]${field.startsWith('actual') ? `[data-s="${si}"]` : ''}`);
  await input.fill(value);
  await idle(page);
}
async function blockWrites(page) {
  await page.evaluate(() => {
    window.originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'gym-tracker-v1') throw new DOMException('quota', 'QuotaExceededError');
      return window.originalSetItem.call(this, key, value);
    };
  });
}
async function unblockWrites(page) {
  await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; });
}

try {
  for (const [name, engine, device] of [['chromium', chromium, 'Pixel 7'], ['webkit', webkit, 'iPhone 14']]) {
    const browser = await engine.launch();
    try {
      await test(`${name}: evidence-based reversible progression`, async (t) => {
        const run = async (title, work, options = {}) => t.test(title, { timeout: 45000 }, async () => {
          const context = await browser.newContext({ ...devices[device], reducedMotion: 'reduce', serviceWorkers: 'block', ...options });
          const page = await context.newPage();
          page.setDefaultTimeout(6000);
          const errors = [];
          page.on('pageerror', (error) => errors.push(error.message));
          try { await work(page, context); assert.deepEqual(errors, []); } finally { await context.close(); }
        });

        await run('automatic selection progresses strength and higher-rep work without an 8-15 constraint', async (page) => {
          const strength = fixture({ reps: '5', autoProgress: true, complete: true });
          delete strength.routines[0].exercises[0].progression;
          await seed(page, strength);
          await tap(button(page, 'Tallenna harjoitus'));
          let result = await saved(page);
          assert.equal(result.routines[0].exercises[0].reps, '6');
          assert.equal(result.routines[0].exercises[0].progression.minReps, 3);
          assert.equal(result.routines[0].exercises[0].progression.maxReps, 6);
          await page.reload();
          await tap(button(page, 'Peru tarkistus'));
          assert.deepEqual((await saved(page)).routines[0].exercises, strength.routines[0].exercises);
          const isolation = fixture({ reps: '15', autoProgress: true, complete: true });
          delete isolation.routines[0].exercises[0].progression;
          isolation.routines[0].exercises[0].name = 'Vipunosto sivulle';
          isolation.session.exercises[0].name = 'Vipunosto sivulle';
          await seed(page, isolation);
          await tap(button(page, 'Tallenna harjoitus'));
          result = await saved(page);
          assert.equal(result.routines[0].exercises[0].reps, '16');
          assert.equal(result.routines[0].exercises[0].progression.maxReps, 20);
          assert.match(await page.locator('.revision-report').innerText(), /10–20/);
          assert.equal(result.history[0].exercises[0].reps, '15');
        });

        await run('saved ranges are preserved until explicitly recalculated without losing equipment settings', async (page) => {
          const state = fixture();
          state.session = null;
          Object.assign(state.routines[0].exercises[0].progression, { weightStep: 1.25, autoLoad: false });
          await seed(page, state);
          await tap(button(page, 'Muokkaa: Kasvu'));
          await page.locator('.progression-editor summary').click();
          assert.equal(await page.locator('[data-progression="minReps"]').inputValue(), '8');
          assert.equal(await page.locator('[data-progression="maxReps"]').inputValue(), '15');
          await tap(button(page, 'Laske kehitysalue uudelleen'));
          assert.equal(await page.locator('[data-progression="minReps"]').inputValue(), '6');
          assert.equal(await page.locator('[data-progression="maxReps"]').inputValue(), '12');
          await tap(button(page, 'Tallenna harjoitus'));
          assert.deepEqual((await saved(page)).routines[0].exercises[0].progression, { weightStep: 1.25, autoLoad: false });
          await page.reload();
          await tap(button(page, 'Muokkaa: Kasvu'));
          await page.locator('.progression-editor summary').click();
          assert.equal(await page.locator('[data-progression="maxReps"]').inputValue(), '12');
          assert.equal(await page.locator('[data-progression="weightStep"]').inputValue(), '1.25');
          assert.equal(await page.locator('[data-progression="autoLoad"]').isChecked(), false);
        });

        await run('actual reps, decimal loads, RIR zero, fatigue and pain persist before blur and reload', async (page) => {
          await seed(page, fixture());
          await page.locator('.exercise-log summary').click();
          await log(page, 'actualReps', '9', 0);
          await log(page, 'actualReps', '10', 1);
          await log(page, 'actualWeight', '97,5', 0);
          await log(page, 'rir', '0');
          await page.locator('[data-log="fatigued"]').check(); await idle(page);
          await page.locator('[data-log="pain"]').check(); await idle(page);
          const before = await saved(page);
          assert.equal(before.session.exercises[0].sets[0].actualWeight, '97,5');
          assert.equal(before.session.exercises[0].rir, '0');
          await page.reload();
          assert.deepEqual((await saved(page)).session, before.session);
          await page.locator('.exercise-log summary').click();
          assert.equal(await page.locator('[data-log="rir"]').inputValue(), '0');
          assert.equal(await page.locator('[data-log="pain"]').isChecked(), true);
          await log(page, 'rir', '');
          assert.equal('rir' in (await saved(page)).session.exercises[0], false);
          await page.locator('[data-log="actualWeight"][data-s="0"]').fill('20 lbs');
          await page.locator('[data-log="actualWeight"][data-s="0"]').blur();
          assert.match(await page.getByRole('alert').innerText(), /kilogrammoina/);
          assert.equal((await saved(page)).session.exercises[0].sets[0].actualWeight, '97,5');
        });

        await run('manual revision is opt-in, reports exact changes, and undo survives reload without altering history', async (page) => {
          await seed(page, fixture({ complete: true }));
          await tap(button(page, 'Tallenna harjoitus'));
          const original = await saved(page);
          assert.equal(original.routines[0].exercises[0].reps, '10');
          assert.equal(original.routines[0].autoProgress, false);
          await tap(button(page, 'Tarkista seuraava treeni'));
          const revised = await saved(page);
          assert.equal(revised.routines[0].exercises[0].reps, '11');
          assert.match(await page.locator('.revision-report').innerText(), /3 x 10 @ 100 kg → 3 x 11 @ 100 kg/);
          assert.deepEqual(revised.history, original.history);
          await page.reload();
          await tap(button(page, 'Peru tarkistus'));
          assert.deepEqual((await saved(page)).routines[0].exercises, original.routines[0].exercises);
          await page.reload();
          await tap(button(page, 'Tarkista seuraava treeni'));
          assert.match(await page.locator('.progression-controls').getByRole('status').filter({ hasText: 'jo tarkistettu' }).innerText(), /jo tarkistettu/);
          assert.deepEqual((await saved(page)).history, original.history);
          await tap(button(page, 'Aloita harjoitus'));
          assert.deepEqual(await page.locator('.set-value').allTextContents(), ['10 x 100kg', '10 x 100kg', '10 x 100kg']);
        });

        await run('automatic switch is per routine, persists, and revises atomically on finish', async (page) => {
          const state = fixture({ complete: true });
          await seed(page, state);
          await tap(button(page, 'Takaisin harjoituksiin'));
          await page.getByRole('switch', { name: 'Tarkista automaattisesti: Kasvu' }).check();
          await idle(page);
          await page.reload();
          await tap(button(page, 'Takaisin harjoituksiin'));
          assert.equal(await page.getByRole('switch', { name: 'Tarkista automaattisesti: Kasvu' }).isChecked(), true);
          await tap(button(page, 'Jatka harjoitusta'));
          await tap(button(page, 'Tallenna harjoitus'));
          const after = await saved(page);
          assert.equal(after.session, null);
          assert.equal(after.routines[0].exercises[0].reps, '11');
          assert.equal(after.history[0].exercises[0].reps, '10');
          await tap(button(page, 'Peru tarkistus'));
          assert.equal((await saved(page)).routines[0].autoProgress, true);
          assert.equal((await saved(page)).routines[0].exercises[0].reps, '10');
          await page.locator('.history-log summary').click();
          assert.match(await page.locator('.history-log').innerText(), /10 toistoa @ 100 kg/);
        });

        await run('checking sets alone cannot manufacture performance or increase targets', async (page) => {
          const state = fixture({ autoProgress: true });
          state.session.exercises[0].sets.forEach((set) => { set.done = true; });
          await seed(page, state);
          await tap(button(page, 'Tallenna harjoitus'));
          assert.equal((await saved(page)).routines[0].exercises[0].reps, '10');
          assert.match(await page.locator('.revision-report').innerText(), /toteutuneet toistot/);
          assert.equal(await button(page, 'Peru tarkistus').count(), 0);
        });

        await run('two ceiling successes produce a smaller-rep next workout at the new weight', async (page) => {
          const state = fixture({ reps: '15', complete: true, autoProgress: true });
          const prior = core.summarize(state.session, Date.now() - 7 * 86400000);
          prior.id = 'prior-ceiling';
          prior.startedAt = prior.endedAt - 3600000;
          state.history = [prior];
          await seed(page, state);
          await tap(button(page, 'Tallenna harjoitus'));
          const result = await saved(page);
          assert.equal(result.routines[0].exercises[0].weight, '102.5 kg');
          assert.equal(result.routines[0].exercises[0].reps, '13');
          assert.equal(result.history[0].exercises[0].weight, '100 kg');
          await tap(button(page, 'Aloita harjoitus'));
          assert.deepEqual(await page.locator('.set-value').allTextContents(), ['13 x 102.5kg', '13 x 102.5kg', '13 x 102.5kg']);
        });

        await run('pain is reported without an increase or a fatigue deload', async (page) => {
          await seed(page, fixture({ complete: true, autoProgress: true, pain: true, fatigued: true }));
          await tap(button(page, 'Tallenna harjoitus'));
          const result = await saved(page);
          assert.equal(result.routines[0].exercises[0].weight, '100 kg');
          assert.equal(result.routines[0].exercises[0].sets, 3);
          assert.equal(result.routines[0].exercises[0].reps, '10');
          assert.match(await page.locator('.revision-report').innerText(), /Älä harjoittele kivun läpi/);
          assert.equal(await button(page, 'Peru tarkistus').count(), 0);
        });

        await run('a fatigue deload and its recovery baseline survive reload; manual edits do not resurrect old targets', async (page) => {
          await seed(page, fixture({ autoProgress: true, complete: true, fatigued: true }));
          await tap(button(page, 'Tallenna harjoitus'));
          const deload = await saved(page);
          assert.equal(deload.routines[0].exercises[0].sets, 2);
          assert.equal(deload.routines[0].exercises[0].weight, '90 kg');
          await page.reload();
          await tap(button(page, 'Muokkaa: Kasvu'));
          await page.locator('[data-f="weight"]').fill('85 kg');
          await tap(button(page, 'Tallenna harjoitus'));
          const edited = await saved(page);
          assert.equal(edited.routines[0].exercises[0].weight, '85 kg');
          assert.equal('recoveryBase' in edited.routines[0].exercises[0], false);
          assert.equal(await button(page, 'Peru tarkistus').count(), 0);
          await seed(page, fixture({ autoProgress: true, complete: true, fatigued: true }));
          await tap(button(page, 'Tallenna harjoitus'));
          await tap(button(page, 'Muokkaa: Kasvu'));
          await page.locator('.progression-editor summary').click();
          await page.locator('[data-progression="weightStep"]').fill('1.25');
          await tap(button(page, 'Tallenna harjoitus'));
          assert.equal('recoveryBase' in (await saved(page)).routines[0].exercises[0], false);
        });

        await run('failed finish, revision, and undo leave durable data unchanged and support retry', async (page) => {
          await seed(page, fixture({ autoProgress: true, complete: true }));
          const before = await saved(page);
          await blockWrites(page);
          await tap(button(page, 'Tallenna harjoitus'));
          assert.deepEqual(await saved(page), before);
          assert.equal(await page.locator('h1').innerText(), 'Kasvu');
          assert.match(await page.getByRole('alert').innerText(), /ei voitu tallentaa/);
          await unblockWrites(page);
          await tap(button(page, 'Yritä tallentaa uudelleen'));
          await tap(button(page, 'Tallenna harjoitus'));
          const revised = await saved(page);
          assert.equal(revised.routines[0].exercises[0].reps, '11');
          await blockWrites(page);
          await tap(button(page, 'Peru tarkistus'));
          assert.deepEqual(await saved(page), revised);
          await unblockWrites(page);
          await tap(button(page, 'Yritä tallentaa uudelleen'));
          await tap(button(page, 'Peru tarkistus'));
          assert.equal((await saved(page)).routines[0].exercises[0].reps, '10');
          // A fresh completed session allows another revision, but a failed write must not consume it.
          await tap(button(page, 'Aloita harjoitus'));
          await page.locator('.exercise-log summary').click();
          for (let i = 0; i < 3; i++) { await log(page, 'actualReps', '10', i); await tap(page.locator(`[data-key="s0-${i}"]`)); }
          await log(page, 'rir', '2');
          await tap(button(page, 'Takaisin harjoituksiin'));
          await page.getByRole('switch', { name: 'Tarkista automaattisesti: Kasvu' }).uncheck(); await idle(page);
          await tap(button(page, 'Jatka harjoitusta'));
          await tap(button(page, 'Tallenna harjoitus'));
          const manual = await saved(page);
          await blockWrites(page);
          await tap(button(page, 'Tarkista seuraava treeni'));
          assert.deepEqual(await saved(page), manual);
          await unblockWrites(page);
          await tap(button(page, 'Yritä tallentaa uudelleen'));
          await tap(button(page, 'Tarkista seuraava treeni'));
          assert.equal((await saved(page)).routines[0].exercises[0].reps, '11');
        });

        await run('another tab cannot apply the same session twice or revise an active workout', async (page, context) => {
          await seed(page, fixture({ complete: true }));
          await tap(button(page, 'Tallenna harjoitus'));
          const other = await context.newPage();
          await other.goto(url);
          await Promise.all([tap(button(page, 'Tarkista seuraava treeni')), tap(button(other, 'Tarkista seuraava treeni'))]);
          assert.equal((await saved(page)).routines[0].exercises[0].reps, '11');
          await tap(button(page, 'Aloita harjoitus'));
          await tap(button(page, 'Takaisin harjoituksiin'));
          assert.equal(await button(page, 'Tarkista seuraava treeni').isDisabled(), true);
          assert.equal(await button(page, 'Peru tarkistus').isDisabled(), true);
        });

        await run('progression configuration and new metadata round-trip through exported backups', async (page) => {
          await seed(page, fixture({ autoProgress: true, complete: true }));
          await tap(button(page, 'Tallenna harjoitus'));
          await tap(button(page, 'Muokkaa: Kasvu'));
          await page.locator('.progression-editor summary').click();
          await page.locator('[data-progression="minReps"]').fill('4');
          await page.locator('[data-progression="maxReps"]').fill('6');
          await page.locator('[data-progression="weightStep"]').fill('1.25');
          await page.locator('[data-progression="autoLoad"]').uncheck();
          await tap(button(page, 'Tallenna harjoitus'));
          assert.deepEqual((await saved(page)).routines[0].exercises[0].progression, { minReps: 4, maxReps: 6, weightStep: 1.25, autoLoad: false });
          const download = page.waitForEvent('download');
          await tap(button(page, 'Vie varmuuskopio'));
          const backup = core.parseBackup(await readFile(await (await download).path(), 'utf8'));
          assert.equal(backup.ok, true);
          assert.deepEqual(backup.state.routines, (await saved(page)).routines);
          assert.deepEqual(backup.state.history, (await saved(page)).history);
        });

        await run('automatic revision and persistent undo work fully offline', async (page, context) => {
          await page.goto(url);
          await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated');
          await page.evaluate((state) => localStorage.setItem('gym-tracker-v1', JSON.stringify(state)), fixture({ autoProgress: true, complete: true }));
          await page.reload();
          await page.waitForFunction(() => !!navigator.serviceWorker.controller);
          assert.equal(await page.evaluate(async () => !!await caches.match('./progression.js')), true);
          await context.setOffline(true);
          await page.reload();
          await tap(button(page, 'Tallenna harjoitus'));
          assert.equal((await saved(page)).routines[0].exercises[0].reps, '11');
          await page.reload();
          await tap(button(page, 'Peru tarkistus'));
          assert.equal((await saved(page)).routines[0].exercises[0].reps, '10');
          assert.equal((await saved(page)).history.length, 1);
        }, { serviceWorkers: 'allow' });

        await run('new controls remain accessible and fit narrow screens in dark and light modes', async (page) => {
          await seed(page, fixture({ autoProgress: true, complete: true }));
          await page.locator('.exercise-log summary').click();
          for (const view of ['workout', 'home', 'edit']) {
            if (view === 'home') {
              await tap(button(page, 'Tallenna harjoitus'));
              await page.locator('.coaching-guide summary').click();
              await page.locator('.history-log summary').click();
            }
            if (view === 'edit') {
              await tap(button(page, 'Muokkaa: Kasvu'));
              await page.locator('.progression-editor summary').click();
            }
            for (const colorScheme of ['dark', 'light']) {
              await page.emulateMedia({ colorScheme });
              await page.setViewportSize({ width: 320, height: 640 });
              const violations = (await new AxeBuilder({ page }).analyze()).violations;
              assert.deepEqual(violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })), []);
              assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
            }
          }
        }, { bypassCSP: true });
      });
    } finally { await browser.close(); }
  }
} finally { server.kill(); }
