import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, webkit, devices, startServer, tap, openSettings } from './support.mjs';

const { server, url } = await startServer();
try {
  for (const [engine, type, device] of [['chromium', chromium, 'Pixel 7'], ['webkit', webkit, 'iPhone 14']]) {
    const browser = await type.launch();
    try {
      await test(`${engine}: Finnish exercise library`, async (t) => {
        const run = async (title, fn) => t.test(title, { timeout: 20000 }, async () => {
          const context = await browser.newContext({ ...devices[device], serviceWorkers: 'block', locale: 'en-US' });
          const page = await context.newPage(); page.setDefaultTimeout(5000);
          try { await page.goto(url); await fn(page, context); } finally { await context.close(); }
        });
        const button = (p, name) => p.getByRole('button', { name, exact: true });
        const newPlan = async (p) => { await tap(button(p, 'Uusi harjoitus')); await p.locator('[data-f="rname"]').fill('Kirjastotesti'); };
        const open = async (p) => { await newPlan(p); await tap(button(p, 'Lisää liike')); };
        const select = async (p, id, value) => {
          await p.locator(`#${id} summary`).click();
          await p.locator(`#${id} input[value="${value}"]`).check();
        };
        const custom = async (p, name) => {
          await p.locator('.custom-exercise > summary').click();
          await p.locator('[data-custom="name"]').fill(name);
          await select(p, 'custom-category', 'Selkä');
          await select(p, 'custom-equipment', 'Talja');
        };
        await run('Finnish language, identity, validation and labels regardless of browser locale', async (p) => {
          assert.equal(await p.locator('html').getAttribute('lang'), 'fi');
          assert.equal(await p.title(), 'Treenipäiväkirja');
          await tap(button(p, 'Uusi harjoitus')); await tap(button(p, 'Tallenna harjoitus'));
          assert.match(await p.locator('#err').innerText(), /Anna harjoitukselle nimi/);
          assert.equal(await p.locator('#err').evaluate((e) => e === document.activeElement), true);
        });
        await run('search retains focus and supports aliases, accents and combined filters', async (p) => {
          await open(p);
          await p.locator('#exercise-search').fill('bench press');
          assert.ok(await p.locator('[data-id="lib-penkkipunnerrus"]').isVisible());
          assert.equal(await p.locator('#exercise-search').evaluate((e) => e === document.activeElement), true);
          await p.locator('#exercise-search').fill('ylatalja');
          assert.ok(await p.locator('.exercise-choice').count() >= 4);
          await select(p, 'library-category', 'Selkä');
          await select(p, 'library-equipment', 'Talja');
          assert.ok(await p.locator('.exercise-choice').count() >= 4);
          assert.ok((await p.locator('.choice-meta').allTextContents()).every((s) => s.includes('Selkä · Talja')));
        });
        await run('selection fills a blank slot and preserves the draft after reload', async (p) => {
          await open(p); await p.locator('#exercise-search').fill('lankku');
          await tap(p.locator('[data-id="lib-lankku"]'));
          assert.equal(await p.locator('[data-f="name"]').count(), 1);
          assert.equal(await p.locator('[data-f="reps"]').inputValue(), '30 s');
          await p.reload();
          assert.equal(await p.locator('[data-f="name"]').inputValue(), 'Lankku');
          await tap(button(p, 'Tallenna harjoitus'));
          assert.ok(await p.getByRole('heading', { name: 'Kirjastotesti', exact: true }).isVisible());
        });
        await run('replacing an existing exercise preserves manual sets, target and load', async (p) => {
          await tap(button(p, 'Muokkaa: Koko keho A'));
          await p.locator('[data-f="sets"]').first().fill('4');
          await p.locator('[data-f="reps"]').first().fill('7');
          await p.locator('[data-f="weight"]').first().fill('62,5 kg');
          await tap(button(p, 'Valitse kirjastosta').first());
          await p.locator('#exercise-search').fill('etukyykky'); await tap(p.locator('[data-id="lib-etukyykky"]'));
          assert.equal(await p.locator('[data-f="name"]').first().inputValue(), 'Etukyykky');
          assert.equal(await p.locator('[data-f="sets"]').first().inputValue(), '4');
          assert.equal(await p.locator('[data-f="reps"]').first().inputValue(), '7');
          assert.equal(await p.locator('[data-f="weight"]').first().inputValue(), '62,5 kg');
        });
        await run('no-results path creates a reusable own exercise and exports it', async (p) => {
          await open(p); await p.locator('#exercise-search').fill('Oma ääkkösliike');
          assert.ok(await p.locator('#library-empty').isVisible());
          await tap(button(p, 'Lisää haettu nimi omana liikkeenä'));
          assert.equal(await p.locator('[data-custom="name"]').inputValue(), 'Oma ääkkösliike');
          await tap(button(p, 'Tallenna ja lisää harjoitukseen'));
          assert.equal(await p.locator('[data-f="name"]').inputValue(), 'Oma ääkkösliike');
          await tap(button(p, 'Lisää liike')); await p.locator('#library-own').check();
          assert.equal(await p.locator('.exercise-choice').count(), 1);
          await tap(button(p, 'Takaisin harjoitukseen')); await tap(button(p, 'Tallenna harjoitus'));
          await p.reload();
          await openSettings(p); const download = p.waitForEvent('download'); await tap(button(p, 'Vie varmuuskopio'));
          const backup = JSON.parse(await readFile(await (await download).path(), 'utf8'));
          assert.equal(backup.data.customExercises[0].name, 'Oma ääkkösliike');
        });
        await run('own-exercise write failure retains form and never pretends it saved', async (p) => {
          await open(p); await custom(p, 'Säilytä tämä liike');
          await p.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('quota'); }; });
          await tap(button(p, 'Tallenna ja lisää harjoitukseen'));
          assert.equal(await p.locator('[data-custom="name"]').inputValue(), 'Säilytä tämä liike');
          assert.ok(await p.getByRole('alert').filter({ hasText: 'Tallennus vaatii huomiota' }).isVisible());
          assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('gym-tracker-v1') || '{"customExercises":[]}').customExercises?.length || 0), 0);
        });
        await run('duplicate own exercise is refused without erasing form input', async (p) => {
          await open(p); await custom(p, 'Oma soutu'); await tap(button(p, 'Tallenna ja lisää harjoitukseen'));
          await tap(button(p, 'Lisää liike')); await custom(p, 'Oma soutu'); await tap(button(p, 'Tallenna ja lisää harjoitukseen'));
          assert.match(await p.locator('#custom-error').innerText(), /on jo kirjastossa/);
          assert.equal(await p.locator('[data-custom="name"]').inputValue(), 'Oma soutu');
        });
        await run('custom names render as text, never injected HTML', async (p) => {
          await open(p); await custom(p, '<img src=x onerror=window.__bad=1>');
          await tap(button(p, 'Tallenna ja lisää harjoitukseen'));
          await tap(button(p, 'Lisää liike')); await p.locator('#library-own').check();
          assert.match(await p.locator('.exercise-choice strong').innerText(), /<img/);
          assert.equal(await p.locator('.exercise-choice img').count(), 0);
          assert.equal(await p.evaluate(() => window.__bad || null), null);
        });
        await run('load-more exposes additional exercises and back navigation keeps the plan', async (p) => {
          await open(p); assert.equal(await p.locator('.exercise-choice').count(), 40);
          await tap(button(p, 'Näytä lisää liikkeitä')); assert.equal(await p.locator('.exercise-choice').count(), 80);
          await tap(button(p, 'Takaisin harjoitukseen'));
          assert.equal(await p.locator('[data-f="rname"]').inputValue(), 'Kirjastotesti');
          assert.equal(await p.locator('[data-f="name"]').count(), 1);
        });
      });
    } finally { await browser.close(); }
  }
} finally { server.kill(); }