import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as core from '../core.js';
import { chromium, webkit, devices, AxeBuilder, startServer, tap, tapConfirm } from './support.mjs';

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

// A card taller than the usable space is not centered; its next set entry is.
async function centered(page, selector) {
  await page.waitForFunction((selector) => {
    const viewport = window.visualViewport;
    const top = (viewport?.offsetTop ?? 0) + document.querySelector('.session-header').getBoundingClientRect().height + 12;
    const rest = document.getElementById('rest');
    const viewportBottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight);
    const bottom = Math.min(viewportBottom, rest.hidden ? viewportBottom : rest.getBoundingClientRect().top) - 12;
    return [selector, `${selector} .set-entry:has(.set.next)`].some((query) => {
      const element = document.querySelector(query);
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      return rect.top >= top - 2 && rect.bottom <= bottom + 2 && Math.abs((rect.top + rect.bottom) / 2 - (top + bottom) / 2) < 3;
    });
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

        await run('routines are listed compactly and expand on demand with their details and actions', async (p) => {
          await p.goto(url);
          const first = p.locator('.routine-details').first();
          assert.equal(await p.locator('.routine-details').count() >= 1, true);
          assert.equal(await first.evaluate((d) => d.open), false);
          assert.equal(await p.getByRole('button', { name: 'Aloita harjoitus', exact: true }).count(), 0);
          const summary = first.locator('summary');
          assert.equal(await summary.isVisible(), true);
          assert.match(await summary.innerText(), /liikettä/);
          assert.equal((await summary.boundingBox()).height >= 48, true);
          await summary.click();
          assert.equal(await first.evaluate((d) => d.open), true);
          assert.equal(await first.locator('.routine-pills li').count() > 0, true);
          assert.equal(await first.getByRole('button', { name: 'Aloita harjoitus', exact: true }).isVisible(), true);
          assert.equal(await first.getByRole('button', { name: /^Muokkaa: /, exact: false }).isVisible(), true);
          await p.reload();
          assert.equal(await p.locator('.routine-details').first().evaluate((d) => d.open), false);
        });

        await run('workout actions come before the backup reminder without hiding or changing backups', async (p) => {
          await p.goto(url);
          let state;
          for (const scenario of ['new', 'overdue', 'recent', 'resume']) {
            state = core.defaultState();
            if (scenario !== 'new') state.history = [{ id: 'previous', name: 'Edellinen treeni', startedAt: 1000, endedAt: 2000, setsDone: 3, setsTotal: 3 }];
            if (scenario === 'resume') {
              state.session = core.startSession(state.routines[0]);
              core.toggleSet(state.session, 0, 0);
            }
            await p.evaluate(({ state, recent }) => {
              localStorage.setItem('gym-tracker-v1', JSON.stringify(state));
              if (recent) localStorage.setItem('gym-tracker-last-backup', String(Date.now()));
              else localStorage.removeItem('gym-tracker-last-backup');
            }, { state, recent: scenario === 'recent' });
            await p.reload();
            if (state.session) await tap(button(p, 'Takaisin harjoituksiin'));
            const due = ['overdue', 'resume'].includes(scenario);
            assert.equal(await p.locator('.backup').count(), 1);
            assert.equal(await p.locator('.backup.due').count(), due ? 1 : 0);
            assert.equal(await p.locator('.settings .backup').count(), due ? 0 : 1);
            if (!due) await p.locator('.settings summary').click();
            for (const viewport of due ? [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 1280, height: 900 }] : []) {
              await p.setViewportSize(viewport);
              const layout = await p.evaluate((resume) => {
                window.scrollTo(0, 0);
                const action = document.querySelector(resume ? '[data-action="resume"]' : '.routine-details > summary');
                const backup = document.querySelector('.backup');
                const rect = action.getBoundingClientRect();
                return {
                  actionVisible: rect.top >= 0 && rect.bottom <= innerHeight,
                  backupAfterList: backup.getBoundingClientRect().top >= document.querySelector('.routine-list').getBoundingClientRect().bottom,
                  actionBeforeBackup: !!(action.compareDocumentPosition(backup) & Node.DOCUMENT_POSITION_FOLLOWING),
                  overflow: document.documentElement.scrollWidth > innerWidth,
                };
              }, !!state.session);
              assert.deepEqual(layout, { actionVisible: true, backupAfterList: true, actionBeforeBackup: true, overflow: false }, `${scenario} at ${viewport.width}px`);
            }
            assert.deepEqual(await saved(p), state);
          }
          const download = p.waitForEvent('download');
          await tap(button(p, 'Vie varmuuskopio'));
          const parsed = core.parseBackup(await readFile(await (await download).path(), 'utf8'));
          assert.equal(parsed.ok, true);
          assert.deepEqual(parsed.state.history, state.history);
          assert.deepEqual(parsed.state.session, state.session);
          assert.equal(await p.locator('.backup.due').count(), 0);
        });

        await run('quick-start button beside a program name starts it without opening the program', async (p) => {
          await p.goto(url);
          await p.evaluate(() => localStorage.clear());
          await p.reload();
          const quick = p.locator('.quick-start').first();
          const box = await quick.boundingBox();
          assert.ok(box.width >= 44 && box.height >= 44, 'touch target');
          assert.equal(await p.locator('.routine-details[open]').count(), 0);
          await tap(quick);
          const state = await saved(p);
          assert.ok(state.session, 'session started');
          assert.equal(state.session.routineId, state.routines[0].id);
          assert.equal(await p.locator('.session-header').count() > 0, true);
        });

        await run('records page lists the heaviest weight per move and the home tile cycles its period quietly', async (p) => {
          await p.goto(url);
          const day = 86400000, now = Date.now();
          const state = core.defaultState();
          const sets = (w) => [{ done: true, actualWeight: w }];
          state.history = [
            { id: 'r1', name: 'A', startedAt: now - 400 * day, endedAt: now - 400 * day + 1000, setsDone: 1, setsTotal: 1, exercises: [{ name: 'Penkkipunnerrus', sets: sets('70') }] },
            { id: 'r2', name: 'B', startedAt: now - 2000, endedAt: now - 1000, setsDone: 1, setsTotal: 1, exercises: [{ name: 'Penkkipunnerrus', sets: sets('65') }, { name: 'Kyykky', sets: sets('100') }] },
          ];
          await p.evaluate((s) => { localStorage.setItem('gym-tracker-v1', JSON.stringify(s)); localStorage.removeItem('gym-tracker-home-period'); }, state);
          await p.reload();
          const tile = p.locator('.stat-tile');
          const tileText = async () => (await tile.innerText()).replace(/\s+/g, ' ').trim();
          assert.match(await tileText(), /tällä viikolla/);
          await tap(tile); assert.match(await tileText(), /tässä kuussa/);
          await tap(tile); assert.match(await tileText(), /^1 tänä vuonna/);
          await tap(tile); assert.match(await tileText(), /tällä viikolla/);
          await tap(tile);
          await p.reload();
          assert.match(await tileText(), /tässä kuussa/);
          assert.equal(await p.getByText(/vaihtuu|napauta|kuukausi.*vuosi/i).count(), 0);
          for (const width of [320, 390]) {
            await p.setViewportSize({ width, height: 800 });
            assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `overflow at ${width}`);
          }
          await tap(button(p, 'Ennätykset'));
          const rows = (await p.locator('.record-row').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
          assert.equal(rows.length, 2);
          assert.match(rows[0], /^Kyykky 100 kg /);
          assert.match(rows[1], /^Penkkipunnerrus 70 kg /);
          await tap(button(p, 'Harjoituksiin'));
          assert.deepEqual(await saved(p), state);
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
            await centered(p, '.set-entry:has([data-key="s2-18"])');
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
          assert.equal(await p.locator('#exercise-0 .set-entry').first().locator('.rep-adjust b').innerText(), '3');
          await tapConfirm(button(p, 'Lopeta kesken'));
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

        await run('rep controls respect bounds, ranges, keyboard input and timed sets', async (p) => {
          await seedWorkout(p, { setReps: ['1', '8–12', '45 s'], autoRest: false });
          const minus = p.locator('[data-key="reps-minus-0-0"]');
          const plus = p.locator('[data-key="reps-plus-0-0"]');
          await tap(minus);
          assert.equal(await minus.isDisabled(), true);
          assert.equal(await p.locator('[data-key="s0-0"] .set-value').innerText(), '0 toistoa');
          await tap(p.locator('[data-key="reps-minus-0-1"]'));
          assert.equal((await saved(p)).session.exercises[0].sets[1].actualReps, '11');
          assert.equal(await p.locator('#exercise-0 .set-entry').nth(2).locator('.rep-adjust').count(), 0);
          assert.equal(await p.locator('#exercise-0 .set-entry').nth(2).locator('.weight-adjust').count(), 1);
          assert.equal(await p.locator('#exercise-4 .rep-adjust').count(), 0);
          assert.equal(await p.locator('[data-key="s0-2"] .set-value').innerText(), '45 s');
          await plus.focus(); await p.keyboard.press('Space');
          await p.waitForFunction(() => document.getElementById('app').getAttribute('aria-busy') === 'false');
          assert.equal(await plus.evaluate((e) => e === document.activeElement), true);
          assert.equal(await p.locator('[data-key="s0-0"] .set-value').innerText(), '1 toistoa');
          await p.evaluate(() => {
            const plus = document.querySelector('[data-key="reps-plus-0-0"]');
            for (let i = 0; i < 5; i++) plus.click();
          });
          await p.waitForFunction(() => document.getElementById('app').getAttribute('aria-busy') === 'false');
          assert.equal((await saved(p)).session.exercises[0].sets[0].actualReps, '6');
          assert.equal((await saved(p)).session.exercises[0].sets[0].done, false);
        });

        await run('weight controls use the exercise step, keep focus, and return to the plan without leaving an override', async (p) => {
          await seedWorkout(p, { setReps: ['8', '8', '8'], weight: '22,5 kg', autoRest: false });
          const plus = p.locator('[data-key="weight-plus-0-0"]');
          assert.match(await plus.getAttribute('aria-label'), /^Lisää painoa 2 kg: /);
          await plus.focus(); await p.keyboard.press('Space');
          await p.waitForFunction(() => document.getElementById('app').getAttribute('aria-busy') === 'false');
          assert.equal(await plus.evaluate((e) => e === document.activeElement), true);
          assert.equal((await saved(p)).session.exercises[0].sets[0].actualWeight, '24,5');
          assert.equal(await p.locator('[data-key="s0-0"] .set-value').innerText(), '8 x 24,5kg');
          assert.equal(await p.locator('[data-key="s0-0"] .set-planned').innerText(), 'Tavoite: 8 x 22,5kg');
          assert.equal(await p.locator('#exercise-0 .set-entry').first().locator('.weight-adjust b').innerText(), '24,5');
          assert.equal(await p.locator('[data-key="weight-plus-0-1"]').evaluate((e) => e.closest('.set-entry').querySelector('.weight-adjust b').textContent), '22,5');
          await tap(p.locator('[data-key="weight-minus-0-0"]'));
          assert.equal('actualWeight' in (await saved(p)).session.exercises[0].sets[0], false);
          await tap(p.locator('[data-key="weight-minus-0-0"]'));
          assert.equal((await saved(p)).session.exercises[0].sets[0].actualWeight, '20,5');
          assert.equal((await saved(p)).session.exercises[0].weight, '22,5 kg');
          assert.equal((await saved(p)).session.exercises[0].sets[0].done, false);
        });

        await run('tapping a stepper value types an exact weight or rep count without changing the plan', async (p) => {
          const state = await seedWorkout(p, { setReps: ['8', '8', '8'], weight: '100 kg', autoRest: false });
          const weight = p.locator('[data-key="weight-value-0-0"]');
          await weight.click();
          const input = p.locator('input.step-input');
          assert.equal(await input.evaluate((e) => e === document.activeElement), true);
          await input.fill('97,5');
          await p.keyboard.press('Enter');
          await p.waitForFunction(() => document.getElementById('app').getAttribute('aria-busy') === 'false');
          assert.equal((await saved(p)).session.exercises[0].sets[0].actualWeight, '97,5');
          assert.equal(await p.locator('[data-key="s0-0"] .set-value').innerText(), '8 x 97,5kg');
          assert.equal(await p.locator('[data-key="weight-value-0-0"]').evaluate((e) => e === document.activeElement), true);
          await p.locator('[data-key="reps-value-0-1"]').click();
          await p.locator('input.step-input').fill('12');
          await p.locator('h1').click();
          await p.waitForFunction(() => document.getElementById('app').getAttribute('aria-busy') === 'false');
          assert.equal((await saved(p)).session.exercises[0].sets[1].actualReps, '12');
          await p.locator('[data-key="reps-value-0-2"]').click();
          await p.locator('input.step-input').fill('150');
          await p.keyboard.press('Enter');
          await p.waitForFunction(() => document.getElementById('app').getAttribute('aria-busy') === 'false');
          assert.ok(await p.getByRole('alert').first().isVisible());
          assert.equal('actualReps' in (await saved(p)).session.exercises[0].sets[2], false);
          await p.locator('[data-key="weight-value-0-1"]').click();
          await p.locator('input.step-input').fill('555');
          await p.keyboard.press('Escape');
          assert.equal(await p.locator('input.step-input').count(), 0);
          assert.equal('actualWeight' in (await saved(p)).session.exercises[0].sets[1], false);
          assert.deepEqual((await saved(p)).routines, state.routines);
          assert.equal((await saved(p)).session.exercises[0].sets[0].done, false);
        });

        await run('finishing with no logged set says nothing is saved, and keeping the workout changes nothing', async (p) => {
          const state = await seedWorkout(p, { autoRest: false });
          await p.getByRole('button', { name: 'Lopeta kesken', exact: true }).click();
          const dialog = p.getByRole('alertdialog');
          assert.match(await dialog.innerText(), /Yht\u00e4\u00e4n sarjaa ei ole kirjattu.*ei tallenneta historiaan/);
          await dialog.getByRole('button').nth(0).click();
          await dialog.waitFor({ state: 'detached' });
          await p.waitForFunction(() => document.getElementById('app').getAttribute('aria-busy') !== 'true');
          assert.deepEqual(await saved(p), state);
          await tapConfirm(button(p, 'Lopeta kesken'));
          const after = await saved(p);
          assert.equal(after.session, null);
          assert.deepEqual(after.history, []);
        });

        await run('completed workouts can be paged, corrected, shortened, deleted and restored without touching legacy data', async (p) => {
          const state = core.defaultState();
          const session = core.startSession(state.routines[0], 1000);
          session.exercises[0].weight = '60 kg';
          session.exercises.forEach((e) => e.sets.forEach((set) => { set.done = true; }));
          const full = { ...core.summarize(session, 1000 + 90 * 60000), id: 'full' };
          const legacy = Array.from({ length: 12 }, (_, i) => ({ id: `legacy-${i}`, name: `Vanha ${i}`, startedAt: 0, endedAt: Date.UTC(2020, 0, 1 + i), setsDone: 3, setsTotal: 3 }));
          state.history = [full, ...legacy];
          await p.goto(url);
          await p.evaluate((value) => localStorage.setItem('gym-tracker-v1', JSON.stringify(value)), state);
          await p.reload();
          const idle = () => p.waitForFunction(() => document.getElementById('app').getAttribute('aria-busy') === 'false');

          assert.equal(await p.locator('.hist').count(), 10);
          assert.match(await p.locator('[data-hist="legacy-0"] .muted').first().innerText(), /2020/);
          await tap(p.locator('[data-key="morehistory"]'));
          assert.equal(await p.locator('.hist').count(), 13);
          assert.equal(await p.locator('[data-key="morehistory"]').count(), 0);

          await tap(p.locator('[data-key="hedit-full"]'));
          const reps = p.locator('[data-key="hr-0-0"]');
          await reps.fill('150'); await p.keyboard.press('Tab'); await idle();
          assert.ok(await p.getByRole('alert').first().isVisible());
          assert.equal((await saved(p)).history[0].exercises[0].sets[0].actualReps, undefined);
          await p.locator('[data-key="hr-0-0"]').fill('9'); await p.keyboard.press('Tab'); await idle();
          let after = await saved(p);
          assert.equal(after.history[0].exercises[0].sets[0].actualReps, '9');
          assert.ok(after.history[0].editedAt > 0);
          await p.locator('[data-key="hd-0-1"]').evaluate((e) => e.click()); await idle();
          assert.equal((await saved(p)).history[0].setsDone, full.setsTotal - 1);
          await p.locator('[data-key="hdur-full"]').fill('120'); await p.keyboard.press('Tab'); await idle();
          assert.equal((await saved(p)).history[0].endedAt - full.startedAt, 90 * 60000);
          await p.locator('[data-key="hdur-full"]').fill('45'); await p.keyboard.press('Tab'); await idle();
          assert.equal((await saved(p)).history[0].endedAt - full.startedAt, 45 * 60000);
          await tap(p.locator('[data-key="hedit-full"]'));
          assert.match(await p.locator('[data-hist="full"]').innerText(), /muokattu/);

          // Legacy summary-only entries only offer a duration-free delete.
          await tap(p.locator('[data-key="hedit-legacy-0"]'));
          assert.equal(await p.locator('[data-hist="legacy-0"] input').count(), 0);
          await tap(p.locator('[data-key="hedit-legacy-0"]'));

          const before = (await saved(p)).history;
          await tapConfirm(p.locator('[data-key="hdel-full"]'), false);
          assert.deepEqual((await saved(p)).history, before);
          await tapConfirm(p.locator('[data-key="hdel-full"]'));
          assert.equal((await saved(p)).history.some((h) => h.id === 'full'), false);
          assert.equal((await saved(p)).history.length, 12);
          await tap(p.locator('[data-key="undodelete"]'));
          assert.deepEqual((await saved(p)).history, before);
          assert.equal((await saved(p)).history[0].id, 'full');

          const results = await new AxeBuilder({ page: p }).analyze();
          assert.deepEqual(results.violations.map((v) => v.id), []);
        });

        await run('the previous result of each movement is shown, and unknown values stay unknown', async (p) => {
          const state = core.defaultState();
          const session = core.startSession(state.routines[0]);
          session.exercises[0].weight = '80 kg';
          session.exercises[0].sets[0].done = true;
          session.exercises[0].sets[0].actualReps = '6';
          session.exercises[0].sets[1].done = true;
          session.exercises[0].sets[1].actualWeight = '82,5';
          state.history = [{ ...core.summarize(session, 5000), startedAt: 1000 }];
          state.session = core.startSession(state.routines[0]);
          await p.goto(url);
          await p.evaluate((value) => localStorage.setItem('gym-tracker-v1', JSON.stringify(value)), state);
          await p.reload();
          await p.locator('.ex.current').waitFor();
          assert.match(await p.locator('#exercise-0 .last-time').innerText(), /^Viimeksi .*: 6 × 80 kg \/ 5 × 82,5 kg$/);
          assert.equal(await p.locator('#exercise-1 .last-time').count(), 0);
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
          assert.match(await p.locator('.routine').last().textContent(), /5 \/ 8 \/ 12/);
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
          if (await p.locator('.settings:not([open]) summary').count()) await p.locator('.settings summary').click();
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
                assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('.per-set-toggle input, .set-targets input, .set, .rep-adjust button, .weight-adjust button')].filter((e) => {
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