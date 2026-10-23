import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../core.js';
import { chromium, webkit, devices, AxeBuilder, startServer, openSettings } from './support.mjs';
import { configuredState } from './statistics-fixtures.mjs';

const { server, url } = await startServer();
const FOLDER = 'backups';
const toggle = (page) => page.locator('[data-key="autobackup"]');
const saved = (page) => page.evaluate(() => localStorage.getItem('gym-tracker-v1'));
const localDay = (page) => page.evaluate(() => new Date().toLocaleDateString('sv-SE'));
const files = (page) => page.evaluate(async (name) => {
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
  const out = {};
  for await (const [file, handle] of dir.entries()) {
    try { out[file] = await (await handle.getFile()).text(); } catch { /* The file is being replaced right now. */ }
  }
  return out;
}, FOLDER);
const waitFiles = async (page, check) => {
  const deadline = Date.now() + 8000;
  for (;;) {
    const current = await files(page);
    let met = false;
    try { met = Boolean(check(current)); } catch { /* A file is not there yet. */ }
    if (met) return current;
    if (Date.now() > deadline) throw new Error(`Timed out; files: ${Object.keys(current)}`);
    await page.waitForTimeout(100);
  }
};
// Asks the app to flush a pending backup the way it does when the page is backgrounded.
const background = async (page) => {
  await page.waitForFunction(() => document.getElementById('app').getAttribute('aria-busy') !== 'true');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    delete document.visibilityState;
  });
};
const enableLogging = async (page) => {
  await page.locator('[data-key="advancedlogging"]').check();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('gym-tracker-v1')).settings.advancedLogging === true);
};
async function seed(page, state = configuredState()) {
  await page.goto(url);
  await page.evaluate((value) => localStorage.setItem('gym-tracker-v1', JSON.stringify(value)), state);
  await page.reload();
  await page.locator('h1').waitFor();
  await openSettings(page);
}
// The real picker needs a native dialog; an OPFS folder stands in for it. Permission follows sessionStorage.
const stubPicker = (folder) => {
  window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(folder, { create: true });
  const permission = () => sessionStorage.getItem('perm') ?? 'granted';
  FileSystemHandle.prototype.queryPermission = async () => permission();
  FileSystemHandle.prototype.requestPermission = async () => { sessionStorage.setItem('perm', 'granted'); return 'granted'; };
};

try {
  for (const [name, engine, device] of [['chromium', chromium, 'Pixel 7'], ['webkit', webkit, 'iPhone 14']]) {
    const browser = await engine.launch();
    try {
      await test(`${name}: automatic folder backup`, async (t) => {
        const run = async (title, work, { stub = name === 'chromium' } = {}) => t.test(title, { timeout: 60000 }, async () => {
          const context = await browser.newContext({ ...devices[device], reducedMotion: 'reduce', serviceWorkers: 'block' });
          if (stub) await context.addInitScript(stubPicker, FOLDER);
          const page = await context.newPage();
          page.setDefaultTimeout(8000);
          const errors = [];
          page.on('pageerror', (e) => errors.push(e.message));
          try { await work(page); assert.deepEqual(errors, []); }
          finally { await context.close(); }
        });

        if (name === 'webkit') {
          await run('unsupported browsers see a disabled switch with an explanation and stay accessible', async (page) => {
            await seed(page);
            assert.equal(await toggle(page).isDisabled(), true);
            assert.match(await page.locator('#autobackup-status').innerText(), /iPhone/);
            const results = await new AxeBuilder({ page }).analyze();
            assert.deepEqual(results.violations.map((v) => v.id), []);
          }, { stub: false });
          return;
        }

        await run('enabling writes the latest and the day copy without touching saved data', async (page) => {
          const state = configuredState();
          await seed(page, state);
          const before = await saved(page);
          assert.equal(await toggle(page).isChecked(), false);
          await toggle(page).check();
          const day = await localDay(page);
          const written = await waitFiles(page, (f) => f['gym-tracker-auto-uusin.json'] && f[`gym-tracker-auto-${day}.json`]);
          assert.deepEqual(Object.keys(written).sort(), [`gym-tracker-auto-${day}.json`, 'gym-tracker-auto-uusin.json']);
          const parsed = core.parseBackup(written['gym-tracker-auto-uusin.json']);
          assert.ok(parsed.ok);
          assert.equal(parsed.state.history.length, state.history.length);
          assert.equal(written['gym-tracker-auto-uusin.json'], written[`gym-tracker-auto-${day}.json`]);
          assert.equal(await saved(page), before, 'enabling never changes the training data');
          assert.equal(await toggle(page).isChecked(), true);
          await page.getByText(/Viimeisin kopio:/).waitFor();
          assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).filter((k) => /auto|folder/i.test(k))), []);
          const results = await new AxeBuilder({ page }).analyze();
          assert.deepEqual(results.violations.map((v) => v.id), []);
        });

        await run('a later change updates the latest copy but never the day copy', async (page) => {
          await seed(page);
          await toggle(page).check();
          const day = await localDay(page);
          const first = await waitFiles(page, (f) => f['gym-tracker-auto-uusin.json'] && f[`gym-tracker-auto-${day}.json`]);
          await enableLogging(page);
          await background(page);
          const next = await waitFiles(page, (f) => core.parseBackup(f['gym-tracker-auto-uusin.json']).state.settings.advancedLogging === true);
          assert.equal(next[`gym-tracker-auto-${day}.json`], first[`gym-tracker-auto-${day}.json`]);
          assert.equal(core.parseBackup(next[`gym-tracker-auto-${day}.json`]).state.settings.advancedLogging, false);
        });

        await run('the choice survives a reload', async (page) => {
          await seed(page);
          await toggle(page).check();
          await waitFiles(page, (f) => f['gym-tracker-auto-uusin.json']);
          await page.reload();
          await page.locator('h1').waitFor();
          await openSettings(page);
          await page.waitForFunction(() => document.querySelector('[data-key="autobackup"]')?.checked === true);
        });

        await run('old copies beyond 14 days are pruned and foreign files stay', async (page) => {
          await seed(page);
          await page.evaluate(async (name) => {
            const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
            const put = async (file) => { const w = await (await dir.getFileHandle(file, { create: true })).createWritable(); await w.write('old'); await w.close(); };
            for (let i = 1; i <= 16; i++) await put(`gym-tracker-auto-2020-01-${String(i).padStart(2, '0')}.json`);
            await put('notes.txt');
          }, FOLDER);
          await toggle(page).check();
          const out = await waitFiles(page, (f) => Object.keys(f).filter((n) => /^gym-tracker-auto-\d{4}/.test(n)).length === 14 && f['gym-tracker-auto-uusin.json']);
          assert.equal(out['notes.txt'], 'old');
          assert.equal(out['gym-tracker-auto-2020-01-01.json'], undefined);
          assert.equal(out['gym-tracker-auto-2020-01-16.json'], 'old');
        });

        await run('missing permission shows a button and flag, never blocks saving, and granting writes the copy', async (page) => {
          await seed(page);
          await toggle(page).check();
          await waitFiles(page, (f) => f['gym-tracker-auto-uusin.json']);
          await page.evaluate(() => sessionStorage.setItem('perm', 'prompt'));
          await page.reload();
          await page.locator('h1').waitFor();
          await openSettings(page);
          const grant = page.locator('[data-key="autobackup-grant"]');
          await grant.waitFor();
          assert.match(await page.locator('#autobackup-status').innerText(), /Selain tarvitsee luvan/);
          await enableLogging(page);
          assert.equal(JSON.parse(await saved(page)).settings.advancedLogging, true, 'the data is saved without the folder permission');
          await background(page);
          await page.waitForTimeout(400);
          assert.equal(core.parseBackup((await files(page))['gym-tracker-auto-uusin.json']).state.settings.advancedLogging, false, 'nothing is written without permission');
          await grant.click();
          await waitFiles(page, (f) => core.parseBackup(f['gym-tracker-auto-uusin.json']).state.settings.advancedLogging === true);
          await page.locator('[data-key="autobackup-grant"]').waitFor({ state: 'detached' });
        });

        await run('turning it off stops writing and keeps the files', async (page) => {
          await seed(page);
          await toggle(page).check();
          await waitFiles(page, (f) => f['gym-tracker-auto-uusin.json']);
          await toggle(page).uncheck();
          await page.locator('[data-key="autobackup-folder"]').waitFor({ state: 'detached' });
          const before = await files(page);
          await enableLogging(page);
          await background(page);
          await page.waitForTimeout(400);
          assert.deepEqual(await files(page), before);
          await page.reload();
          await page.locator('h1').waitFor();
          await openSettings(page);
          assert.equal(await toggle(page).isChecked(), false);
        });

        await run('a folder the browser refuses leaves the switch off and explains why', async (page) => {
          await seed(page);
          await page.evaluate(() => { window.showDirectoryPicker = async () => { throw new DOMException('system folder', 'SecurityError'); }; });
          await toggle(page).click();
          await page.getByText(/Selain ei salli tätä kansiota/).waitFor();
          assert.equal(await toggle(page).isChecked(), false);
          await page.evaluate(() => { window.showDirectoryPicker = async () => { throw new DOMException('cancel', 'AbortError'); }; });
          await toggle(page).click();
          await page.waitForFunction(() => !document.getElementById('autobackup-status').textContent.includes('Selain ei salli'));
          assert.equal(await toggle(page).isChecked(), false);
        });

        await run('an empty history never replaces the latest copy', async (page) => {
          await seed(page, core.defaultState());
          await toggle(page).check();
          await page.waitForTimeout(600);
          assert.deepEqual(await files(page), {});
          assert.match(await page.locator('#autobackup-status').innerText(), /ensimmäinen harjoitus/);
        });
      });
    } finally { await browser.close(); }
  }
} finally { server.kill(); }

