import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { join, extname } from 'node:path';
import * as core from '../core.js';
import { chromium, webkit, devices, AxeBuilder, root, tap } from './support.mjs';

let release = 1;
let failDownload = false;
let numericVersions = false;
let failAsset = 'progression.js';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!/^[\w.-]+$/.test(name) || (failDownload && name === failAsset)) { res.writeHead(503); res.end(); return; }
  try {
    let body = await readFile(join(root, name));
    if (name === 'sw.js') body = body.toString().replace(/const VERSION = '[^']+';/, `const VERSION = '${numericVersions ? (release === 1 ? 34 : 38) : `update-test-${release}`}';`);
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
  await test('service worker accepts an update unless another visible window of the app exists', async () => {
    const source = await readFile(join(root, 'sw.js'), 'utf8');
    const scope = 'https://app.test/';
    const client = (id, visibilityState, path = 'index.html') => ({ id, visibilityState, url: `${scope}${path}` });
    const apply = async (clients, sourceId) => {
      const listeners = []; let skipped = false; const work = []; const replies = [];
      vm.runInNewContext(source, {
        self: { addEventListener: (name, fn) => { if (name === 'message') listeners.push(fn); }, registration: { scope }, clients: { matchAll: async () => clients }, skipWaiting: async () => { skipped = true; } },
        location: { origin: 'https://app.test' }, URL,
      });
      for (const fn of listeners) fn({ data: { type: 'APPLY_UPDATE' }, source: { id: sourceId }, ports: [{ postMessage: (m) => replies.push(m) }], waitUntil: (p) => work.push(p) });
      await Promise.all(work);
      return { reply: replies[0], skipped };
    };
    assert.deepEqual(JSON.parse(JSON.stringify(await apply([client('a', 'visible')], 'a'))), { reply: { ok: true }, skipped: true });
    assert.equal((await apply([client('a', 'visible'), client('b', 'hidden')], 'a')).reply.ok, true);
    assert.equal((await apply([client('a', 'visible'), { id: 'c', visibilityState: 'visible', url: 'https://app.test.evil/' }], 'a')).reply.ok, true);
    assert.deepEqual(JSON.parse(JSON.stringify(await apply([client('a', 'visible'), client('b', 'visible')], 'a'))), { reply: { ok: false, reason: 'other-windows' }, skipped: false });
    assert.equal((await apply([client('a', 'hidden'), client('b', 'visible', 'x/index.html')], 'a')).reply.ok, false);
    assert.equal((await apply([client('b', 'hidden')], 'a')).reply.ok, false);
  });

  for (const [name, engine, device] of [['chromium', chromium, 'Pixel 7'], ['webkit', webkit, 'iPhone 14']]) {
    const browser = await engine.launch();
    try {
      await test(`${name}: installed-app updates`, async (t) => {
        const run = async (title, work) => t.test(title, { timeout: 45000 }, async () => {
          release = 1; failDownload = false; numericVersions = false; failAsset = 'progression.js';
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
          await tap(button(page,           'Luo treeniohjelma'));
          await tap(button(page, 'Kuntosalitreeni'));
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

        await run('resuming the app checks for a newly deployed version and cold icon launch applies an existing waiting update', async (page) => {
          await ready(page);
          release = 2;
          await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
          await button(page, 'Päivitä nyt').waitFor();
          await tap(button(page, 'Myöhemmin'));
          await page.goto(url);
          await page.waitForFunction(() => globalThis.testRelease === 2);
          await page.locator('h1').waitFor();
          assert.equal(await page.locator('#update-notice').isVisible(), false);
        });

        await run('reloading with a downloaded update applies it automatically and keeps saved data', async (page) => {
          await ready(page);
          const state = core.defaultState();
          state.history = [{ id: 'legacy', name: 'Vanha', startedAt: 1000, endedAt: 2000, setsDone: 2, setsTotal: 3 }];
          state.session = core.startSession(state.routines[0]);
          Object.assign(state.session.exercises[0].sets[0], { done: true, actualReps: '4', actualWeight: '55 kg' });
          await page.evaluate((state) => localStorage.setItem('gym-tracker-v1', JSON.stringify(state)), state);
          await page.reload();
          await offer(page);
          await page.reload();
          await page.waitForFunction(() => globalThis.testRelease === 2);
          await page.locator('h1').waitFor();
          assert.deepEqual(await saved(page), state);
        });

        await run('reload keeps the offer, without an error, while another visible window is open', async (page, context) => {
          await ready(page);
          const other = await context.newPage(); await other.goto(url);
          await other.locator('h1').waitFor();
          await offer(page);
          await page.reload();
          await page.locator('[data-key="installupdate"]:not([disabled])').waitFor();
          assert.doesNotMatch(await page.locator('#update-notice').innerText(), /Sulje muut tämän sovelluksen ikkunat ja selaimen/);
          assert.equal(await page.evaluate(() => globalThis.testRelease), 1);
          assert.equal(await other.evaluate(() => globalThis.testRelease), 1);
        });

        await run('a recent automatic attempt is not repeated on reload', async (page) => {
          await ready(page); await offer(page);
          await page.evaluate(() => sessionStorage.setItem('gym-tracker-auto-update', String(Date.now())));
          await page.reload();
          await page.locator('[data-key="installupdate"]:not([disabled])').waitFor();
          assert.equal(await page.evaluate(() => globalThis.testRelease), 1);
        });

        await run('accepting an update still reloads when the browser never reports controllerchange', async (page) => {
          await page.addInitScript(() => {
            const add = ServiceWorkerContainer.prototype.addEventListener;
            ServiceWorkerContainer.prototype.addEventListener = function (type, ...rest) { if (type !== 'controllerchange') add.call(this, type, ...rest); };
          });
          await ready(page); await offer(page);
          await updated(page);
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
                    await tap(button(page, 'Luo treeniohjelma'));
          await tap(button(page, 'Kuntosalitreeni'));
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
          await tap(button(page, 'Luo treeniohjelma'));
          await tap(button(page, 'Kuntosalitreeni'));
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

        await run('the appearance choice and a cache from before the themes existed survive an update', async (page) => {
          await ready(page);
          await page.evaluate(async () => {
            localStorage.setItem('gym-tracker-appearance-v1', 'aurora');
            const cache = await caches.open('gym-tracker-vupdate-test-1');
            await cache.delete('./aurora.css'); await cache.delete('./appearance.js');
          });
          const before = await saved(page);
          await page.reload();
          assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'aurora');
          await offer(page);
          await updated(page);
          assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'aurora');
          assert.equal(await page.evaluate(() => localStorage.getItem('gym-tracker-appearance-v1')), 'aurora');
          assert.deepEqual(await saved(page), before);
          assert.equal(await page.evaluate(async () => (await caches.match('./aurora.css')) !== undefined && (await caches.match('./appearance.js')) !== undefined), true);
        });

        await run('a failed download of the new theme files retains the old version and the saved choice', async (page) => {
          await ready(page);
          await page.evaluate(() => localStorage.setItem('gym-tracker-appearance-v1', 'aurora'));
          const before = await saved(page);
          release = 2; failDownload = true; failAsset = 'aurora.css';
          await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
          await page.locator('#update-notice').getByText(/Uuden version lataus ei valmistunut/).waitFor();
          assert.equal(await page.evaluate(() => globalThis.testRelease), 1);
          assert.equal(await page.evaluate(() => localStorage.getItem('gym-tracker-appearance-v1')), 'aurora');
          assert.deepEqual(await saved(page), before);
          failDownload = false;
          await tap(button(page, 'Yritä uudelleen'));
          await button(page, 'Päivitä nyt').waitFor();
          await updated(page);
          assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'aurora');
        });

        await run('the popup lists the changes of every version newer than the running one, in order', async (page) => {
          numericVersions = true;
          await ready(page); await offer(page);
          const notes = page.locator('#update-notice .release-notes');
          await notes.waitFor();
          const versions = await notes.locator('.release-version').allInnerTexts();
          assert.deepEqual(versions, ['Versio 38', 'Versio 37', 'Versio 36', 'Versio 35']);
          assert.match(await notes.innerText(), /Päivitysikkuna kertoo nyt, mitä muutoksia/);
          assert.doesNotMatch(await notes.innerText(), /Varmuuskopiointi siirretty Asetuksiin/);
          assert.equal(await page.locator('#update-notice').getByRole('button', { name: 'Päivitä nyt', exact: true }).isVisible(), true);
          await updated(page);
          assert.equal(await page.locator('#update-notice').isVisible(), false);
        });

        await run('without comparable version numbers the popup still shows the newest change list', async (page) => {
          await ready(page); await offer(page);
          const notes = page.locator('#update-notice .release-notes');
          await notes.waitFor();
          assert.equal(await notes.locator('.release-version').count(), 1);
        });

        await run('a waiting version installed while page events were missed is offered when the app resumes', async (page) => {
          await page.addInitScript(() => { ServiceWorker.prototype.addEventListener = () => {}; });
          await ready(page);
          release = 2;
          await page.evaluate(async () => {
            const registration = await navigator.serviceWorker.getRegistration();
            await registration.update();
          });
          assert.equal(await page.evaluate(async () => {
            const registration = await navigator.serviceWorker.getRegistration();
            for (let i = 0; i < 80 && !registration.waiting; i++) await new Promise((resolve) => setTimeout(resolve, 100));
            return !!registration.waiting;
          }), true);
          assert.equal(await page.locator('#update-notice').isVisible(), false);
          await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
          await button(page, 'Päivitä nyt').waitFor();
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
