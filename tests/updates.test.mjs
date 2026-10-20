import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import * as core from '../core.js';
import { chromium, webkit, devices, AxeBuilder, root, tap } from './support.mjs';

let release = 1;
let failDownload = false;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!/^[\w.-]+$/.test(name) || (failDownload && name === 'progression.js')) { res.writeHead(503); res.end(); return; }
  try {
    let body = await readFile(join(root, name));
    if (name === 'sw.js') body = body.toString().replace(/const VERSION = '[^']+';/, `const VERSION = 'update-test-${release}';`);
    if (name === 'app.js') body = `globalThis.testRelease = ${release};\n${body}`;
    res.writeHead(200, { 'Content-Type': types[extname(name)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/index.html`;
const button = (page, name) => page.getByRole('button', { name, exact: true });
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('gym-tracker-v1')));
async function ready(page) {
  await page.goto(url);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller && globalThis.testRelease === 1);
}
async function offer(page) {
  release = 2;
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
  await button(page, 'Päivitä nyt').waitFor();
}
async function updated(page) {
  await tap(button(page, 'Päivitä nyt'));
  await page.waitForFunction(() => globalThis.testRelease === 2);
  await page.locator('h1').waitFor();
}

try {
  for (const [name, engine, device] of [['chromium', chromium, 'Pixel 7'], ['webkit', webkit, 'iPhone 14']]) {
    const browser = await engine.launch();
    try {
      await test(`${name}: installed-app updates`, async (t) => {
        const run = async (title, work) => t.test(title, { timeout: 45000 }, async () => {
          release = 1; failDownload = false;
          const context = await browser.newContext({ ...devices[device], reducedMotion: 'reduce' });
          const page = await context.newPage();
          page.setDefaultTimeout(8000);
          const errors = [];
          page.on('pageerror', (error) => errors.push(error.message));
          try { await work(page, context); assert.deepEqual(errors, []); }
          finally { await context.close(); }
        });

        await run('first installation is quiet; a waiting update offers now/later without reloading or stealing focus', async (page) => {
          await ready(page);
          assert.equal(await page.locator('#update-notice').isVisible(), false);
          await tap(button(page, 'Uusi harjoitus'));
          await page.locator('[data-f="rname"]').fill('Luonnos');
          await page.locator('[data-f="name"]').first().fill('Oma liike');
          await page.locator('[data-f="rname"]').focus();
          await offer(page);
          assert.equal(await page.evaluate(() => globalThis.testRelease), 1);
          assert.equal(await page.locator('[data-f="rname"]').evaluate((e) => e === document.activeElement), true);
          assert.equal(await page.locator('[data-f="rname"]').inputValue(), 'Luonnos');
          await tap(button(page, 'Myöhemmin'));
          assert.equal(await page.locator('#update-notice').isVisible(), false);
          await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
          await button(page, 'Päivitä nyt').waitFor();
          await updated(page);
          assert.equal(await page.locator('[data-f="rname"]').inputValue(), 'Luonnos');
          assert.equal(await page.locator('[data-f="name"]').first().inputValue(), 'Oma liike');
        });

        await run('resuming the app checks for a newly deployed version and cold icon launch offers existing waiting updates', async (page) => {
          await ready(page);
          release = 2;
          await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
          await button(page, 'Päivitä nyt').waitFor();
          await tap(button(page, 'Myöhemmin'));
          await page.goto(url);
          await button(page, 'Päivitä nyt').waitFor();
          assert.equal(await page.evaluate(() => globalThis.testRelease), 1);
          await updated(page);
          assert.equal(await page.locator('#update-notice').isVisible(), false);
        });

        await run('acceptance preserves historical data, running sets, targets, rest timer and unrelated caches', async (page) => {
          await ready(page);
          const state = core.defaultState();
          state.history = [{ id: 'legacy', name: 'Vanha', startedAt: 1000, endedAt: 2000, setsDone: 2, setsTotal: 3 }];
          state.session = core.startSession(state.routines[0]);
          Object.assign(state.session.exercises[0].sets[0], { done: true, actualReps: '4', actualWeight: '55 kg' });
          state.session.exercises[0].rir = '1';
          state.restEnd = Date.now() + 60000;
          await page.evaluate(async (state) => {
            localStorage.setItem('gym-tracker-v1', JSON.stringify(state));
            await caches.open('unrelated-app');
          }, state);
          await page.reload();
          await offer(page);
          await updated(page);
          assert.deepEqual(await saved(page), state);
          assert.equal(await page.locator('[data-key="s0-0"]').getAttribute('aria-pressed'), 'true');
          assert.equal(await page.evaluate(async () => (await caches.keys()).includes('unrelated-app')), true);
          assert.equal(await page.evaluate(async () => (await caches.keys()).includes('gym-tracker-vupdate-test-1')), false);
        });

        await run('another window is never force-updated; closing it lets the accepted update proceed', async (page, context) => {
          await ready(page);
          const other = await context.newPage(); await other.goto(url);
          await other.locator('h1').waitFor();
          await offer(page);
          await tap(button(page, 'Päivitä nyt'));
          await page.locator('#update-notice').getByText(/Sulje muut tämän sovelluksen ikkunat ja selaimen/).waitFor();
          assert.equal(await page.evaluate(() => globalThis.testRelease), 1);
          assert.equal(await other.evaluate(() => globalThis.testRelease), 1);
          await other.close();
          await updated(page);
        });

        await run('offline relaunch keeps the cached app; reconnect offers an update that can then be applied offline', async (page, context) => {
          await ready(page);
          await page.reload();
          await context.setOffline(true);
          release = 2;
          await page.goto(url);
          await page.locator('h1').waitFor();
          assert.equal(await page.evaluate(() => globalThis.testRelease), 1);
          assert.equal(await page.locator('#update-notice').isVisible(), false);
          await context.setOffline(false);
          await page.evaluate(() => window.dispatchEvent(new Event('online')));
          await button(page, 'Päivitä nyt').waitFor();
          await context.setOffline(true);
          await updated(page);
        });

        await run('registration failure stays explicit below the app and retry preserves the editor', async (page) => {
          await page.addInitScript(() => {
            const register = navigator.serviceWorker.register;
            window.restoreRegistration = () => { navigator.serviceWorker.register = register; };
            navigator.serviceWorker.register = async () => { throw new Error('Registration denied'); };
          });
          await page.goto(url);
          await page.locator('#update-notice').getByText(/sivusto-oikeudet/).waitFor();
          assert.equal(await page.evaluate(() => !!(document.getElementById('app').compareDocumentPosition(document.getElementById('update-notice')) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
          await tap(button(page, 'Uusi harjoitus'));
          await page.locator('[data-f="rname"]').fill('Säilyvä luonnos');
          await page.evaluate(() => window.restoreRegistration());
          await tap(button(page, 'Yritä uudelleen'));
          await page.waitForFunction(() => !!navigator.serviceWorker.controller);
          assert.equal(await page.locator('#update-notice').isVisible(), false);
          assert.equal(await page.locator('[data-f="rname"]').inputValue(), 'Säilyvä luonnos');
          assert.equal(await page.evaluate(() => globalThis.testRelease), 1);
        });

        await run('a failed draft save blocks reload until the same in-memory draft can be saved', async (page) => {
          await ready(page); await offer(page);
          await page.evaluate(() => {
            window.originalSetItem = Storage.prototype.setItem;
            Storage.prototype.setItem = function (key, value) {
              if (key === 'gym-tracker-draft-v1') throw new DOMException('quota', 'QuotaExceededError');
              return window.originalSetItem.call(this, key, value);
            };
          });
          await tap(button(page, 'Uusi harjoitus'));
          await page.locator('[data-f="rname"]').fill('Ei saa kadota');
          await tap(button(page, 'Päivitä nyt'));
          await page.locator('#update-notice').getByText(/Muokkausluonnosta ei voitu tallentaa/).waitFor();
          assert.equal(await page.evaluate(() => globalThis.testRelease), 1);
          assert.equal(await page.locator('[data-f="rname"]').inputValue(), 'Ei saa kadota');
          await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; });
          await updated(page);
          assert.equal(await page.locator('[data-f="rname"]').inputValue(), 'Ei saa kadota');
        });

        await run('unsaved workout progress blocks activation and survives a successful storage retry', async (page) => {
          await ready(page);
          await tap(button(page, 'Aloita harjoitus'));
          await offer(page);
          const before = await saved(page);
          await page.evaluate(() => {
            window.originalSetItem = Storage.prototype.setItem;
            Storage.prototype.setItem = function (key, value) {
              if (key === 'gym-tracker-v1') throw new DOMException('quota', 'QuotaExceededError');
              return window.originalSetItem.call(this, key, value);
            };
          });
          await tap(page.locator('[data-key="s0-0"]'));
          await tap(button(page, 'Päivitä nyt'));
          await page.locator('#update-notice').getByText(/kaikkia harjoitustietoja ei ole tallennettu/).waitFor();
          assert.equal(await page.evaluate(() => globalThis.testRelease), 1);
          assert.deepEqual(await saved(page), before);
          assert.equal(await page.locator('[data-key="s0-0"]').getAttribute('aria-pressed'), 'true');
          await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; });
          await updated(page);
          assert.equal((await saved(page)).session.exercises[0].sets[0].done, true);
          assert.equal((await saved(page)).session.id, before.session.id);
        });

        await run('failed asset download retains the old version and can be retried without clearing storage', async (page) => {
          await ready(page);
          await tap(button(page, 'Aloita harjoitus'));
          await tap(page.locator('[data-key="s0-0"]'));
          const before = await saved(page);
          release = 2; failDownload = true;
          await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
          await page.locator('#update-notice').getByText(/Uuden version lataus ei valmistunut/).waitFor();
          assert.equal(await page.evaluate(() => globalThis.testRelease), 1);
          assert.deepEqual(await saved(page), before);
          failDownload = false;
          await tap(button(page, 'Yritä uudelleen'));
          await button(page, 'Päivitä nyt').waitFor();
          await updated(page);
          assert.deepEqual(await saved(page), before);
        });

        await run('the update offer is accessible on small screens in both color schemes', async (page) => {
          await ready(page); await offer(page);
          await page.setViewportSize({ width: 320, height: 640 });
          for (const colorScheme of ['dark', 'light']) {
            await page.emulateMedia({ colorScheme });
            assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id), []);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          }
        });
      });
    } finally { await browser.close(); }
  }
} finally { await new Promise((resolve) => server.close(resolve)); }
