import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { chromium, webkit, devices, startServer, root, tap, tapConfirm } from './support.mjs';
import { join } from 'node:path';

const { server, url } = await startServer();
try {
  await test('server rejects writes and sends a restrictive script policy', async () => {
    const r = await fetch(url, { method: 'POST' });
    assert.equal(r.status, 405);
    const home = await fetch(url);
    assert.match(home.headers.get('content-security-policy') ?? '', /script-src 'self'/);
  });

  await test('launcher only targets the absolute Tracker server path', async () => {
    const bat = await readFile(join(root, 'start.bat'), 'utf8');
    assert.doesNotMatch(bat, /\*tools\*serve\.mjs\*/);
  });

  await test('service worker leaves unrelated origin caches untouched', async () => {
    const source = await readFile(join(root, 'sw.js'), 'utf8');
    const listeners = {}, removed = [];
    vm.runInNewContext(source, {
      self: { addEventListener: (name, fn) => { listeners[name] = fn; }, clients: { claim: async () => {} } },
      caches: { keys: async () => ['other-app-cache', 'gym-tracker-v1'], delete: async (k) => { removed.push(k); } },
      location: { origin: new URL(url).origin }, URL,
    });
    let work;
    listeners.activate({ waitUntil: (p) => { work = p; } });
    await work;
    assert.equal(removed.includes('other-app-cache'), false);
  });

  await test('service worker never serves HTML for a missing offline script', async () => {
    const source = await readFile(join(root, 'sw.js'), 'utf8');
    const listeners = {};
    const cache = { match: async (r) => String(r).includes('index.html') ? new Response('<html>') : undefined };
    vm.runInNewContext(source, {
      self: { addEventListener: (name, fn) => { listeners[name] = fn; } },
      caches: { match: cache.match, open: async () => cache },
      fetch: async () => { throw new Error('offline'); },
      location: { origin: new URL(url).origin }, URL, Response,
    });
    let result;
    listeners.fetch({ request: { method: 'GET', url: `${url}missing.js`, mode: 'cors' }, respondWith: (p) => { result = p; } });
    const response = await result;
    assert.ok(response && response.status >= 400);
    assert.doesNotMatch(await response.text(), /<html>/);
  });

  for (const [name, type, device] of [['chromium', chromium, 'Pixel 7'], ['webkit', webkit, 'iPhone 14']]) {
    const browser = await type.launch();
    try {
      await test(`${name}: verified review regressions`, async (t) => {
        async function check(title, fn) {
          await t.test(title, { timeout: 20000 }, async () => {
            const context = await browser.newContext({ ...devices[device], serviceWorkers: 'block' });
            const page = await context.newPage();
            page.setDefaultTimeout(4000);
            try { await fn(page, context); } finally { await context.close(); }
          });
        }
        await check('denied localStorage getter does not blank the app', async (p) => {
          await p.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } }));
          await p.goto(url);
          await p.getByRole('heading', { name: 'Treenipäiväkirja', exact: true }).waitFor();
          assert.ok(await p.getByRole('alert').count());
        });
        await check('future-schema data is read-only and preserved byte-for-byte', async (p) => {
          await p.goto(url);
          await tap(p.getByRole('button', { name: 'Aloita harjoitus', exact: true }));
          const future = await p.evaluate(() => {
            const saved = JSON.parse(localStorage.getItem('gym-tracker-v1'));
            saved.v = 2; saved.futureFeature = { important: true };
            const raw = JSON.stringify(saved); localStorage.setItem('gym-tracker-v1', raw); return raw;
          });
          await p.reload();
          await tap(p.locator('[data-key="s0-0"]'));
          assert.equal(await p.evaluate(() => localStorage.getItem('gym-tracker-v1')), future);
          assert.ok(await p.getByRole('alert').isVisible());
        });
        await check('unreadable saved data is preserved, blocks writes, and can be exported or moved aside', async (p) => {
          await p.goto(url);
          const broken = '{"routines":[{"name":"Penkki"';
          await p.evaluate((raw) => localStorage.setItem('gym-tracker-v1', raw), broken);
          await p.reload();
          const alert = p.getByRole('alert');
          await alert.waitFor();
          assert.match(await alert.innerText(), /ei voitu lukea/);
          await tap(p.getByRole('button', { name: 'Aloita harjoitus', exact: true }));
          assert.equal(await p.evaluate(() => localStorage.getItem('gym-tracker-v1')), broken);
          const download = p.waitForEvent('download');
          await tap(p.getByRole('button', { name: 'Vie alkuperäiset tiedot' }));
          assert.equal(await readFile(await (await download).path(), 'utf8'), broken);
          await tapConfirm(p.getByRole('button', { name: 'Aloita tyhjästä' }));
          await p.getByRole('heading', { name: 'Treenipäiväkirja', exact: true }).waitFor();
          assert.equal(await alert.count(), 0);
          const rescued = await p.evaluate((raw) => Object.keys(localStorage).filter((k) => k.startsWith('gym-tracker-v1-unreadable-') && localStorage.getItem(k) === raw), broken);
          assert.equal(rescued.length, 1);
          await tap(p.getByRole('button', { name: 'Aloita harjoitus', exact: true }));
          assert.ok(await p.evaluate(() => JSON.parse(localStorage.getItem('gym-tracker-v1')).session));
        });
        await check('a newer-schema save in another tab immediately announces read-only mode', async (p, ctx) => {
          await p.goto(url); await tap(p.getByRole('button', { name: 'Aloita harjoitus', exact: true }));
          const other = await ctx.newPage(); await other.goto(url);
          const future = await other.evaluate(() => {
            const saved = JSON.parse(localStorage.getItem('gym-tracker-v1'));
            saved.v = 2; saved.futureFeature = 'preserve me';
            const raw = JSON.stringify(saved); localStorage.setItem('gym-tracker-v1', raw); return raw;
          });
          await p.getByRole('alert').waitFor();
          assert.match(await p.getByRole('alert').innerText(), /Päivitä sovellus/);
          await tap(p.locator('[data-key="s0-0"]'));
          assert.equal(await p.evaluate(() => localStorage.getItem('gym-tracker-v1')), future);
        });
        await check('pagehide cannot overwrite changes committed by another tab', async (p, ctx) => {
          await ctx.addInitScript(() => window.addEventListener('storage', (e) => e.stopImmediatePropagation()));
          await p.addInitScript(() => window.addEventListener('storage', (e) => e.stopImmediatePropagation()));
          await p.goto(url);
          await tap(p.getByRole('button', { name: 'Aloita harjoitus', exact: true }));
          const other = await ctx.newPage(); await other.goto(url);
          await tap(other.locator('[data-key="s0-0"]'));
          await p.evaluate(() => window.dispatchEvent(new Event('pagehide')));
          const saved = await other.evaluate(() => JSON.parse(localStorage.getItem('gym-tracker-v1')));
          assert.equal(saved.session.exercises[0].sets[0].done, true);
        });
        await check('concurrent stale tabs preserve independent set taps', async (p, ctx) => {
          await ctx.addInitScript(() => window.addEventListener('storage', (e) => e.stopImmediatePropagation()));
          await p.addInitScript(() => window.addEventListener('storage', (e) => e.stopImmediatePropagation()));
          await p.goto(url); await tap(p.getByRole('button', { name: 'Aloita harjoitus', exact: true }));
          const other = await ctx.newPage(); await other.goto(url);
          await tap(p.locator('[data-key="s0-0"]'));
          await tap(other.locator('[data-key="s0-1"]'));
          const saved = await other.evaluate(() => JSON.parse(localStorage.getItem('gym-tracker-v1')));
          assert.deepEqual(saved.session.exercises[0].sets.slice(0, 2).map((s) => s.done), [true, true]);
        });
        await check('conflicting template save cannot overwrite another tab', async (p, ctx) => {
          await p.goto(url); await tap(p.getByRole('button', { name: 'Muokkaa: Koko keho A', exact: true }));
          await p.locator('[data-f="name"]').first().fill('My draft');
          const other = await ctx.newPage(); await other.goto(url);
          await tap(other.getByRole('button', { name: 'Muokkaa: Koko keho A', exact: true }));
          await other.locator('[data-f="name"]').first().fill('Saved elsewhere');
          await tap(other.getByRole('button', { name: 'Tallenna harjoitus', exact: true }));
          await tap(p.getByRole('button', { name: 'Tallenna harjoitus', exact: true }));
          const stored = await p.evaluate(() => JSON.parse(localStorage.getItem('gym-tracker-v1')));
          assert.equal(stored.routines[0].exercises[0].name, 'Saved elsewhere');
          assert.ok(await p.locator('#err').isVisible());
        });
        await check('unfinished editor draft survives reload', async (p) => {
          await p.goto(url); await tap(p.getByRole('button', { name: 'Luo treeniohjelma', exact: true }));
          await p.locator('[data-f="rname"]').fill('Unsaved draft');
          await p.reload();
          assert.equal(await p.locator('[data-f="rname"]').inputValue(), 'Unsaved draft');
        });
        await check('draft storage failure is announced without losing typed text', async (p) => {
          await p.goto(url); await tap(p.getByRole('button', { name: 'Luo treeniohjelma', exact: true }));
          await p.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('quota'); }; });
          await p.locator('[data-f="rname"]').fill('Keep this text');
          assert.match(await p.locator('.editor-header').innerText(), /LUONNOS EI TALLENTUNUT/);
          assert.equal(await p.locator('[data-f="rname"]').inputValue(), 'Keep this text');
        });
        await check('wake lock has only one pending request across repeated renders', async (p) => {
          await p.addInitScript(() => {
            let count = 0;
            const gate = new Promise((resolve) => { window.releaseWakeGate = resolve; });
            Object.defineProperty(navigator, 'wakeLock', { value: {
              request: async () => { count++; await gate; return { addEventListener() {}, release: async () => {} }; },
            } });
            window.wakeRequestCount = () => count;
          });
          await p.goto(url); await tap(p.getByRole('button', { name: 'Aloita harjoitus', exact: true }));
          await tap(p.locator('[data-key="s0-0"]'));
          await tap(p.locator('[data-key="s0-1"]'));
          assert.equal(await p.evaluate(() => window.wakeRequestCount()), 1);
          await p.evaluate(() => window.releaseWakeGate());
        });
        await check('failed finish retains live session for retry', async (p) => {
          await p.goto(url); await tap(p.getByRole('button', { name: 'Aloita harjoitus', exact: true }));
          await tap(p.locator('[data-key="s0-0"]'));
          await p.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('quota'); }; });
          await tapConfirm(p.getByRole('button', { name: 'Lopeta kesken', exact: true }));
          assert.equal(await p.locator('.set').count(), 15);
          assert.ok(await p.getByRole('alert').count());
        });
        await check('retry after storage failure cannot overwrite another tabs saved progress', async (p, ctx) => {
          await p.goto(url); await tap(p.getByRole('button', { name: 'Aloita harjoitus', exact: true }));
          const other = await ctx.newPage(); await other.goto(url);
          await p.evaluate(() => {
            window.originalSetItem = Storage.prototype.setItem;
            Storage.prototype.setItem = () => { throw new Error('quota'); };
          });
          await tap(p.locator('[data-key="s0-0"]'));
          await tap(other.locator('[data-key="s0-1"]'));
          await p.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; });
          await tap(p.getByRole('button', { name: 'Yritä tallentaa uudelleen', exact: true }));
          const stored = await other.evaluate(() => JSON.parse(localStorage.getItem('gym-tracker-v1')));
          assert.equal(stored.session.exercises[0].sets[1].done, true);
        });
        await check('rapid consecutive taps are queued, never dropped', async (p) => {
          await p.goto(url); await tap(p.getByRole('button', { name: 'Aloita harjoitus', exact: true }));
          await p.evaluate(() => {
            document.querySelector('[data-key="s0-0"]').click();
            document.querySelector('[data-key="s0-1"]').click();
          });
          await p.waitForFunction(() => document.getElementById('app').getAttribute('aria-busy') === 'false');
          assert.equal(await p.locator('.set[aria-pressed="true"]').count(), 2);
        });
        await check('removing completed set requires explicit confirmation', async (p) => {
          await p.goto(url); await tap(p.getByRole('button', { name: 'Aloita harjoitus', exact: true }));
          await tap(p.locator('[data-key="s0-2"]'));
          await p.locator('[data-action="rmset"]').first().click();
          assert.equal(await p.getByRole('alertdialog').getByRole('heading').innerText(), 'Treenipäiväkirja');
          await p.getByRole('alertdialog').getByRole('button', { name: 'Peruuta' }).click();
          await p.waitForFunction(() => document.getElementById('app').getAttribute('aria-busy') !== 'true');
          assert.equal(await p.getByRole('alertdialog').count(), 0);
          assert.equal(await p.locator('.ex').first().locator('.set').count(), 3);
        });
        await check('timed exercise label is a duration, never seconds reps', async (p) => {
          await p.goto(url); await tap(p.getByRole('button', { name: 'Aloita harjoitus', exact: true }));
          const label = await p.locator('.ex').last().locator('.set').first().getAttribute('aria-label');
          assert.match(label, /45 s/); assert.doesNotMatch(label, /toistoa|reps/);
        });
        await check('completed rest timer does not replace focused Dismiss button', async (p) => {
          await p.clock.install();
          await p.goto(url); await tap(p.getByRole('button', { name: 'Aloita harjoitus', exact: true }));
          await tap(p.locator('[data-key="s0-0"]'));
          await p.clock.fastForward(100000);
          await p.getByRole('button', { name: 'Sulje', exact: true }).focus();
          await p.clock.fastForward(1500);
          assert.equal(await p.getByRole('button', { name: 'Sulje', exact: true }).evaluate((e) => e === document.activeElement), true);
        });
      });
    } finally { await browser.close(); }
  }
} finally { server.kill(); }