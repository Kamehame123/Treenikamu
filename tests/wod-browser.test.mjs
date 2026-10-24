import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, webkit, devices, AxeBuilder, startServer, tap, tapConfirm } from './support.mjs';
import { TEMPLATES, DEFAULT_WARMUP, templateById, templateRoutine } from '../wod-templates.js';

const { server, url } = await startServer();
const button = (p, name) => p.getByRole('button', { name, exact: true });
const saved = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('gym-tracker-v1')));
const focused = (locator) => locator.evaluate((e) => e === document.activeElement);
const values = (locator) => locator.evaluateAll((elements) => elements.map((e) => e.value));
async function newFunctional(p) {
  await tap(button(p, 'Luo treeniohjelma'));
  assert.equal(await p.locator('h1').innerText(), 'Millainen ohjelma?');
  await tap(button(p, 'Toiminnallinen treeni'));
  await p.locator('.wod-edit').waitFor();
}
async function audit(p, label) {
  await p.waitForTimeout(350);
  const violations = (await new AxeBuilder({ page: p }).analyze()).violations;
  assert.deepEqual(violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })), [], `${label}: axe`);
  assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('button, input, select, summary, a:not(.sr)')].filter((e) => {
    const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 47.9 || r.height < 47.9);
  }).map((e) => e.outerHTML.slice(0, 100))), [], `${label}: 48 px touch targets`);
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${label}: no horizontal overflow`);
}

try {
  for (const [engine, type, device] of [['chromium', chromium, 'Pixel 7'], ['webkit', webkit, 'iPhone 14']]) {
    const browser = await type.launch();
    try {
      await test(`${engine}: functional program editor`, async (t) => {
        const run = async (title, fn, { timeout = 40000, ...options } = {}) => t.test(title, { timeout }, async () => {
          const context = await browser.newContext({ ...devices[device], serviceWorkers: 'block', ...options });
          const page = await context.newPage(); page.setDefaultTimeout(5000);
          const errors = [];
          page.on('pageerror', (error) => errors.push(error.message));
          try { await page.goto(url); await fn(page); assert.deepEqual(errors, []); } finally { await context.close(); }
        });

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
    } finally { await browser.close(); }
  }
} finally { server.kill(); }
