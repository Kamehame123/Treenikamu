import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, webkit, devices, AxeBuilder, startServer, tap, tapConfirm } from './support.mjs';
import * as core from '../core.js';
import { buildResult, resultFields, wodTitle } from '../wod.js';
import { RECORD_CHEERS } from '../cheers.js';
import { TEMPLATES, DEFAULT_WARMUP, templateById, templateRoutine } from '../wod-templates.js';

const { server, url } = await startServer();
const DAY = 86400000;
const button = (p, name) => p.getByRole('button', { name, exact: true });
const saved = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('gym-tracker-v1')));
const focused = (locator) => locator.evaluate((e) => e === document.activeElement);
const values = (locator) => locator.evaluateAll((elements) => elements.map((e) => e.value));
const idle = (p) => p.waitForFunction(() => document.getElementById('app').getAttribute('aria-busy') !== 'true');
const live = (p, pattern) => p.waitForFunction((source) => new RegExp(source).test(document.getElementById('live').textContent), pattern.source);
const program = (id) => core.sanitizeRoutine(templateRoutine(templateById(id), 'women'));
// A finished workout from a template with the given WOD result, as history keeps it.
function finished(id, fields, at) {
  const s = core.startSession(program(id), at - 1800000), w = s.wods[0];
  const built = buildResult(w, { ...resultFields(w), ...fields });
  assert.equal(built.ok, true, built.error);
  w.result = built.result; w.division = built.result.division;
  return core.summarize(s, at);
}
// Saves programs made from templates with the given history and opens the home screen with every program expanded.
async function openHome(p, ids, history = []) {
  const state = core.defaultState();
  state.settings.autoRest = false;
  state.routines = ids.map((id) => program(id));
  state.history = history;
  await p.evaluate((value) => localStorage.setItem('gym-tracker-v1', JSON.stringify(value)), state);
  await p.reload();
  await p.evaluate(() => document.querySelectorAll('details.routine-details').forEach((d) => { d.open = true; }));
  return state;
}
// Saves programs made from templates with the given history, then starts the first program.
async function startProgram(p, ids, history = []) {
  const state = core.defaultState();
  state.settings.autoRest = false;
  state.routines = ids.map((id) => program(id));
  state.history = history;
  await p.evaluate((value) => localStorage.setItem('gym-tracker-v1', JSON.stringify(value)), state);
  await p.reload();
  await tap(button(p, `Aloita: ${state.routines[0].name}`));
  await p.locator('.wod-card').first().waitFor();
}
// Freezes the page clock a second ahead, so a test moves time only with clock.runFor.
async function fakeTime(p) {
  const now = new Date();
  await p.clock.install({ time: now });
  await p.clock.pauseAt(new Date(now.getTime() + 1000));
}
// Opens a workout whose first WOD clock started `ago` ms ago (and is paused right now when asked), at the clock screen.
async function seedClock(p, id, { ago, laps = [], paused = false, edit }) {
  const now = Date.now(), state = core.defaultState();
  state.settings.autoRest = false;
  state.routines = [program(id)];
  const s = core.startSession(state.routines[0], now - ago - 60000), w = s.wods[0];
  edit?.(w);
  w.clock = { startedAt: now - ago, pausedAt: paused ? now : null, pausedMs: 0, laps };
  state.session = s;
  await p.evaluate((value) => localStorage.setItem('gym-tracker-v1', JSON.stringify(value)), state);
  await p.reload();
}
// Opens the in-app confirmation and answers it; returns the question and the accept button's text.
async function answer(locator, accept) {
  const p = locator.page(), dialog = p.getByRole('alertdialog');
  await locator.click();
  const asked = [await dialog.locator('#confirm-text').textContent(), await dialog.getByRole('button').nth(1).textContent()];
  await dialog.getByRole('button').nth(accept ? 1 : 0).click();
  await dialog.waitFor({ state: 'detached' });
  await idle(p);
  return asked;
}
// The top of an element relative to the viewport, as a share of its height.
const viewportTop = (locator) => locator.evaluate((e) => e.getBoundingClientRect().top / innerHeight);
async function newFunctional(p) {
  await tap(button(p, 'Luo treeniohjelma'));
  assert.equal(await p.locator('h1').innerText(), 'Millainen ohjelma?');
  await tap(button(p, 'Toiminnallinen treeni'));
  await p.locator('.wod-edit').waitFor();
}
async function audit(p, label, { known = '' } = {}) {
  await p.waitForTimeout(350);
  const violations = (await new AxeBuilder({ page: p }).analyze()).violations;
  assert.deepEqual(violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })), [], `${label}: axe`);
  assert.deepEqual(await p.evaluate((known) => [...document.querySelectorAll('button, input, select, summary, a:not(.sr)')].filter((e) => {
    const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 47.9 || r.height < 47.9) && !(known && e.matches(known));
  }).map((e) => e.outerHTML.slice(0, 100)), known), [], `${label}: 48 px touch targets`);
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${label}: no horizontal overflow`);
}
// One fresh browser context per run; any page error fails the run.
const runner = (t, browser, device) => async (title, fn, { timeout = 40000, ...options } = {}) => t.test(title, { timeout }, async () => {
  const context = await browser.newContext({ ...devices[device], serviceWorkers: 'block', ...options });
  const page = await context.newPage(); page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try { await page.goto(url); await fn(page); assert.deepEqual(errors, []); } finally { await context.close(); }
});

try {
  for (const [engine, type, device] of [['chromium', chromium, 'Pixel 7'], ['webkit', webkit, 'iPhone 14']]) {
    const browser = await type.launch();
    try {
      await test(`${engine}: functional program editor`, async (t) => {
        const run = runner(t, browser, device);

        await run('typing, formats, rep schemes and movement order build the saved WOD', async (p) => {
          await newFunctional(p);
          await p.locator('[data-f="rname"]').fill('Perjantain WOD');
          const name = p.locator('[data-mf="name"]').first();
          await name.evaluate((e) => { e.dataset.probe = 'kept'; });
          await name.pressSequentially('Yleisliike');
          assert.equal(await p.evaluate(() => document.activeElement?.dataset.probe), 'kept', 'typing keeps the same focused field');
          await p.locator('[data-mf="amount"]').first().fill('10');
          assert.match(await p.locator('#wod-board-0').innerText(), /AMRAP 12 min[\s\S]*10 Yleisliike/);

          await p.locator('[data-wf="format"][value="fortime"]').check();
          const rounds = p.locator('#wrounds-field-0'), chip = p.locator('#wscheme-chips-0 .chip', { hasText: /^21-15-9$/ });
          assert.equal(await rounds.isVisible(), true);
          await tap(chip);
          assert.equal(await chip.getAttribute('aria-pressed'), 'true');
          assert.equal(await rounds.isVisible(), false, 'a rep scheme sets the rounds');
          assert.equal(await p.locator('[data-wf="scheme"]').inputValue(), '21-15-9');
          assert.match(await p.locator('#wod-board-0').innerText(), /21-15-9 aikaa vastaan/);
          await tap(chip);
          assert.equal(await chip.getAttribute('aria-pressed'), 'false');
          assert.equal(await rounds.isVisible(), true);
          await p.locator('[data-wf="scheme"]').pressSequentially('21-15-9');
          assert.equal(await chip.getAttribute('aria-pressed'), 'true', 'a typed scheme marks its chip');
          assert.equal(await rounds.isVisible(), false);
          assert.equal(await focused(p.locator('[data-wf="scheme"]')), true);

          await tap(button(p, 'Lisää liike (WOD)'));
          assert.equal(await focused(p.locator('[data-mf="name"]').nth(1)), true, 'a new movement focuses its name');
          await p.locator('[data-mf="name"]').nth(1).fill('Leuanveto');
          await tap(button(p, 'Siirrä liike 2 ylös (WOD)'));
          assert.deepEqual(await values(p.locator('[data-mf="name"]')), ['Leuanveto', 'Yleisliike']);
          await tap(button(p, 'Lisää liike (WOD)'));
          await p.locator('[data-mf="name"]').nth(2).fill('Poistettava');
          await tap(button(p, 'Poista liike 3 (WOD)'));
          assert.deepEqual(await values(p.locator('[data-mf="name"]')), ['Leuanveto', 'Yleisliike']);
          assert.equal(await focused(button(p, 'Lisää liike (WOD)')), true);

          await tap(button(p, 'Tallenna harjoitus'));
          const routine = (await saved(p)).routines.find((r) => r.name === 'Perjantain WOD');
          assert.equal(routine.type, 'functional');
          assert.deepEqual(routine.exercises, []);
          assert.deepEqual({ format: routine.wods[0].format, scheme: routine.wods[0].scheme, rounds: routine.wods[0].rounds }, { format: 'fortime', scheme: '21-15-9', rounds: 3 });
          assert.deepEqual(routine.wods[0].movements.map((m) => [m.name, m.amount]), [['Leuanveto', ''], ['Yleisliike', '10']]);

          await tap(button(p, 'Muokkaa: Perjantain WOD'));
          assert.equal(await p.locator('[data-wf="scheme"]').inputValue(), '21-15-9');
          await tap(button(p, 'Peruuta'));
          assert.equal(await p.getByRole('alertdialog').count(), 0, 'an unchanged saved program closes without asking');
          assert.equal(await p.locator('.wod-edit').count(), 0);
        });

        await run('the library names WOD movements, keeps amounts and returns to the right place', async (p) => {
          await newFunctional(p);
          await p.locator('[data-f="rname"]').fill('Kirjasto-WOD');
          await tap(button(p, 'Lisää kirjastosta (WOD)'));
          assert.match(await p.locator('.library-top').innerText(), /Valitse WOD-osaan lisättävä liike\./);
          await p.locator('#exercise-search').fill('kahvakuulaheilautus');
          await tap(p.locator('[data-id="lib-kahvakuulaheilautus"]'));
          assert.deepEqual(await values(p.locator('[data-mf="name"]')), ['Kahvakuulaheilautus'], 'the empty movement is filled, not a new one added');
          assert.equal(await focused(p.locator('[data-mf="amount"]').first()), true);
          await p.locator('[data-mf="amount"]').first().fill('15');

          await tap(button(p, 'Lisää kirjastosta (WOD)'));
          await p.locator('#exercise-search').fill('yleisliike');
          await tap(p.locator('[data-id="lib-yleisliike"]'));
          assert.deepEqual(await values(p.locator('[data-mf="name"]')), ['Kahvakuulaheilautus', 'Yleisliike']);

          await tap(button(p, 'Valitse kirjastosta').first());
          assert.match(await p.locator('.library-top').innerText(), /Valitse liike tähän kohtaan\. Määrä ja kuorma säilyvät\./);
          await tap(button(p, 'Takaisin harjoitukseen'));
          assert.equal(await focused(button(p, 'Valitse kirjastosta').first()), true, 'back returns to the movement it came from');
          await tap(button(p, 'Valitse kirjastosta').first());
          await p.locator('#exercise-search').fill('yleisliike laatikon yli');
          await tap(p.locator('[data-id="lib-yleisliike-laatikon-yli"]'));
          assert.deepEqual(await values(p.locator('[data-mf="name"]')), ['Yleisliike laatikon yli', 'Yleisliike']);
          assert.equal(await p.locator('[data-mf="amount"]').first().inputValue(), '15', 'replacing keeps the amount');

          await tap(button(p, 'Lisää kirjastosta (WOD)'));
          await p.locator('.custom-exercise > summary').click();
          await p.locator('[data-custom="name"]').fill('Renkaankääntö');
          for (const [id, value] of [['custom-category', 'Selkä'], ['custom-equipment', 'Talja']]) {
            await p.locator(`#${id} summary`).click();
            await p.locator(`#${id} input[value="${value}"]`).check();
          }
          await tap(button(p, 'Tallenna ja lisää WOD-osaan'));
          assert.deepEqual(await values(p.locator('[data-mf="name"]')), ['Yleisliike laatikon yli', 'Yleisliike', 'Renkaankääntö']);
          await p.locator('[data-mf="name"]').nth(1).fill('Oma yleisliike');

          await tap(button(p, 'Tallenna harjoitus'));
          const state = await saved(p);
          const own = state.customExercises.find((e) => e.name === 'Renkaankääntö');
          const moves = state.routines.find((r) => r.name === 'Kirjasto-WOD').wods[0].movements;
          assert.deepEqual(moves.map((m) => [m.name, m.amount, m.sourceId ?? null]), [
            ['Yleisliike laatikon yli', '15', 'lib-yleisliike-laatikon-yli'],
            ['Oma yleisliike', '', null],
            ['Renkaankääntö', '', own.id],
          ], 'a retyped name forgets its library movement');
        });

        await run('warm-up, cool-down and extra WOD parts are added and removed safely', async (p) => {
          await newFunctional(p);
          await tap(button(p, 'Lisää lämmittely'));
          const text = p.locator('[data-key="btext-warmup"]');
          assert.equal(await focused(text), true);
          assert.notEqual(await text.inputValue(), '', 'the warm-up starts from a suggestion');
          await tap(button(p, 'Poista lämmittely'));
          assert.equal(await focused(button(p, 'Lisää lämmittely')), true);
          await tap(button(p, 'Lisää loppuverryttely'));
          assert.equal(await focused(p.locator('[data-key="btext-cooldown"]')), true);

          await tap(button(p, 'Lisää WOD-osa'));
          assert.deepEqual(await p.locator('.wod-title').allInnerTexts(), ['WOD 1', 'WOD 2']);
          assert.equal(await focused(p.locator('[data-w="1"][data-wf="format"]:checked')), true, 'a new part starts at its format');
          await p.locator('[data-mf="name"][data-w="1"]').fill('Soutu');
          await tapConfirm(button(p, 'Poista WOD 2'), false);
          assert.equal(await p.locator('.wod-edit').count(), 2, 'cancelling keeps the part');
          await tapConfirm(button(p, 'Poista WOD 2'));
          assert.deepEqual(await p.locator('.wod-title').allInnerTexts(), ['WOD']);
          assert.equal(await focused(button(p, 'Lisää WOD-osa')), true);

          await tap(button(p, 'Lisää WOD-osa')); await tap(button(p, 'Lisää WOD-osa'));
          assert.equal(await p.locator('.wod-edit').count(), 3);
          assert.equal(await button(p, 'Lisää WOD-osa').count(), 0, 'at most three parts');
          await tap(button(p, 'Poista WOD 3'));
          assert.equal(await p.getByRole('alertdialog').count(), 0, 'an empty part is removed without asking');
          assert.deepEqual(await p.locator('.wod-title').allInnerTexts(), ['WOD 1', 'WOD 2']);
        });

        await run('validation names the WOD movement and the draft survives a reload', async (p) => {
          await newFunctional(p);
          await tap(button(p, 'Tallenna harjoitus'));
          const error = p.locator('#err');
          assert.match(await error.innerText(), /Anna harjoitukselle nimi\.[\s\S]*WOD, liike 1: lisää nimi\./);
          assert.equal(await focused(error), true);

          await p.locator('[data-f="rname"]').fill('Luonnos-WOD');
          await p.locator('[data-mf="name"]').first().fill('Punnerrus');
          await p.locator('.move-scaled > summary').first().click();
          await p.locator('[data-mf="sname"]').first().fill('Polvipunnerrus');
          assert.equal(await p.locator('#mscaled-sum-0-0').innerText(), 'Polvipunnerrus', 'the summary follows typing');
          await p.locator('[data-wf="format"][value="emom"]').check();
          await p.locator('[data-wf="alternate"]').check();
          assert.equal(await p.locator('.move-scaled').first().evaluate((e) => e.open), true, 'the scaled panel stays open across a format change');

          await p.reload();
          await p.locator('.wod-edit').waitFor();
          assert.equal(await p.locator('[data-f="rname"]').inputValue(), 'Luonnos-WOD');
          assert.equal(await p.locator('[data-mf="name"]').first().inputValue(), 'Punnerrus');
          assert.equal(await p.locator('[data-mf="sname"]').first().inputValue(), 'Polvipunnerrus');
          assert.equal(await p.locator('[data-wf="format"][value="emom"]').isChecked(), true);
          assert.equal(await p.locator('[data-wf="alternate"]').isChecked(), true);

          await tap(button(p, 'Tallenna harjoitus'));
          const wod = (await saved(p)).routines.find((r) => r.name === 'Luonnos-WOD').wods[0];
          assert.deepEqual({ format: wod.format, alternate: wod.alternate, scaled: wod.movements[0].scaled }, { format: 'emom', alternate: true, scaled: { name: 'Polvipunnerrus', amount: '', load: '' } });
        });

        await run('the gallery opens a template with the remembered loads, ready to save', async (p) => {
          const group = (name) => p.getByRole('group', { name: 'Mallien ryhmä' }).getByRole('button', { name, exact: true });
          const loads = (name) => p.getByRole('group', { name: 'Ehdotetut kuormat' }).getByRole('button', { name, exact: true });
          const card = (name) => p.locator('.template-card', { has: p.getByRole('heading', { name, exact: true }) });
          const openGallery = async () => {
            await tap(button(p, 'Luo treeniohjelma'));
            await tap(button(p, 'Aloita mallista'));
            assert.equal(await p.locator('h1').innerText(), 'Valitse malli');
          };
          await openGallery();
          assert.equal(await focused(p.locator('h1')), true);
          assert.equal(await group('Formaatit').getAttribute('aria-pressed'), 'true');
          assert.equal(await loads('Naiset').getAttribute('aria-pressed'), 'true', "women's loads by default");
          assert.equal(await p.locator('.template-card').count(), TEMPLATES.filter((t) => t.group === 'format').length);

          await tap(group('Vertailutreenit'));
          assert.equal(await group('Vertailutreenit').getAttribute('aria-pressed'), 'true');
          assert.equal(await focused(group('Vertailutreenit')), true, 'focus stays on the chosen group');
          assert.equal(await p.locator('.template-card').count(), TEMPLATES.filter((t) => t.group === 'benchmark').length);
          assert.match(await card('Fran').innerText(), /Kyykkypunnerrus tangolla \(29 kg\)/);
          await tap(loads('Miehet'));
          assert.match(await card('Fran').innerText(), /Kyykkypunnerrus tangolla \(43 kg\)/);
          assert.equal(await focused(loads('Miehet')), true);
          assert.equal(await p.evaluate(() => localStorage.getItem('gym-tracker-template-loads')), 'men');

          await tap(button(p, 'Takaisin'));
          assert.equal(await p.locator('h1').innerText(), 'Millainen ohjelma?');
          assert.equal(await focused(button(p, 'Aloita mallista')), true, 'back returns to the gallery choice');
          await p.reload();
          await openGallery();
          assert.equal(await loads('Miehet').getAttribute('aria-pressed'), 'true', 'the load choice is remembered');
          await tap(loads('Naiset'));
          await tap(group('Vertailutreenit'));

          const expected = templateRoutine(templateById('fran'), 'women');
          const moves = expected.wods[0].movements;
          await tap(button(p, 'Käytä mallia Fran'));
          await p.locator('.wod-edit').waitFor();
          assert.equal(await p.locator('h1').innerText(), 'Uusi harjoitus');
          assert.equal(await p.locator('[data-f="rname"]').inputValue(), 'Fran');
          assert.equal(await p.locator('[data-wf="format"][value="fortime"]').isChecked(), true);
          assert.deepEqual([await p.locator('[data-wf="scheme"]').inputValue(), await p.locator('[data-wf="minutes"]').inputValue()], ['21-15-9', '10']);
          assert.deepEqual(await values(p.locator('[data-mf="name"]')), moves.map((m) => m.name));
          assert.deepEqual(await values(p.locator('[data-mf="load"]')), moves.map((m) => m.load ?? ''));
          assert.deepEqual(await values(p.locator('[data-mf="sname"]')), moves.map((m) => m.scaled?.name ?? ''));
          assert.deepEqual(await values(p.locator('[data-mf="sload"]')), moves.map((m) => m.scaled?.load ?? ''));
          assert.equal(await p.locator('[data-key="btext-warmup"]').inputValue(), DEFAULT_WARMUP.text);
          assert.equal(await p.locator('[data-key="btext-cooldown"]').count(), 1);
          await tap(button(p, 'Peruuta'));
          assert.equal(await p.getByRole('alertdialog').count(), 0, 'an untouched template closes without asking');
          assert.equal(await p.locator('.wod-edit').count(), 0);

          await openGallery();
          assert.equal(await group('Vertailutreenit').getAttribute('aria-pressed'), 'true', 'the gallery reopens on the group the user last chose');
          await tap(group('Formaatit'));
          await tap(button(p, 'Käytä mallia Kokonainen tunti'));
          assert.deepEqual([await p.locator('[data-f="name"]').inputValue(), await p.locator('[data-f="sets"]').inputValue(), await p.locator('[data-f="reps"]').inputValue()], ['Takakyykky', '5', '5'], 'the strength part opens as exercise rows');
          await p.locator('[data-f="rname"]').fill('Torstain tunti');
          await tapConfirm(button(p, 'Peruuta'), false);
          assert.equal(await p.locator('.wod-edit').count(), 1, 'a changed template asks before it is discarded');
          assert.equal(await p.locator('[data-f="rname"]').inputValue(), 'Torstain tunti');
          await tap(button(p, 'Tallenna harjoitus'));
          const routine = (await saved(p)).routines.find((r) => r.name === 'Torstain tunti');
          assert.equal(routine.type, 'functional');
          assert.deepEqual(routine.exercises.map((e) => [e.name, e.sets, e.reps, e.tracking.sourceId]), [['Takakyykky', 5, '5', 'lib-takakyykky']]);
          assert.deepEqual({ format: routine.wods[0].format, minutes: routine.wods[0].minutes, template: routine.wods[0].template }, { format: 'amrap', minutes: 12, template: 'tunti' });
          assert.deepEqual(routine.wods[0].movements.map((m) => m.sourceId), ['lib-soutulaite', 'lib-kahvakuulaheilautus', 'lib-etunojapunnerrus']);
          assert.deepEqual([routine.warmup.minutes, routine.cooldown.minutes], [12, 8]);
        });

        await run('the chooser, the gallery and a filled editor pass accessibility, touch-size and overflow checks in Dark and Aurora', async (p) => {
          const galleryAudit = async (theme) => {
            await tap(button(p, 'Aloita mallista'));
            for (const width of [390, 320]) {
              await p.setViewportSize({ width, height: 844 });
              await audit(p, `${theme} gallery ${width}`);
            }
            await tap(button(p, 'Vertailutreenit'));
            await audit(p, `${theme} benchmarks 320`);
            await p.setViewportSize(devices[device].viewport);
            await tap(button(p, 'Takaisin'));
          };
          await tap(button(p, 'Luo treeniohjelma'));
          await audit(p, 'dark chooser');
          await galleryAudit('dark');
          await tap(button(p, 'Toiminnallinen treeni'));
          await p.locator('[data-f="rname"]').fill('Teema-WOD');
          await tap(button(p, 'Lisää lämmittely'));
          await tap(button(p, 'Lisää loppuverryttely'));
          await p.locator('[data-mf="name"]').first().fill('Yleisliike');
          await p.locator('[data-mf="amount"]').first().fill('10');
          await p.locator('[data-wf="format"][value="fortime"]').check();
          await tap(p.locator('#wscheme-chips-0 .chip', { hasText: /^21-15-9$/ }));
          for (const theme of ['dark', 'aurora']) {
            if (theme === 'aurora') {
              await p.evaluate(() => localStorage.setItem('gym-tracker-appearance-v1', 'aurora'));
              await p.reload();
              await p.locator('.wod-edit').waitFor();
            }
            assert.equal(await p.evaluate(() => document.documentElement.dataset.theme), theme);
            const scaled = p.locator('.move-scaled').first();
            if (!(await scaled.evaluate((e) => e.open))) await scaled.locator('summary').click();
            assert.equal(await p.locator('#wscheme-chips-0 .chip[aria-pressed="true"]').innerText(), '21-15-9');
            for (const width of [390, 320]) {
              await p.setViewportSize({ width, height: 844 });
              await audit(p, `${theme} editor ${width}`);
            }
            await p.setViewportSize(devices[device].viewport);
          }
          await tapConfirm(button(p, 'Peruuta'));
          await p.locator('.wod-edit').waitFor({ state: 'detached' });
          await tap(button(p, 'Luo treeniohjelma'));
          await audit(p, 'aurora chooser');
          await galleryAudit('aurora');
        }, { bypassCSP: true, timeout: 120000 });
      });

      await test(`${engine}: functional home, variants, history and records`, async (t) => {
        const run = runner(t, browser, device);

        await run('the home card shows what the program holds, and variants only appear when there is strength work', async (p) => {
          const now = Date.now();
          await openHome(p, ['fran', 'tunti'], [finished('fran', { min: '4', sec: '30' }, now - 2 * DAY)]);
          const [fran, tunti] = [p.locator('.routine').nth(0), p.locator('.routine').nth(1)];
          assert.equal(await fran.locator('.routine-meta .badge').textContent(), 'Toiminnallinen');
          assert.match(await fran.locator('.routine-meta').innerText(), /1\s+WOD/);
          assert.equal(await fran.locator('.routine-pills .pill').first().textContent(), 'Fran 21-15-9 aikaa vastaan · aikaraja 10 min');
          assert.match(await fran.locator('.routine-last').textContent(), /^Edellinen tulos Fran 4:30 · Rx \(\d{1,2}\.\d{1,2}\.\)$/);
          assert.equal(await fran.locator('.routine-variants').count(), 0, 'a WOD-only program has nothing to lighten or boost');
          assert.equal(await fran.locator('.progression-controls').count(), 0, 'and no sets to progress');
          assert.equal(await tunti.locator('.routine-last').count(), 0);
          assert.equal(await tunti.locator('.routine-variants .btn').count(), 2);
          assert.equal(await tunti.locator('.progression-controls').count(), 1);
          assert.match(await tunti.locator('.variant-light .variant-note').textContent(), /^Voima -15 %, WOD skaalattuna$/);
          assert.match(await tunti.locator('.routine-pills').innerText(), /AMRAP 12 min[\s\S]*Takakyykky\s+5×5/);
        });

        await run('Kevennetty starts the WOD as Skaalattu and Super adds a set to the strength part only', async (p) => {
          const state = await openHome(p, ['tunti']);
          const name = state.routines[0].name;
          await tap(button(p, `Kevennetty Voima -15 %, WOD skaalattuna: ${name}`));
          assert.equal(await button(p, 'Skaalattu').getAttribute('aria-pressed'), 'true', 'the WOD starts in the easier version');
          assert.equal((await saved(p)).session.wods[0].division, 'scaled');
          assert.match(await p.locator('.notice').textContent(), /^Kevennetty treeni: voimaosan toistot ja painot ovat noin 15 % pienemmät ja WOD on valmiiksi Skaalattu-versiolla\./);
          assert.equal(await p.locator('.session-stat').textContent(), '0/5\u00a0sarjaa · 0/1\u00a0WOD · 0%');
          await tapConfirm(p.locator('[data-action="finish"]'));
          await p.evaluate(() => document.querySelectorAll('details.routine-details').forEach((d) => { d.open = true; }));
          await tap(button(p, `Super Lisäsarja liikkeisiin: ${name}`));
          assert.equal(await p.locator('.session-stat').textContent(), '0/6\u00a0sarjaa · 0/1\u00a0WOD · 0%', 'one more set, and the WOD is untouched');
          assert.equal((await saved(p)).session.wods[0].division, 'rx');
          assert.equal(await p.locator('.notice').count(), 0);
        });

        await run('history shows WOD results and boards, corrects scores, and records follow the corrections', async (p) => {
          const now = Date.now();
          await openHome(p, ['fran', 'tunti'], [
            finished('tunti', { rounds: '5', reps: '12' }, now - DAY),
            finished('fran', { min: '4', sec: '30' }, now - 2 * DAY),
          ]);
          await tap(button(p, 'Historia'));
          const item = (name) => p.locator('.history-list > li').filter({ has: p.getByRole('heading', { name, exact: true }) });
          assert.equal(await item('Fran').locator('.history-sets').textContent(), '1/1 WOD');
          assert.equal(await item('Fran').locator('.history-wods li').textContent(), 'Fran 4:30 · Rx');
          assert.equal(await item('Kokonainen tunti').locator('.history-sets').textContent(), '0/5 sarjaa', 'sets lead when there are sets');
          assert.equal(await item('Kokonainen tunti').locator('.history-wods li').textContent(), 'AMRAP 12 min 5 + 12 · Rx');
          await item('Fran').locator('details.history-log summary').click();
          assert.match(await item('Fran').locator('.board-lines').innerText(), /21-15-9 aikaa vastaan/);

          await tap(item('Fran').locator('[data-action="edithistory"]'));
          const wod = item('Fran'), field = (name) => wod.locator(`[data-hwod="${name}"]`);
          const savedSeconds = async () => (await saved(p)).history.find((h) => h.name === 'Fran').wods[0].result.seconds;
          assert.deepEqual(await values(wod.locator('[data-hwod="min"], [data-hwod="sec"]')), ['4', '30']);
          await field('sec').fill('99');
          await field('sec').press('Tab');
          await p.locator('[role="alert"]').waitFor();
          assert.match(await p.locator('[role="alert"]').textContent(), /^Anna aika minuutteina ja sekunteina/);
          assert.equal(await savedSeconds(), 270, 'a bad value changes nothing');
          assert.deepEqual(await values(wod.locator('[data-hwod="min"], [data-hwod="sec"]')), ['4', '30'], 'the field shows the saved value again');

          await field('sec').fill('10');
          await field('sec').press('Tab');
          await p.waitForFunction(() => JSON.parse(localStorage.getItem('gym-tracker-v1')).history.some((h) => h.name === 'Fran' && h.wods[0].result.seconds === 250));
          assert.equal(await p.locator('[role="alert"]').count(), 0);
          assert.equal(await p.locator('.history-wods li').first().isVisible(), true);
          await wod.locator('[data-hwod="division"][value="scaled"]').check();
          await p.waitForFunction(() => JSON.parse(localStorage.getItem('gym-tracker-v1')).history.some((h) => h.name === 'Fran' && h.wods[0].result.division === 'scaled'));
          await field('notes').fill('Kevyt');
          await field('notes').press('Tab');
          await p.waitForFunction(() => JSON.parse(localStorage.getItem('gym-tracker-v1')).history.some((h) => h.name === 'Fran' && h.wods[0].result.notes === 'Kevyt'));
          const edited = (await saved(p)).history.find((h) => h.name === 'Fran');
          assert.deepEqual(edited.wods[0].result, { kind: 'time', seconds: 250, division: 'scaled', notes: 'Kevyt' });
          assert.ok(edited.editedAt > 0, 'the entry is marked as edited');
          await tap(item('Fran').locator('[data-action="edithistory"]'));
          assert.equal(await item('Fran').locator('.history-wods li').textContent(), 'Fran 4:10 · Skaalattu · Kevyt');
          assert.match(await item('Fran').locator('.muted').first().textContent(), /muokattu/);

          await tap(button(p, 'Harjoituksiin'));
          await p.evaluate(() => document.querySelectorAll('details.routine-details').forEach((d) => { d.open = true; }));
          assert.match(await p.locator('.routine-last').first().textContent(), /Fran 4:10 · Skaalattu/);
          await tap(button(p, 'Ennätykset'));
          const rows = p.locator('.wod-record-list .record-row');
          assert.equal(await rows.count(), 2);
          const fran = rows.filter({ hasText: 'Fran' });
          assert.match(await fran.innerText(), /1 kirjaus[\s\S]*Skaalattu 4:10/);
          assert.doesNotMatch(await fran.innerText(), /Rx/);
          assert.match(await rows.filter({ hasText: 'AMRAP 12 min' }).innerText(), /Rx 5 kierrosta \+ 12 toistoa/);

          await tap(button(p, 'Harjoituksiin'));
          await tap(button(p, 'Historia'));
          await tap(item('Fran').locator('[data-action="edithistory"]'));
          await tapConfirm(button(p, 'Poista tulos: Fran'));
          assert.equal((await saved(p)).history.find((h) => h.name === 'Fran').wods[0].result, undefined);
          await tap(item('Fran').locator('[data-action="edithistory"]'));
          assert.equal(await item('Fran').locator('.history-sets').textContent(), '0/1 WOD');
          assert.equal(await item('Fran').locator('.history-wods li').textContent(), 'Fran ei tulosta');
          await tap(button(p, 'Harjoituksiin'));
          await tap(button(p, 'Ennätykset'));
          assert.equal(await p.locator('.wod-record-list .record-row').count(), 1, 'a removed result leaves the records');
        }, { timeout: 90000 });

        await run('full flow: a template becomes a program, is trained with the clock, saved, and shows in history, records and on the home card', async (p) => {
          await fakeTime(p);
          await p.reload();
          await tap(button(p, 'Luo treeniohjelma'));
          await tap(button(p, 'Aloita mallista'));
          await tap(p.getByRole('group', { name: 'Mallien ryhmä' }).getByRole('button', { name: 'Vertailutreenit', exact: true }));
          await tap(button(p, 'Käytä mallia Fran'));
          await tap(button(p, 'Tallenna harjoitus'));
          assert.equal((await saved(p)).routines.some((r) => r.name === 'Fran' && r.type === 'functional'), true);

          await p.evaluate(() => document.querySelectorAll('details.routine-details').forEach((d) => { d.open = true; }));
          await tap(button(p, 'Aloita: Fran'));
          await tap(button(p, 'Käynnistä kello (Fran)'));
          await p.clock.runFor(80000);
          await tap(p.locator('[data-action="clocklap"]'));
          await p.clock.runFor(60000);
          await tap(button(p, 'Valmis'));
          assert.equal(await p.locator('#wod-clock .timer-clock').textContent(), '2:10');
          await tap(button(p, 'Kirjaa tulos'));
          assert.deepEqual(await values(p.locator('#wod-0 [data-rf="min"], #wod-0 [data-rf="sec"]')), ['2', '10']);
          await tap(button(p, 'Tallenna tulos'));
          assert.equal(await p.locator('#wod-0 .wod-score').textContent(), 'Tulos 2:10 Rx', 'the first result is a baseline, not a record');
          await tap(button(p, 'Tallenna harjoitus'));
          const state = await saved(p);
          assert.equal(state.session, null);
          assert.deepEqual(state.history[0].wods.map((w) => [w.name, w.result]), [['Fran', { kind: 'time', seconds: 130, division: 'rx' }]]);
          assert.equal(state.history[0].setsTotal, 0);

          await p.evaluate(() => document.querySelectorAll('details.routine-details').forEach((d) => { d.open = true; }));
          assert.match(await p.locator('.routine-last').textContent(), /Fran 2:10 · Rx/);
          await tap(button(p, 'Historia'));
          assert.equal(await p.locator('.history-wods li').textContent(), 'Fran 2:10 · Rx');
          assert.equal(await p.locator('.history-sets').textContent(), '1/1 WOD');
          await tap(button(p, 'Harjoituksiin'));
          await tap(button(p, 'Ennätykset'));
          assert.match(await p.locator('.wod-record-list .record-row').innerText(), /Fran[\s\S]*1 kirjaus[\s\S]*Rx 2:10/);
        }, { timeout: 90000 });

        await run('schema-1 data loads unchanged next to functional programs, and the first save writes schema 2', async (p) => {
          const gym = core.sanitizeRoutine({ id: 'g1', name: 'Rintatreeni', exercises: [{ name: 'Penkkipunnerrus', sets: 3, reps: '8', weight: '60 kg' }] });
          const old = core.startSession(gym, Date.now() - 4 * DAY), done = core.startSession(gym, Date.now() - 3 * DAY);
          core.toggleSet(done, 0, 0);
          const state = { ...core.defaultState(), v: 1, routines: [gym, program('fran')], history: [core.summarize(done, Date.now() - 3 * DAY + 1800000)], session: old };
          const raw = JSON.stringify(state);
          await p.evaluate((value) => localStorage.setItem('gym-tracker-v1', value), raw);
          await p.reload();
          assert.equal(await p.evaluate(() => localStorage.getItem('gym-tracker-v1')), raw, 'loading rewrites nothing');
          assert.equal(await p.locator('h1').innerText(), 'Rintatreeni');
          assert.equal(await p.locator('.session-stat').textContent(), '0/3 sarjaa · 0%', 'the unfinished workout is where it was left');
          await tap(p.locator('[data-action="set"][data-e="0"][data-s="0"]'));
          const after = await saved(p);
          assert.equal(after.v, 2);
          assert.deepEqual(after.routines.map((r) => [r.id, r.name]), [['g1', 'Rintatreeni'], [state.routines[1].id, 'Fran']]);
          assert.deepEqual(after.routines[0].exercises.map((e) => [e.name, e.sets, e.reps, e.weight]), [['Penkkipunnerrus', 3, '8', '60 kg']]);
          assert.deepEqual(after.history.map((h) => [h.id, h.name, h.setsDone, h.setsTotal]), [[state.history[0].id, 'Rintatreeni', 1, 3]]);
          assert.equal(after.session.exercises[0].sets[0].done, true);
          await tap(button(p, 'Takaisin harjoituksiin'));
          await p.evaluate(() => document.querySelectorAll('details.routine-details').forEach((d) => { d.open = true; }));
          assert.equal(await p.locator('.routine').nth(0).locator('.routine-variants .btn').count(), 2, 'the gym program keeps its variants');
          assert.equal(await p.locator('.routine').nth(0).locator('.routine-meta .badge').count(), 0);
          assert.equal(await p.locator('.routine').nth(1).locator('.routine-meta .badge').textContent(), 'Toiminnallinen');
          assert.match(await p.locator('.resume').textContent(), /Rintatreeni[\s\S]*1\/3 sarjaa tehty/);
        });

        await run('the home card, history editor and records pass accessibility, touch-size and overflow checks in Dark and Aurora', async (p) => {
          const now = Date.now();
          const history = [finished('tunti', { rounds: '5', reps: '12' }, now - DAY), finished('fran', { min: '4', sec: '30' }, now - 2 * DAY)];
          const widths = async (label, list = [390, 320], known = '') => {
            for (const width of list) {
              await p.setViewportSize({ width, height: 844 });
              await audit(p, `${label} ${width}`, { known });
            }
            await p.setViewportSize(devices[device].viewport);
          };
          for (const theme of ['dark', 'aurora']) {
            if (theme === 'aurora') await p.evaluate(() => localStorage.setItem('gym-tracker-appearance-v1', 'aurora'));
            await openHome(p, ['fran', 'tunti'], history);
            assert.equal(await p.evaluate(() => document.documentElement.dataset.theme), theme);
            await widths(`${theme} home with functional programs`);
            await tap(button(p, 'Historia'));
            await widths(`${theme} history`);
            await tap(p.locator('[data-action="edithistory"]').first());
            await widths(`${theme} history editor`);
            await tap(button(p, 'Harjoituksiin'));
            await tap(button(p, 'Ennätykset'));
            await widths(`${theme} records`);
          }
        }, { bypassCSP: true, timeout: 150000 });
      });

      await test(`${engine}: functional workout`, async (t) => {
        const run = runner(t, browser, device);

        await run('a WOD-only workout: warm-up, version, result errors, saving, reload, correcting and removing', async (p) => {
          await startProgram(p, ['fran']);
          const stat = p.locator('.session-stat'), wod = p.locator('#wod-0'), field = (name) => wod.locator(`[data-rf="${name}"]`);
          assert.equal(await stat.textContent(), '0/1\u00a0WOD · 0%');
          assert.equal(await wod.evaluate((el) => el.classList.contains('current')), true);
          assert.equal(await wod.locator('.badge.now').count(), 0);
          assert.equal(await wod.locator('.wod-past').textContent(), 'Ensimmäinen kerta: tulos on lähtötasosi.');

          const warmup = button(p, 'Lämmittely: Valmis');
          await tap(warmup);
          assert.equal(await warmup.getAttribute('aria-pressed'), 'true');
          assert.equal(await focused(warmup), true, 'the toggle keeps focus');
          await live(p, /^Lämmittely tehty\.$/);
          assert.equal((await saved(p)).session.warmup.done, true);

          const scaled = button(p, 'Skaalattu');
          await tap(scaled);
          assert.equal(await scaled.getAttribute('aria-pressed'), 'true');
          assert.equal(await focused(scaled), true, 'the version switch keeps focus');
          assert.match(await wod.innerText(), /Kyykkypunnerrus tangolla \(20 kg\)\s+Avustettu leuanveto/);
          assert.equal((await saved(p)).session.wods[0].division, 'scaled');

          await tap(button(p, 'Kirjaa tulos (Fran)'));
          assert.equal(await focused(field('min')), true, 'the form opens on its first field');
          assert.equal(await wod.locator('[data-rf="division"][value="scaled"]').isChecked(), true, 'the form follows the version on the board');
          await tap(button(p, 'Tallenna tulos'));
          const error = p.locator('#result-error-0');
          assert.match(await error.textContent(), /^Anna aika minuutteina ja sekunteina/);
          assert.equal(await focused(error), true, 'the error is read first');
          assert.equal((await saved(p)).session.wods[0].result, undefined);

          const shown = async () => [await p.locator('#rf-time-0').isVisible(), await p.locator('#rf-cap-0').isVisible()];
          await field('capped').evaluate((e) => { e.dataset.probe = 'kept'; });
          await field('capped').check();
          assert.deepEqual(await shown(), [false, true], 'a time cap swaps the time for reps');
          assert.equal(await field('capped').getAttribute('data-probe'), 'kept', 'the switch is toggled in place, so focus stays on it');
          await field('capped').uncheck();
          assert.deepEqual(await shown(), [true, false]);

          await field('min').fill('4');
          await field('sec').fill('40');
          await field('notes').fill('Hyvä veto');
          await field('sec').press('Enter');
          await wod.locator('.wod-result').waitFor();
          await idle(p);
          const edit = button(p, 'Muokkaa tulosta (Fran)');
          assert.equal(await focused(edit), true, 'focus moves to the saved result');
          assert.equal(await wod.locator('.wod-score').textContent(), 'Tulos 4:40 Skaalattu', 'a first result is a baseline, not a record');
          assert.equal(await wod.locator('.wod-notes').textContent(), 'Hyvä veto');
          assert.equal(await wod.locator('.done-badge').textContent(), 'Kirjattu');
          assert.equal(await stat.textContent(), '1/1\u00a0WOD · 100%');
          assert.equal(await button(p, 'Tallenna harjoitus').count(), 1, 'the workout is complete');
          await live(p, /^Tulos tallennettu: Fran, 4:40 · Skaalattu\.$/);
          assert.deepEqual((await saved(p)).session.wods[0].result, { kind: 'time', seconds: 280, division: 'scaled', notes: 'Hyvä veto' });

          await p.reload();
          await wod.locator('.wod-result').waitFor();
          assert.equal(await wod.locator('.wod-score').textContent(), 'Tulos 4:40 Skaalattu', 'the result survives a reload');

          await tap(edit);
          assert.equal(await p.locator('#result-title-0').textContent(), 'Muokkaa tulosta (Fran)');
          assert.deepEqual(await values(wod.locator('[data-rf="min"], [data-rf="sec"], [data-rf="notes"]')), ['4', '40', 'Hyvä veto']);
          assert.equal(await wod.locator('[data-rf="division"][value="scaled"]').isChecked(), true);
          assert.equal(await focused(field('min')), true);
          await tap(button(p, 'Peruuta'));
          assert.equal(await focused(edit), true, 'cancel returns to the result');

          await tap(edit);
          await tapConfirm(button(p, 'Poista tulos'));
          assert.equal(await focused(button(p, 'Kirjaa tulos (Fran)')), true);
          assert.equal((await saved(p)).session.wods[0].result, undefined);
          assert.equal(await stat.textContent(), '0/1\u00a0WOD · 0%');
          await live(p, /^Tulos poistettu\.$/);
        });

        await run('history shows the previous result and the bests, and beating the best is a new record with a cheer', async (p) => {
          const now = Date.now();
          await startProgram(p, ['fran'], [finished('fran', { min: '5', sec: '0' }, now - 2 * DAY), finished('fran', { min: '4', sec: '50', division: 'scaled' }, now - 9 * DAY)]);
          const wod = p.locator('#wod-0'), field = (name) => wod.locator(`[data-rf="${name}"]`);
          const past = await wod.locator('.wod-past p').allTextContents();
          assert.match(past[0], /^Edellinen \d{1,2}\.\d{1,2}\.: 5:00 · Rx$/);
          assert.equal(past[1], 'Ennätys: Rx 5:00 · Skaalattu 4:50');
          assert.equal(await button(p, 'Rx').getAttribute('aria-pressed'), 'true', 'the version of the latest result is preselected');

          await tap(button(p, 'Kirjaa tulos (Fran)'));
          await field('min').fill('4');
          await field('sec').fill('32');
          await tap(button(p, 'Tallenna tulos'));
          assert.equal(await wod.locator('.wod-score').textContent(), 'Tulos 4:32 Rx Uusi ennätys');
          const cheer = await wod.locator('.cheer').textContent();
          assert.ok(RECORD_CHEERS.includes(cheer), `a record cheer: ${cheer}`);
          await live(p, /^Tulos tallennettu: Fran, 4:32 · Rx\. Uusi ennätys! /);
          assert.ok((await p.locator('#live').textContent()).endsWith(cheer));

          await tap(button(p, 'Muokkaa tulosta (Fran)'));
          await field('min').fill('5');
          await field('sec').fill('10');
          await tap(button(p, 'Tallenna tulos'));
          assert.equal(await wod.locator('.wod-score').textContent(), 'Tulos 5:10 Rx', 'a slower correction is no record');
          assert.equal(await wod.locator('.cheer').count(), 0);

          await tap(button(p, 'Tallenna harjoitus'));
          await live(p, /^Harjoitus tallennettu\. Hienoa työtä!/);
          const state = await saved(p);
          assert.equal(state.session, null);
          assert.equal(state.history.length, 3);
          assert.deepEqual(state.history[0].wods.map((w) => [w.name, w.result]), [['Fran', { kind: 'time', seconds: 310, division: 'rx' }]]);
          assert.match(state.history[0].wods[0].board, /Kyykkypunnerrus tangolla \(29 kg\)/, 'history keeps the Rx whiteboard');
        });

        await run('in a class with strength sets the WOD part follows the sets, and finishing early names what is unlogged', async (p) => {
          await startProgram(p, ['tunti']);
          const stat = p.locator('.session-stat'), wod = p.locator('#wod-0'), title = wodTitle(program('tunti').wods[0]);
          const set = (si) => p.locator(`[data-action="set"][data-e="0"][data-s="${si}"]`);
          const wodInView = () => p.waitForFunction(() => { const top = document.getElementById('wod-0').getBoundingClientRect().top; return top > 0 && top < innerHeight / 2; });
          assert.equal(await stat.textContent(), '0/5\u00a0sarjaa · 0/1\u00a0WOD · 0%');
          assert.equal(await p.locator('#exercise-0').evaluate((el) => el.classList.contains('current')), true, 'the sets come first');
          assert.equal(await p.locator('#exercise-0 .badge.now').count(), 0);
          assert.equal(await wod.locator('.badge.now').count(), 0);
          assert.deepEqual(await answer(p.locator('[data-action="finish"]'), false), ['Mitään ei ole vielä kirjattu, joten harjoitusta ei tallenneta historiaan. Lopetetaanko ilman tallennusta?', 'Lopeta tallentamatta']);

          await tap(set(0));
          await tap(set(1));
          assert.deepEqual(await answer(p.locator('[data-action="finish"]'), false), ['Kirjaamatta: 3 sarjaa ja 1 WOD-osa. Lopetetaanko silti?', 'Lopeta']);
          await tap(set(2));
          await tap(set(3));
          assert.ok(await viewportTop(wod) > 0.5, 'the WOD part starts low before the last set');
          await tap(set(4));
          await wodInView();
          assert.equal(await stat.textContent(), '5/5\u00a0sarjaa · 0/1\u00a0WOD · 83%');
          assert.equal(await wod.evaluate((el) => el.classList.contains('current')), true);
          assert.equal(await wod.locator('.badge.now').count(), 0);
          const rail = p.locator('[data-action="jumpwod"]');
          assert.equal(await rail.getAttribute('aria-current'), 'step');
          assert.equal(await rail.getAttribute('aria-label'), `WOD: ${title}, vuorossa`);

          await p.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
          await tap(rail);
          await wodInView();
          await p.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
          await tap(button(p, `Siirry WOD-osaan: ${title}`));
          await wodInView();
          assert.equal(await focused(button(p, `Käynnistä kello (${title})`)), true, 'the jump focuses the next step: the clock');

          await tap(button(p, `Kirjaa tulos (${title})`));
          assert.equal(await focused(wod.locator('[data-rf="rounds"]')), true, 'rounds come first');
          await wod.locator('[data-rf="rounds"]').fill('5');
          await wod.locator('[data-rf="reps"]').fill('12');
          await tap(button(p, 'Tallenna tulos'));
          assert.equal(await wod.locator('.wod-score').textContent(), 'Tulos 5 kierrosta + 12 toistoa Rx');
          assert.equal(await stat.textContent(), '5/5\u00a0sarjaa · 1/1\u00a0WOD · 100%');
          await tap(button(p, 'Tallenna harjoitus'));
          const [entry] = (await saved(p)).history;
          assert.deepEqual([entry.type, entry.setsDone, entry.setsTotal], ['functional', 5, 5]);
          assert.deepEqual(entry.wods.map((w) => w.result), [{ kind: 'roundsReps', rounds: 5, reps: 12, division: 'rx' }]);
        });

        await run('the clock: pre-roll, rounds, undo, pause across a reload, Valmis and the result it fills in', async (p) => {
          await fakeTime(p);
          await startProgram(p, ['fran']);
          const t = (id) => p.locator(`#${id}`).textContent(), lap = p.locator('[data-action="clocklap"]');
          await tap(button(p, 'Käynnistä kello (Fran)'));
          assert.equal(await p.locator('h1').innerText(), 'Fran');
          assert.deepEqual([await t('wc-label'), await t('wc-time')], ['Valmistaudu', '10']);
          assert.equal(await lap.getAttribute('aria-disabled'), 'true', 'nothing to count during the pre-roll');
          await p.clock.runFor(100);
          assert.match(await p.locator('#live').textContent(), /^Valmistaudu: Fran alkaa 10 sekunnin kuluttua\.$/);
          await lap.click({ force: true });
          assert.equal(await p.locator('.clock-lap-info').textContent(), 'Napauta +1 kierros aina, kun kierros on tehty.');
          await p.clock.runFor(100);
          assert.equal(await p.locator('#live').textContent(), 'Kierroksia kirjataan, kun kello käy.');

          await p.clock.runFor(10000);
          assert.deepEqual([await t('wc-label'), await t('wc-time')], ['Nyt!', '0:00']);
          assert.equal(await lap.getAttribute('aria-disabled'), 'false');
          await p.clock.runFor(3000);
          assert.equal(await t('wc-label'), 'Aikaa vastaan');
          assert.equal(await t('wc-target'), 'Nyt: 21');
          await p.clock.runFor(58000);
          await tap(lap);
          await tap(lap);
          assert.equal(await t('wc-target'), 'Nyt: 15');
          assert.equal(await t('wc-detail'), 'Kierros 2/3 · aikaraja 10:00');
          assert.equal(await p.locator('.clock-lap-info').textContent(), '1 kierros tehty · viimeisin 1:01', 'a double tap counts one round');
          await p.clock.runFor(100);
          assert.equal(await p.locator('#live').textContent(), '1 kierros tehty. Nyt: 15.');

          await p.clock.runFor(60000);
          await tap(lap);
          const final = p.locator('.clock-lap-final');
          assert.equal(await final.textContent(), 'Viimeinen kierrosPaina Valmis, kun kierros on tehty.');
          assert.equal(await focused(final), true, 'focus stays where the round button was');
          assert.equal(await lap.count(), 0);
          assert.equal(await t('wc-target'), 'Nyt: 9');
          await tap(button(p, 'Peru viimeisin kierros'));
          assert.equal(await lap.count(), 1);
          assert.equal(await t('wc-target'), 'Nyt: 15');
          await tap(lap);
          assert.equal(await final.count(), 1);

          await tap(button(p, 'Tauko'));
          assert.equal(await t('wc-label'), 'Tauolla');
          const paused = await t('wc-time');
          await p.clock.runFor(30000);
          assert.equal(await t('wc-time'), paused, 'a paused clock stands still');
          await p.reload();
          await p.locator('#wod-clock').waitFor();
          assert.deepEqual([await t('wc-label'), await t('wc-time')], ['Tauolla', paused], 'the paused clock comes back after a reload');
          assert.equal(await p.locator('#wod-clock').getAttribute('data-paused'), 'true');
          await tap(button(p, 'Jatka'));
          await p.clock.runFor(51000);

          await tap(button(p, 'Valmis'));
          const finish = await p.locator('#wod-clock .timer-clock').textContent(), [fm, fs] = finish.split(':').map(Number), total = fm * 60 + fs;
          assert.ok(total >= 172 && total <= 173, `about 51 s after the pause, got ${finish}`);
          assert.equal(await focused(button(p, 'Kirjaa tulos')), true, 'focus moves to the next step');
          await p.clock.runFor(100);
          assert.equal(await p.locator('#live').textContent(), `Valmis. Aika ${finish}.`);
          assert.deepEqual((await saved(p)).session.wods[0].clock.laps.length, 2);

          await tap(button(p, 'Kirjaa tulos'));
          const wod = p.locator('#wod-0');
          assert.deepEqual(await values(wod.locator('[data-rf="min"], [data-rf="sec"]')), [String(Math.floor(total / 60)), String(total % 60)], 'the result form is prefilled with the time');
          assert.equal(await focused(wod.locator('[data-rf="min"]')), true);
          assert.equal(await wod.locator('.clock-status').textContent(), `Kello: Valmis · ${finish}`);
          await tap(button(p, 'Tallenna tulos'));
          assert.equal((await saved(p)).session.wods[0].result.seconds, total + 0);
          assert.match(await wod.locator('.wod-score').textContent(), /^Tulos \d:\d\d Rx$/);
        }, { timeout: 90000 });

        await run('the clock: stopping in the pre-roll cancels it, stopping later keeps the time, restarting asks first', async (p) => {
          await fakeTime(p);
          await startProgram(p, ['fran']);
          const start = button(p, 'Käynnistä kello (Fran)');
          await tap(start);
          await p.clock.runFor(3000);
          await tap(button(p, 'Lopeta'));
          assert.equal(await p.locator('#wod-clock').count(), 0);
          assert.equal(await focused(start), true, 'focus returns to the card');
          assert.equal((await saved(p)).session.wods[0].clock, undefined, 'nothing was timed');
          await p.clock.runFor(100);
          assert.equal(await p.locator('#live').textContent(), 'Kello peruttu.');

          await tap(start);
          await p.clock.runFor(15000);
          assert.match(await p.locator('#wc-time').textContent(), /^0:0[45]$/);
          const asked = await answer(button(p, 'Lopeta'), true);
          assert.deepEqual(asked, ['Lopetetaanko kello nyt? Mitattu aika säilyy, ja voit kirjata tuloksen.', 'Lopeta']);
          assert.equal(await p.locator('#wod-clock .timer-clock').textContent(), '0:05');
          await tap(button(p, 'Harjoitukseen'));
          assert.equal(await p.locator('.clock-status').textContent(), 'Kello: Valmis · 0:05');
          assert.equal(await focused(button(p, 'Kirjaa tulos (Fran)')), true);
          const restart = button(p, 'Käynnistä kello uudelleen (Fran)');
          assert.deepEqual(await answer(restart, false), ['Aloitetaanko kello alusta? Edellinen ajanotto korvataan.', 'Aloita alusta']);
          assert.equal((await saved(p)).session.wods[0].clock.endedAt > 0, true, 'declining keeps the measured time');
          await answer(restart, true);
          assert.deepEqual([await p.locator('#wc-label').textContent(), await p.locator('#wc-time').textContent()], ['Valmistaudu', '10']);
        }, { timeout: 90000 });

        await run('an AMRAP runs out while another view is open: the card follows it and the result gets the rounds', async (p) => {
          await fakeTime(p);
          await startProgram(p, ['cindy']);
          await tap(button(p, 'Käynnistä kello (Cindy)'));
          await p.clock.runFor(310000);
          const lap = p.locator('[data-action="clocklap"]');
          await tap(lap);
          await p.clock.runFor(2000);
          await tap(lap);
          assert.equal(await p.locator('#wc-detail').textContent(), 'Kierros 3');
          await tap(button(p, 'Takaisin harjoitukseen'));
          const open = button(p, 'Avaa kello (Cindy)');
          assert.equal(await focused(open), true, 'focus returns to the card button');
          assert.match(await p.locator('#wc-mini-0').textContent(), /^AMRAP · /);
          await p.clock.runFor(1200000);
          await p.clock.runFor(100);
          assert.equal(await p.locator('.clock-status').textContent(), 'Kello: Aika loppui · 20:00 · 2 kierrosta');
          assert.match(await p.locator('#live').textContent(), /^Aika loppui\.$/);
          await tap(button(p, 'Kirjaa tulos (Cindy)'));
          assert.deepEqual(await values(p.locator('#wod-0 [data-rf="rounds"], #wod-0 [data-rf="reps"]')), ['2', '']);
          assert.equal((await saved(p)).session.wods[0].clock.endedAt > 0, true, 'the end was saved at the planned moment');
        }, { timeout: 90000 });

        await run('the clock screens and the card pass accessibility, touch-size and overflow checks in Dark and Aurora', async (p) => {
          const widths = async (label, list) => {
            for (const width of list) {
              await p.setViewportSize({ width, height: 844 });
              await audit(p, `${label} ${width}`);
            }
            await p.setViewportSize(devices[device].viewport);
          };
          const states = [
            ['run with a round counted', 'fran', { ago: 100000, laps: [60000] }, [390, 320]],
            ['last round', 'fran', { ago: 210000, laps: [60000, 150000] }, [320]],
            ['paused pre-roll', 'fran', { ago: 5000, paused: true }, [320]],
            ['an hour without a cap', 'fran', { ago: 3620000, edit: (w) => { w.minutes = 0; } }, [390, 320]],
            ['interval work', 'tabata', { ago: 15000 }, [320]],
            ['AMRAP', 'cindy', { ago: 310000, laps: [100000, 200000] }, [320]],
          ];
          for (const theme of ['dark', 'aurora']) {
            if (theme === 'aurora') await p.evaluate(() => localStorage.setItem('gym-tracker-appearance-v1', 'aurora'));
            for (const [label, id, options, list] of states) {
              await seedClock(p, id, options);
              await p.locator('#wod-clock').waitFor();
              assert.equal(await p.evaluate(() => document.documentElement.dataset.theme), theme);
              if (label === 'an hour without a cap') assert.match(await p.locator('#wc-time').getAttribute('class'), /\blong\b/);
              await widths(`${theme} clock: ${label}`, list);
            }
            await seedClock(p, 'fran', { ago: 100000, laps: [60000] });
            await tap(button(p, 'Takaisin harjoitukseen'));
            await widths(`${theme} card with a running clock`, [320]);
          }
        }, { bypassCSP: true, timeout: 150000 });

        await run('the finished clock screen and the card with a measured time pass the checks', async (p) => {
          await fakeTime(p);
          await startProgram(p, ['fran']);
          await tap(button(p, 'Käynnistä kello (Fran)'));
          await p.clock.runFor(10000 + 90000);
          await tap(button(p, 'Valmis'));
          await p.locator('#wod-clock[data-phase="done"]').waitFor();
          await p.clock.resume();
          await audit(p, 'finished clock 390');
          await p.setViewportSize({ width: 320, height: 844 });
          await audit(p, 'finished clock 320');
          await tap(button(p, 'Kirjaa tulos'));
          await audit(p, 'result form with the measured time 320');
        }, { bypassCSP: true, timeout: 90000 });

        await run('the running workout passes accessibility, touch-size and overflow checks in Dark and Aurora', async (p) => {
          const history = [finished('fran', { min: '5', sec: '0' }, Date.now() - 2 * DAY)];
          // The strength part reuses the gym exercise card, whose RIR and set +/− buttons are under 48 px on main too.
          const widths = async (label, list = [390, 320], known = '') => {
            for (const width of list) {
              await p.setViewportSize({ width, height: 844 });
              await audit(p, `${label} ${width}`, { known });
            }
            await p.setViewportSize(devices[device].viewport);
          };
          for (const theme of ['dark', 'aurora']) {
            if (theme === 'aurora') await p.evaluate(() => localStorage.setItem('gym-tracker-appearance-v1', 'aurora'));
            await startProgram(p, ['fran', 'tunti'], history);
            assert.equal(await p.evaluate(() => document.documentElement.dataset.theme), theme);
            const wod = p.locator('#wod-0');
            await tap(button(p, 'Lämmittely: Valmis'));
            await widths(`${theme} WOD workout`);
            await tap(button(p, 'Kirjaa tulos (Fran)'));
            await wod.locator('[data-rf="capped"]').check();
            await tap(button(p, 'Tallenna tulos'));
            assert.equal(await p.locator('#result-error-0').count(), 1);
            await widths(`${theme} result form with an error`, [320]);
            await wod.locator('[data-rf="capped"]').uncheck();
            await wod.locator('[data-rf="min"]').fill('4');
            await wod.locator('[data-rf="sec"]').fill('32');
            await tap(button(p, 'Tallenna tulos'));
            assert.equal(await wod.locator('.cheer').count(), 1);
            await widths(`${theme} new record`, [320]);
            await startProgram(p, ['tunti', 'fran'], history);
            await widths(`${theme} class with sets`, [320], '.exercise-rir .rir-btn, [data-action="rmset"], [data-action="addset"]');
          }
        }, { bypassCSP: true, timeout: 120000 });
      });
    } finally { await browser.close(); }
  }
} finally { server.kill(); }
