import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../core.js';
import { chromium, webkit, devices, AxeBuilder, startServer, tap, tapConfirm, openSettings } from './support.mjs';

const { server, url } = await startServer();
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('gym-tracker-v1')));
const idle = (page) => page.waitForFunction(() => document.getElementById('app').getAttribute('aria-busy') !== 'true');

// A fake standard heart-rate strap: the page sees exactly what Web Bluetooth would give it.
function installStrap() {
  const device = new EventTarget();
  Object.assign(device, { id: 'strap-1', name: 'Polar H10 TEST' });
  const characteristic = new EventTarget();
  Object.assign(characteristic, { startNotifications: async () => characteristic, stopNotifications: async () => characteristic });
  const server = { getPrimaryService: async () => ({ getCharacteristic: async () => characteristic }), disconnect() {} };
  device.gatt = { connect: async () => server, disconnect() { device.dispatchEvent(new Event('gattserverdisconnected')); } };
  window.__strap = {
    emit(bpm, flags = 0x16) {
      characteristic.value = new DataView(Uint8Array.from([flags, bpm, 0, 0]).buffer);
      characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
    },
    drop() { device.gatt.disconnect(); },
    requests: 0,
  };
  Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: { requestDevice: async () => { window.__strap.requests++; return device; } } });
}

try {
  const chrome = await chromium.launch();
  const safari = await webkit.launch();
  try {
    const open = async (browser, device, options = {}) => {
      const context = await browser.newContext({ ...devices[device], reducedMotion: 'reduce', serviceWorkers: 'block', ...options });
      const page = await context.newPage(); page.setDefaultTimeout(5000);
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      return { context, page, errors };
    };

    await test('chromium: connect in settings, show live heart rate beside the clock, save average and maximum', { timeout: 60000 }, async () => {
      const { context, page: p, errors } = await open(chrome, 'Pixel 7');
      try {
        await context.addInitScript(installStrap);
        await p.goto(url);
        await openSettings(p);
        assert.match(await p.locator('#hr-status').innerText(), /Yhdistä Polar H10/);
        await tap(p.getByRole('button', { name: 'Yhdistä sykemittari' }));
        await p.getByText('Yhdistetty: Polar H10 TEST').waitFor();
        assert.equal(await p.evaluate(() => window.__strap.requests), 1);
        await p.evaluate(() => window.__strap.emit(72));
        assert.equal(await p.locator('#hr-live').innerText(), '72');
        assert.equal(await p.locator('details.settings').evaluate((d) => d.open), true, 'settings stay open while connecting');

        await tap(p.locator('[data-action="start"]').first());
        await p.locator('.ex').first().waitFor();
        assert.equal(await p.locator('#hr-value').innerText(), '72');
        const sameRow = await p.evaluate(() => {
          const hr = document.querySelector('.session-hr').getBoundingClientRect(), time = document.querySelector('.session-time').getBoundingClientRect();
          return Math.abs(hr.top - time.top) < 2 && hr.right <= time.left + 0.5;
        });
        assert.equal(sameRow, true, 'heart rate sits next to the running clock');

        await p.evaluate(() => { for (let bpm = 100; bpm <= 122; bpm += 2) window.__strap.emit(bpm); window.__strap.emit(0, 0x04); });
        assert.equal(await p.locator('#hr-value').innerText(), '122', 'a no-contact reading is ignored, not shown as 0');
        await p.evaluate(() => window.__strap.emit(130));
        assert.equal(await p.locator('#hr-value').innerText(), '130');
        await p.evaluate(() => window.__strap.drop());
        await p.locator('.session-hr.lost').waitFor();
        assert.equal(await p.locator('#hr-value').innerText(), '--');
        await p.waitForFunction(() => document.querySelector('.session-hr') && !document.querySelector('.session-hr.lost'), null, { timeout: 4000 });

        await tap(p.locator('[data-action="set"]').first());
        await tapConfirm(p.locator('[data-action="finish"]'));
        await p.locator('.saved-card').waitFor();
        const entry = (await saved(p)).history[0];
        assert.deepEqual(entry.hr, { avg: 112, max: 130, n: 13 });
        assert.match(await p.locator('.saved-card').innerText(), /syke keskim\. 112, enint\. 130 bpm/);
        assert.equal(await p.locator('.session-hr').count(), 0, 'no badge outside a workout');

        await p.reload();
        assert.deepEqual((await saved(p)).history[0].hr, { avg: 112, max: 130, n: 13 }, 'survives reload');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await test('chromium: a workout without a monitor shows no badge and saves no heart rate; old data is untouched', { timeout: 60000 }, async () => {
      const { context, page: p, errors } = await open(chrome, 'Pixel 7');
      try {
        await context.addInitScript(installStrap);
        const state = core.defaultState();
        state.history = [core.summarize(Object.assign(core.startSession(state.routines[0]), { id: 'old' }))];
        await p.goto(url);
        await p.evaluate((value) => localStorage.setItem('gym-tracker-v1', JSON.stringify(value)), state);
        await p.reload();
        await tap(p.locator('[data-action="start"]').first());
        await p.locator('.ex').first().waitFor();
        assert.equal(await p.locator('.session-hr').count(), 0);
        await tap(p.locator('[data-action="set"]').first());
        await tapConfirm(p.locator('[data-action="finish"]'));
        await p.locator('.saved-card').waitFor();
        const after = await saved(p);
        assert.equal('hr' in after.history[0], false);
        assert.deepEqual(after.history[1], state.history[0]);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await test('chromium: cancelling the chooser keeps the app idle, disconnect removes the badge and fits narrow screens', { timeout: 60000 }, async () => {
      const { context, page: p, errors } = await open(chrome, 'Pixel 7', { bypassCSP: true });
      try {
        await context.addInitScript(installStrap);
        await p.goto(url);
        await p.evaluate(() => { const real = navigator.bluetooth.requestDevice; let first = true; navigator.bluetooth.requestDevice = async () => { if (first) { first = false; throw Object.assign(new Error('cancelled'), { name: 'NotFoundError' }); } return real(); }; });
        await openSettings(p);
        await tap(p.getByRole('button', { name: 'Yhdistä sykemittari' }));
        await p.getByRole('button', { name: 'Yhdistä sykemittari' }).waitFor();
        assert.doesNotMatch(await p.locator('#hr-status').innerText(), /ei onnistunut/);
        await tap(p.getByRole('button', { name: 'Yhdistä sykemittari' }));
        await p.getByRole('button', { name: 'Katkaise yhteys' }).waitFor();
        await p.evaluate(() => window.__strap.emit(150));
        await tap(p.locator('[data-action="start"]').first());
        await p.locator('.ex').first().waitFor();
        for (const colorScheme of ['dark', 'light']) {
          await p.emulateMedia({ colorScheme });
          const violations = (await new AxeBuilder({ page: p }).analyze()).violations;
          assert.deepEqual(violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })), [], colorScheme);
        }
        for (const viewport of [{ width: 320, height: 640 }, { width: 844, height: 390 }]) {
          await p.setViewportSize(viewport);
          assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${viewport.width}px has no horizontal overflow`);
          assert.equal(await p.evaluate(() => {
            const rail = document.querySelector('.track-rail').getBoundingClientRect();
            return [...document.querySelectorAll('.session-header button, .session-hr, .session-time')].every((e) => e.getBoundingClientRect().right <= rail.left + 0.5);
          }), true, `${viewport.width}px clears the rail`);
        }
        await tap(p.getByRole('button', { name: 'Takaisin harjoituksiin' }));
        await openSettings(p);
        await tap(p.getByRole('button', { name: 'Katkaise yhteys' }));
        await p.getByRole('button', { name: 'Yhdistä sykemittari' }).waitFor();
        await tap(p.locator('[data-action="resume"]'));
        assert.equal(await p.locator('.session-hr').count(), 0);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await test('webkit: browsers without Web Bluetooth explain it and offer no connect button', { timeout: 30000 }, async () => {
      const { context, page: p, errors } = await open(safari, 'iPhone 14');
      try {
        await p.goto(url);
        await openSettings(p);
        assert.match(await p.locator('#hr-status').innerText(), /ei tue Bluetooth-sykemittareita/);
        assert.equal(await p.getByRole('button', { name: /sykemittari/i }).count(), 0);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  } finally { await chrome.close(); await safari.close(); }
} finally { server.kill(); }
