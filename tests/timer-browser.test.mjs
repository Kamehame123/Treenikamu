import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, webkit, devices, AxeBuilder, startServer, tap, tapConfirm } from './support.mjs';

const { server, url } = await startServer();
const button = (page, name) => page.getByRole('button', { name, exact: true });
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('gym-tracker-v1')));
const text = (page, id) => page.locator(`#${id}`).innerText();

async function openTimer(page) {
  await tap(button(page, 'Ajastin'));
  await page.getByRole('heading', { name: 'Ajastin', exact: true }).waitFor();
}
// Creates a sequence; each interval is [label, minutes, seconds].
async function createSequence(page, { name = '', repeats = '1', intervals }) {
  await tap(page.locator('[data-key="timernew"]'));
  if (name) await page.locator('[data-key="tf-name"]').fill(name);
  await page.locator('[data-key="tf-repeats"]').fill(repeats);
  for (const [n, [label, min, sec]] of intervals.entries()) {
    if (n > 0) await tap(page.locator('[data-key="timer-add"]'));
    await page.locator(`[data-key="tl-${n}"]`).fill(label);
    await page.locator(`[data-key="tm-${n}"]`).fill(min);
    await page.locator(`[data-key="ts-${n}"]`).fill(sec);
  }
  await tap(page.locator('[data-key="timer-save"]'));
}

try {
  for (const [name, engine, device] of [['chromium', chromium, 'Pixel 7'], ['webkit', webkit, 'iPhone 14']]) {
    const browser = await engine.launch();
    try {
      await test(`${name}: interval timer`, async (t) => {
        const run = async (title, work) => t.test(title, { timeout: 60000 }, async () => {
          const context = await browser.newContext({ ...devices[device], reducedMotion: 'reduce', serviceWorkers: 'block' });
          const page = await context.newPage();
          page.setDefaultTimeout(8000);
          const errors = [];
          page.on('pageerror', (e) => errors.push(e.message));
          page.on('console', (m) => { if (/Content Security Policy|violat/i.test(m.text())) errors.push(m.text()); });
          try { await page.goto(url); await page.locator('h1').waitFor(); await work(page); assert.deepEqual(errors, []); }
          finally { await context.close(); }
        });

        await run('Ajastin replaces Tilastot on home, Tilastot lives under Historia and returns there', async (page) => {
          assert.equal(await button(page, 'Tilastot').count(), 0);
          assert.equal(await page.locator('[data-key="timer-top"] svg.icon').count(), 1, 'the Ajastin button has an icon');
          await openTimer(page);
          await tap(button(page, 'Harjoituksiin'));
          await tap(button(page, 'Historia'));
          await tap(button(page, 'Tilastot'));
          await page.getByRole('heading', { name: 'Tilastot', exact: true }).waitFor();
          await tap(button(page, 'Historiaan'));
          await page.getByRole('heading', { name: 'Historia', exact: true }).waitFor();
        });

        await run('unnamed sequences become Sarja 1, 2, 3, are saved and untouched elsewhere', async (page) => {
          await openTimer(page);
          assert.equal(await page.getByText('Ei vielä ajastinsarjoja').count(), 1);
          for (let n = 0; n < 3; n++) await createSequence(page, { repeats: '2', intervals: [['Juoksu', '1', ''], ['Kävely', '', '30']] });
          assert.deepEqual(await page.locator('.timer-item h2').allInnerTexts(), ['Sarja 1', 'Sarja 2', 'Sarja 3']);
          const after = await saved(page);
          assert.deepEqual(after.timers.map((x) => x.name), ['Sarja 1', 'Sarja 2', 'Sarja 3']);
          assert.deepEqual(after.timers[0].intervals.map((i) => [i.label, i.seconds]), [['Juoksu', 60], ['Kävely', 30]]);
          assert.equal(after.timers[0].repeats, 2);
          const { timers, ...rest } = after;
          assert.deepEqual([rest.history, rest.session, rest.customExercises], [[], null, []], 'timers do not touch training data');
          // A deleted number is reused, and a named sequence keeps its name.
          await tapConfirm(page.getByRole('button', { name: 'Poista: Sarja 2', exact: true }));
          await createSequence(page, { intervals: [['', '', '10']] });
          await createSequence(page, { name: 'Mäki', intervals: [['', '', '10']] });
          assert.deepEqual(await page.locator('.timer-item h2').allInnerTexts(), ['Sarja 1', 'Sarja 3', 'Sarja 2', 'Mäki']);
          // An interval without an explanation is shown as Intervalli N.
          assert.match(await page.locator('.timer-item').nth(2).innerText(), /Intervalli 1 · 10 s/);
        });

        await run('the editor explains invalid input and keeps the draft', async (page) => {
          await openTimer(page);
          await tap(page.locator('[data-key="timernew"]'));
          await tap(page.locator('[data-key="timer-save"]'));
          await page.getByRole('alert').filter({ hasText: 'kesto on 0 sekuntia' }).waitFor();
          await page.locator('[data-key="ts-0"]').fill('75');
          await tap(page.locator('[data-key="timer-save"]'));
          await page.getByRole('alert').filter({ hasText: 'ei kelpaa' }).waitFor();
          await page.locator('[data-key="ts-0"]').fill('20');
          await page.locator('[data-key="tf-repeats"]').fill('0');
          await tap(page.locator('[data-key="timer-save"]'));
          await page.getByRole('alert').filter({ hasText: 'Kierrosten määrä' }).waitFor();
          assert.equal(await page.locator('[data-key="ts-0"]').inputValue(), '20');
          assert.equal((await saved(page))?.timers, undefined);
        });

        await run('a run shows the repeat number, advances, finishes and can restart', async (page) => {
          await openTimer(page);
          await createSequence(page, { repeats: '2', intervals: [['Sprintti', '', '1'], ['Lepo', '', '1']] });
          await tap(button(page, 'Käynnistä: Sarja 1'));
          assert.match(await text(page, 'trun-round'), /Kierros 1\/2/i);
          assert.equal(await text(page, 'trun-label'), 'Sprintti');
          assert.equal(await page.locator('#trun-index').count(), 0, 'no repeated interval counter');
          assert.equal(await text(page, 'trun-next'), 'Seuraavaksi - Lepo');
          assert.ok(await page.locator('#trun-round').evaluate((el) => parseFloat(getComputedStyle(el).fontSize)) >= 36, 'the round text is large');
          const [stop, pause] = await Promise.all([button(page, 'Lopeta'), button(page, 'Tauko')].map(async (b) => ({ box: await b.boundingBox(), radius: await b.evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius)) })));
          for (const { box, radius } of [stop, pause]) {
            assert.ok(Math.abs(box.width - box.height) <= 2 && box.width >= 120, `big square button, got ${box.width}x${box.height}`);
            assert.ok(radius >= 16 && radius < box.width / 2, `rounded square, radius ${radius}`);
          }
          await page.waitForFunction(() => /Kierros 2\/2/i.test(document.getElementById('trun-round')?.textContent ?? ''), null, { timeout: 6000 });
          await page.locator('.timer-label', { hasText: '2 kierrosta tehty' }).waitFor({ timeout: 8000 });
          assert.match(await page.locator('#live').innerText(), /Ajastin valmis/);
          await tap(button(page, 'Aloita alusta'));
          assert.match(await text(page, 'trun-round'), /Kierros 1\/2/i);
          assert.equal(await text(page, 'trun-next'), 'Seuraavaksi - Lepo');
          await tapConfirm(button(page, 'Lopeta'));
          await page.getByRole('heading', { name: 'Ajastin', exact: true }).waitFor();
        });

        await run('the next interval tracks transitions, round wrap, pause, reload and the final interval', async (page) => {
          const now = new Date();
          await page.clock.install({ time: now });
          await page.clock.pauseAt(new Date(now.getTime() + 10000));
          await page.reload();
          await openTimer(page);
          await createSequence(page, { repeats: '2', intervals: [['Työ', '', '20'], ['', '', '20'], ['Lepo', '', '20']] });
          const before = await saved(page);
          const rawBefore = await page.evaluate(() => localStorage.getItem('gym-tracker-v1'));
          await tap(button(page, 'Käynnistä: Sarja 1'));
          assert.equal(await text(page, 'trun-label'), 'Työ');
          assert.equal(await text(page, 'trun-next'), 'Seuraavaksi - Intervalli 2');
          const nextNode = await page.locator('#trun-next').elementHandle();
          await page.clock.runFor(20000);
          assert.equal(await text(page, 'trun-label'), 'Intervalli 2');
          assert.equal(await text(page, 'trun-next'), 'Seuraavaksi - Lepo');
          assert.equal(await nextNode.evaluate((el) => el === document.getElementById('trun-next')), true, 'ticks update the existing node');
          await tap(button(page, 'Tauko'));
          await page.clock.runFor(60000);
          assert.equal(await text(page, 'trun-label'), 'Intervalli 2');
          assert.equal(await text(page, 'trun-next'), 'Seuraavaksi - Lepo');
          await page.reload();
          assert.equal(await text(page, 'trun-next'), 'Seuraavaksi - Lepo');
          await tap(button(page, 'Jatka'));
          await page.clock.runFor(20000);
          assert.equal(await text(page, 'trun-label'), 'Lepo');
          assert.equal(await text(page, 'trun-next'), 'Seuraavaksi - Työ');
          await page.clock.runFor(600);
          assert.match(await page.locator('#live').innerText(), /Seuraavaksi - Työ/);
          await page.clock.runFor(19400);
          assert.equal(await text(page, 'trun-round'), 'Kierros 2/2');
          assert.equal(await text(page, 'trun-next'), 'Seuraavaksi - Intervalli 2');
          await page.clock.runFor(40000);
          assert.equal(await text(page, 'trun-label'), 'Lepo');
          assert.equal(await page.locator('#trun-next').isVisible(), false);
          assert.equal(await page.locator('#trun-next').textContent(), '');
          await page.clock.runFor(20000);
          await page.locator('[aria-label="Ajastin valmis"]').waitFor();
          assert.equal(await page.locator('#trun-next').count(), 0);
          assert.deepEqual(await saved(page), before);
          assert.equal(await page.evaluate(() => localStorage.getItem('gym-tracker-v1')), rawBefore);
        });

        await run('single-interval repeats preview the same escaped name, but a final interval has no next', async (page) => {
          await openTimer(page);
          const label = '<img src=x onerror=alert(1)>';
          await createSequence(page, { name: 'Toistuva', repeats: '2', intervals: [[label, '1', '']] });
          await tap(button(page, 'Käynnistä: Toistuva'));
          assert.equal(await text(page, 'trun-label'), label);
          assert.equal(await text(page, 'trun-next'), `Seuraavaksi - ${label}`);
          assert.equal(await page.locator('.timer-card img').count(), 0);
          await tapConfirm(button(page, 'Lopeta'));
          await createSequence(page, { name: 'Viimeinen', intervals: [['', '1', '']] });
          await tap(button(page, 'Käynnistä: Viimeinen'));
          assert.equal(await text(page, 'trun-label'), 'Intervalli 1');
          assert.equal(await page.locator('#trun-next').isVisible(), false);
        });

        await run('pause freezes the clock, stop asks first, reload restores the run', async (page) => {
          await openTimer(page);
          await createSequence(page, { name: 'Pitkä', repeats: '3', intervals: [['Työ', '1', '']] });
          await tap(button(page, 'Käynnistä: Pitkä'));
          await tap(button(page, 'Tauko'));
          assert.equal(await text(page, 'trun-next'), 'Seuraavaksi - Työ');
          const frozen = await text(page, 'trun-time');
          await page.waitForTimeout(1600);
          assert.equal(await text(page, 'trun-time'), frozen);
          assert.equal(await text(page, 'trun-next'), 'Seuraavaksi - Työ');
          await tap(button(page, 'Jatka'));
          await page.reload();
          await page.getByRole('heading', { name: 'Pitkä', exact: true }).waitFor();
          assert.match(await text(page, 'trun-round'), /Kierros 1\/3/i);
          assert.equal(await text(page, 'trun-next'), 'Seuraavaksi - Työ');
          await tapConfirm(button(page, 'Lopeta'), false);
          assert.equal(await page.locator('#trun-time').count(), 1, 'cancelling the confirm keeps the run');
          await tapConfirm(button(page, 'Lopeta'));
          await page.reload();
          await openTimer(page);
          await page.locator('.timer-item').waitFor();
          assert.equal(await page.locator('#trun-time').count(), 0, 'a stopped run is not restored');
          assert.equal((await saved(page)).history.length, 0, 'runs are not logged to history');
        });

        await run('Työ and Lepo add named intervals; Tee oletus changes and persists their durations', async (page) => {
          const flat = async (key) => (await page.locator(`[data-key="${key}"]`).innerText()).replace(/\s+/g, ' ');
          await openTimer(page);
          await tap(page.locator('[data-key="timernew"]'));
          assert.equal(await flat('timer-work'), 'Työ 0:30');
          assert.equal(await flat('timer-rest'), 'Lepo 0:15');
          const xs = await Promise.all(['timer-work', 'timer-add', 'timer-rest'].map(async (k) => (await page.locator(`[data-key="${k}"]`).boundingBox()).x));
          assert.deepEqual([...xs].sort((a, b) => a - b), xs, 'Työ, Lisää intervalli, Lepo from left to right');
          assert.equal(await page.locator('[data-key="tdef-0"]').isVisible(), false, 'Tee oletus only shows for Työ/Lepo intervals');
          await tap(page.locator('[data-key="timer-work"]'));
          await tap(page.locator('[data-key="timer-rest"]'));
          assert.deepEqual(await Promise.all(['tl-1', 'tm-1', 'ts-1', 'tl-2', 'tm-2', 'ts-2'].map((k) => page.locator(`[data-key="${k}"]`).inputValue())), ['Työ', '', '30', 'Lepo', '', '15']);
          // Tee oletus sits in the lower right corner of the interval box.
          const box = await page.locator('fieldset.timer-fieldset').nth(1).boundingBox(), def = await page.locator('[data-key="tdef-1"]').boundingBox();
          assert.ok(def.x + def.width > box.x + box.width / 2 && def.y > box.y + box.height / 2, 'lower right corner');
          await page.locator('[data-key="ts-1"]').fill('45');
          await tap(page.locator('[data-key="tdef-1"]'));
          assert.equal(await flat('timer-work'), 'Työ 0:45');
          await page.locator('[data-key="tm-2"]').fill('1');
          await page.locator('[data-key="ts-2"]').fill('30');
          await tap(page.locator('[data-key="tdef-2"]'));
          assert.equal(await flat('timer-rest'), 'Lepo 1:30');
          assert.deepEqual((await saved(page)).timerDefaults, { work: 45, rest: 90 });
          await tap(page.locator('[data-key="timer-work"]'));
          assert.equal(await page.locator('[data-key="ts-3"]').inputValue(), '45', 'new Työ intervals use the new default');
          // A blank duration is explained and never saved as a default.
          await page.locator('[data-key="tl-0"]').fill('työ');
          await tap(page.locator('[data-key="tdef-0"]'));
          await page.getByRole('alert').filter({ hasText: 'kesto on 0 sekuntia' }).waitFor();
          assert.deepEqual((await saved(page)).timerDefaults, { work: 45, rest: 90 });
          await page.locator('[data-key="tl-0"]').fill('Juoksu');
          assert.equal(await page.locator('[data-key="tdef-0"]').isVisible(), false, 'renaming hides Tee oletus again');
          // The defaults survive a reload and the sequence itself saves normally.
          await page.locator('[data-key="ts-0"]').fill('20');
          await tap(page.locator('[data-key="timer-save"]'));
          const after = await saved(page);
          assert.deepEqual(after.timers[0].intervals.map((i) => [i.label, i.seconds]), [['Juoksu', 20], ['Työ', 45], ['Lepo', 90], ['Työ', 45]]);
          await page.reload();
          await openTimer(page);
          await tap(page.locator('[data-key="timernew"]'));
          assert.equal(await flat('timer-work'), 'Työ 0:45');
          assert.equal(await flat('timer-rest'), 'Lepo 1:30');
        });

        await run('sequences survive a reload and travel in a backup', async (page) => {
          await openTimer(page);
          await createSequence(page, { name: 'Pysyvä', intervals: [['A', '', '15']] });
          await page.reload();
          await openTimer(page);
          assert.deepEqual(await page.locator('.timer-item h2').allInnerTexts(), ['Pysyvä']);
          const backup = await page.evaluate(async () => {
            const core = await import('./core.js');
            return JSON.parse(JSON.stringify(core.buildBackup(JSON.parse(localStorage.getItem('gym-tracker-v1')))));
          });
          assert.equal(backup.data.timers[0].name, 'Pysyvä');
        });

        await run('timer views have no axe violations or overflow at 320px', async (page) => {
          await page.setViewportSize({ width: 320, height: 640 });
          await openTimer(page);
          await createSequence(page, { name: 'Pitkä nimi '.repeat(5), repeats: '2', intervals: [['Selitys '.repeat(8), '1', '5'], ['Seuraava '.repeat(6), '', '30']] });
          for (const scheme of ['dark', 'light']) {
            await page.emulateMedia({ colorScheme: scheme });
            for (const step of ['list', 'editor', 'run']) {
              if (step === 'editor') { await tap(page.getByRole('button', { name: /^Muokkaa: / })); await page.locator('[data-key="tl-0"]').waitFor(); }
              if (step === 'run') { await tap(page.locator('[data-key="timer-cancel"]')); await tap(page.getByRole('button', { name: /^Käynnistä: / })); }
              if (step === 'run') {
                const hierarchy = await page.locator('.timer-card').evaluate((card) => {
                  const current = card.querySelector('#trun-label'), next = card.querySelector('#trun-next');
                  const currentStyle = getComputedStyle(current), nextStyle = getComputedStyle(next);
                  return {
                    currentSize: parseFloat(currentStyle.fontSize), currentWeight: Number(currentStyle.fontWeight),
                    nextSize: parseFloat(nextStyle.fontSize), nextWeight: Number(nextStyle.fontWeight), nextStyle: nextStyle.fontStyle,
                    below: next.getBoundingClientRect().top >= current.getBoundingClientRect().bottom,
                  };
                });
                assert.ok(hierarchy.currentSize >= 26 && hierarchy.currentSize > hierarchy.nextSize);
                assert.ok(hierarchy.currentWeight >= 700);
                assert.equal(hierarchy.nextWeight, 400);
                assert.equal(hierarchy.nextStyle, 'italic');
                assert.equal(hierarchy.below, true);
              }
              const result = await new AxeBuilder({ page }).analyze();
              assert.deepEqual(result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })), [], `${scheme} ${step}`);
              assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${scheme} ${step} overflow`);
            }
            await tapConfirm(button(page, 'Lopeta'));
          }
        });
      });
    } finally { await browser.close(); }
  }
} finally { server.kill(); }
