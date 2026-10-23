import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../core.js';
import { chromium, webkit, devices, AxeBuilder, startServer, tap, tapConfirm } from './support.mjs';
import { configuredState, workout, baselineHistory, statisticsRoutine, DAY } from './statistics-fixtures.mjs';

const { server, url } = await startServer();
const button = (page, name) => page.getByRole('button', { name, exact: true });
const recordRow = (page, name) => page.locator('.record-row').filter({ has: page.locator('.record-name', { hasText: name }) });
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('gym-tracker-v1')));
const idle = (page) => page.waitForFunction(() => document.getElementById('app').getAttribute('aria-busy') !== 'true');
async function seed(page, state) {
  await page.goto(url);
  await page.evaluate((state) => localStorage.setItem('gym-tracker-v1', JSON.stringify(state)), state);
  await page.reload();
  await page.locator('h1').waitFor();
}
async function openStatistics(page) {
  await tap(button(page, 'Historia'));
  await tap(button(page, 'Tilastot'));
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
          await tap(button(page, 'Historiaan'));
          await page.getByRole('heading', { name: 'Historia', exact: true }).waitFor();
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
          await tap(page.locator('[data-action="exrir"][data-e="0"][data-value="2"]')); await idle(page);
          await log.locator('[data-log="kind"][data-s="0"][value="warmup"]').check(); await idle(page);
          let current = await saved(page);
          assert.equal(current.session.exercises[0].sets[0].actualReps, '7');
          assert.equal(current.session.exercises[0].rir, '2');
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
          await tap(button(page, 'Luo treeniohjelma'));
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

        await run('records show approximate best sets across programs, keep load contexts separate and preserve storage on mobile', async (page) => {
          const now = Date.now(), state = core.defaultState();
          const best = workout('record-best', now - 2 * DAY, [50, 40]);
          best.exercises.forEach((e, i) => e.sets.forEach((s) => {
            delete s.setRir; delete s.kind;
            if (i === 0) s.actualReps = '8'; else delete s.actualReps;
          }));
          const heavier = structuredClone(best);
          heavier.id = 'record-heavier'; heavier.routineId = 'other-program'; heavier.endedAt = now - DAY;
          heavier.exercises[0].id = 'another-move'; heavier.exercises[0].weight = '60';
          heavier.exercises[0].sets.forEach((s) => { s.actualReps = '1'; });
          const dumbbell = structuredClone(best);
          dumbbell.id = 'record-dumbbell'; dumbbell.endedAt = now - DAY;
          dumbbell.exercises[0].weight = '20';
          Object.assign(dumbbell.exercises[0].tracking, { loadType: 'per-hand', equipment: 'Käsipainot', variant: '<img src=x onerror=alert(1)> pitkä suoritustapatunniste' });
          best.name = 'Maksimiarvion alkuperäinen treeni';
          heavier.name = 'Painoennätyksen alkuperäinen treeni';
          dumbbell.name = 'Käsipainotreeni';
          state.history = [heavier, best, dumbbell];
          await seed(page, state);
          const before = await saved(page);
          const rawBefore = await page.evaluate(() => localStorage.getItem('gym-tracker-v1'));
          await tap(button(page, 'Ennätykset'));
          const bench = recordRow(page, 'Penkkipunnerrus');
          assert.equal(await bench.count(), 1);
          assert.match(await bench.locator('.record-result').innerText(), /60 kg/);
          assert.equal(await bench.locator('.record-estimate').count(), 2);
          const external = bench.locator('.record-estimate').filter({ hasText: 'Levytanko' });
          assert.match(await external.innerText(), /Arvio ~63,3 kg/);
          assert.equal(await external.locator('.record-date').innerText(), new Date(best.endedAt).toLocaleDateString('fi-FI'));
          assert.match(await bench.locator('.record-estimate').filter({ hasText: 'kg/käsipaino' }).innerText(), /Arvio ~25,3 kg\/käsipaino/);
          assert.equal(await bench.locator('img').count(), 0);
          const row = recordRow(page, 'Kulmasoutu');
          assert.match(await row.locator('.record-result').innerText(), /40 kg/);
          assert.equal(await row.locator('.record-estimate').count(), 0);
          assert.equal(await page.locator('[data-action="editrecord"]').count(), 0);
          assert.doesNotMatch(await page.locator('.record-list').innerText(), /NaN|Infinity|Epley|RIR/);
          assert.equal(await page.locator('.record-session[open]').count(), 0);
          assert.equal(await bench.locator('.record-session').count(), 1);
          assert.doesNotMatch(await page.locator('.record-list').innerText(), /Näytä maksimiarvion treeni|Teoreettinen maksimi/);
          for (const session of [heavier]) {
            const disclosure = bench.locator(`.record-session[data-session-id="${session.id}"]`);
            const summary = disclosure.locator('summary');
            await summary.focus(); await summary.press('Enter');
            await disclosure.locator('.record-session-content').waitFor();
            assert.equal(await disclosure.locator('.record-session-content > p strong').innerText(), session.name);
            assert.equal(await disclosure.locator('li').count(), session.exercises.length, 'the entire workout is shown');
            assert.match(await disclosure.innerText(), /Kulmasoutu tangolla: toistot kirjaamatta @ 40/);
            assert.match(await disclosure.innerText(), new RegExp(session.exercises[0].sets[0].actualReps + ' toistoa @ ' + session.exercises[0].weight));
            await summary.press('Space');
            assert.equal(await disclosure.getAttribute('open'), null);
            await tap(summary);
          }
          for (const width of [320, 390]) {
            await page.setViewportSize({ width, height: 800 });
            for (const colorScheme of ['dark', 'light']) {
              await page.emulateMedia({ colorScheme });
              await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, colorScheme === 'dark' ? 'dark' : 'aurora');
              const layout = await bench.evaluate((row) => {
                const result = row.querySelector('.record-result').getBoundingClientRect();
                const session = row.querySelector('.record-session').getBoundingClientRect();
                return [...row.querySelectorAll('.record-estimate')].every((estimate) => {
                  const bounds = estimate.getBoundingClientRect();
                  return bounds.top >= result.bottom && bounds.bottom <= session.top;
                });
              });
              assert.equal(layout, true, 'estimates sit below the recorded maximum and above the workout disclosure');
              assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px ${colorScheme}`);
              const result = await new AxeBuilder({ page }).analyze();
              assert.deepEqual(result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })), []);
            }
          }
          await page.reload(); await tap(button(page, 'Ennätykset'));
          assert.match(await page.locator('.record-list').innerText(), /Arvio ~63,3 kg/);
          assert.equal(await page.locator('.record-session[open]').count(), 0);
          assert.deepEqual(await saved(page), before);
          assert.equal(await page.evaluate(() => localStorage.getItem('gym-tracker-v1')), rawBefore);
        });

        await run('one ordinary workout produces a 1RM without advanced logging or rep adjustments', async (page) => {
          const state = core.defaultState(), routine = statisticsRoutine();
          routine.exercises = [routine.exercises[0]];
          Object.assign(routine.exercises[0], { sets: 1, reps: '8-8', weight: '50' });
          state.routines = [routine]; state.settings.autoRest = false;
          await seed(page, state);
          await tap(button(page, 'Aloita harjoitus'));
          assert.match(await page.locator('[data-key="s0-0"] .set-foot').innerText(), /^Klikkaa tehdyksi$/);
          await tap(page.locator('[data-key="s0-0"]'));
          assert.equal((await saved(page)).session.exercises[0].sets[0].actualReps, '8');
          await page.reload();
          await tap(page.locator('[data-key="s0-0"]'));
          assert.equal((await saved(page)).session.exercises[0].sets[0].done, false);
          await tap(page.locator('[data-key="s0-0"]'));
          await tap(button(page, 'Tallenna harjoitus'));
          assert.equal((await saved(page)).history.length, 1);
          assert.equal((await saved(page)).history[0].exercises[0].sets[0].actualReps, '8');
          assert.deepEqual((await saved(page)).routines, state.routines);
          await tap(button(page, 'Ennätykset'));
          assert.match(await page.locator('.record-estimate').innerText(), /Arvio ~63,3 kg/);
        });

        await run('an exercise without a load meaning asks once, then yields a 1RM; range targets are never recorded', async (page) => {
          const state = core.defaultState(), routine = statisticsRoutine();
          routine.exercises = [routine.exercises[0]];
          Object.assign(routine.exercises[0], { sets: 2, reps: '8', setReps: ['8', '8-12'], weight: '50' });
          delete routine.exercises[0].tracking;
          state.routines = [routine]; state.settings.autoRest = false;
          await seed(page, state);
          await tap(button(page, 'Aloita harjoitus'));
          assert.match(await page.locator('[data-key="s0-1"] .set-foot').innerText(), /^Klikkaa tehdyksi$/);
          const menu = page.locator('[data-key="sload-0"]');
          await menu.click();
          await page.locator('[data-key="sload-0-external"]').check(); await idle(page);
          assert.equal(await page.locator('[data-key="sload-0"]').count(), 0, 'the question is asked once');
          const mid = await saved(page);
          assert.equal(mid.session.exercises[0].tracking.loadType, 'external');
          assert.equal(mid.routines[0].exercises[0].tracking.loadType, 'external');
          await tap(page.locator('[data-key="s0-0"]'));
          await tap(page.locator('[data-key="s0-1"]'));
          const session = (await saved(page)).session.exercises[0].sets;
          assert.equal(session[0].actualReps, '8');
          assert.equal(session[1].actualReps, undefined, 'a range target is not silently recorded as its top');
          await tap(button(page, 'Tallenna harjoitus'));
          await tap(button(page, 'Ennätykset'));
          assert.match(await page.locator('.record-estimate').innerText(), /Arvio ~63,3 kg/);
        });

        await run('one 5 x 20 kg set is enough despite incomplete and weaker sets, including after reload', async (page) => {
          const state = core.defaultState(), h = workout('single-best', Date.now() - 1000, [20, 5]);
          h.exercises[0].sets = [
            { done: true, actualReps: '5' },
            { done: true },
            { done: true, actualReps: '0' },
            { done: true, actualReps: '2', actualWeight: '15' },
            { done: false, actualReps: '10', actualWeight: '100' },
          ];
          h.exercises[1].sets.forEach((set) => { delete set.actualReps; });
          h.setsDone = 6; h.setsTotal = 7;
          state.history = [h];
          await seed(page, state);
          const before = await saved(page);
          const rawBefore = await page.evaluate(() => localStorage.getItem('gym-tracker-v1'));
          for (let i = 0; i < 2; i++) {
            await tap(button(page, 'Ennätykset'));
            const bench = recordRow(page, 'Penkkipunnerrus');
            assert.match(await bench.locator('.record-result').innerText(), /20 kg/);
            assert.match(await bench.locator('.record-estimate').innerText(), /Arvio ~23,3 kg/);
            const row = recordRow(page, 'Kulmasoutu');
            assert.match(await row.locator('.record-result').innerText(), /5 kg/);
            assert.equal(await row.locator('.record-estimate').count(), 0);
            assert.doesNotMatch(await page.locator('.record-list').innerText(), /Täydennä|1RM —/);
            assert.deepEqual(await saved(page), before);
            assert.equal(await page.evaluate(() => localStorage.getItem('gym-tracker-v1')), rawBefore);
            if (i === 0) await page.reload();
          }
        });

        await run('completion-only records need no supplementation; history corrections remain optional and preserve the program', async (page) => {
          const state = core.defaultState(), routine = statisticsRoutine();
          routine.exercises = [routine.exercises[0]];
          Object.assign(routine.exercises[0], { sets: 2, reps: '8', weight: '50' });
          delete routine.exercises[0].tracking;
          const s = core.startSession(routine, Date.now() - 3600000);
          s.exercises[0].sets.forEach((set) => { set.done = true; });
          const h = { ...core.summarize(s, Date.now() - 1000), id: 'old-completion' };
          state.history = [...Array.from({ length: 11 }, (_, i) => ({ id: `legacy-${i}`, name: 'Vanha', startedAt: 1000, endedAt: Date.now() - i, setsDone: 1, setsTotal: 1 })), h];
          // Present-day program values must never be used to repair this older snapshot.
          routine.exercises[0].weight = '200'; routine.exercises[0].reps = '1';
          routine.exercises[0].tracking = { sourceId: '', category: '', equipment: '', loadType: 'per-hand', variant: '' }; state.routines = [routine];
          await seed(page, state);
          const before = await saved(page);
          await tap(button(page, 'Ennätykset'));
          assert.match(await page.locator('.record-result').innerText(), /50 kg/);
          assert.equal(await page.locator('.record-estimate').count(), 0);
          assert.equal(await page.locator('[data-action="editrecord"]').count(), 0);
          assert.deepEqual(await saved(page), before, 'viewing weight-only records must not modify history');
          await tap(button(page, 'Harjoituksiin')); await tap(button(page, 'Historia'));
          await tap(page.locator('[data-action="morehistory"]'));
          await tap(page.locator('[data-key="hedit-old-completion"]'));
          assert.equal(await page.locator('h1').innerText(), 'Historia');
          await page.locator('[data-hist="old-completion"] .history-editor').waitFor();
          assert.deepEqual(await saved(page), before, 'opening optional history editing must not modify history');
          const confirm = () => page.locator('[data-key="hconfirm-old-completion-0"]');
          await tapConfirm(confirm(), false);
          assert.deepEqual(await saved(page), before, 'cancelling confirmation must not infer reps');
          await page.evaluate(() => {
            window.originalRecordSetItem = Storage.prototype.setItem;
            Storage.prototype.setItem = function (key, value) {
              if (key === 'gym-tracker-v1') throw new DOMException('quota', 'QuotaExceededError');
              return window.originalRecordSetItem.call(this, key, value);
            };
          });
          await tapConfirm(confirm());
          assert.deepEqual(await saved(page), before, 'failed confirmation must retain the original saved workout');
          await page.evaluate(() => { Storage.prototype.setItem = window.originalRecordSetItem; });
          await tapConfirm(confirm());
          assert.equal((await saved(page)).history.find((x) => x.id === h.id).exercises[0].sets[0].actualReps, '8');
          const menu = page.locator('[data-key="hload-old-completion-0"]');
          await menu.click();
          await page.locator('[data-key="hload-old-completion-0-external"]').check(); await idle(page);
          await page.setViewportSize({ width: 320, height: 740 });
          const result = await new AxeBuilder({ page }).analyze();
          assert.deepEqual(result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })), []);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          const after = await saved(page), expected = structuredClone(before);
          const updated = expected.history.find((x) => x.id === h.id);
          updated.exercises[0].sets.forEach((set) => { set.actualReps = '8'; });
          updated.exercises[0].tracking = { sourceId: '', category: '', equipment: '', loadType: 'external', variant: '' };
          updated.editedAt = after.history.find((x) => x.id === h.id).editedAt;
          assert.deepEqual(after, expected, 'only the explicitly confirmed historical fields may change');
          await tap(button(page, 'Harjoituksiin')); await tap(button(page, 'Ennätykset'));
          assert.match(await page.locator('.record-estimate').innerText(), /Arvio ~63,3 kg/);
          await page.reload(); await tap(button(page, 'Ennätykset'));
          assert.match(await page.locator('.record-estimate').innerText(), /Arvio ~63,3 kg/);
          assert.deepEqual(await saved(page), after);
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
          const before = await saved(page);
          await tap(button(page, 'Historiaan')); await tap(button(page, 'Harjoituksiin')); await tap(button(page, 'Ennätykset'));
          assert.equal(await page.locator('.record-estimate').count(), 2);
          assert.match(await page.locator('.record-list').innerText(), /Arvio ~120 kg/);
          const disclosure = page.locator('.record-session').first();
          await tap(disclosure.locator('summary'));
          assert.match(await disclosure.innerText(), /Vertailutreeni/);
          assert.equal(await disclosure.locator('li').count(), 2);
          assert.deepEqual(await saved(page), before);
        }, { serviceWorkers: 'allow' });
      });
    } finally { await browser.close(); }
  }
} finally { server.kill(); }
