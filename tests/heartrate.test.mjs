import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../core.js';
import { parseHeartRateMeasurement, isPlausibleBpm, emptyHr, addHrSample, summarizeHr, sanitizeHr, createMonitor, HR_STALE_MS } from '../heartrate.js';

const view = (...bytes) => new DataView(Uint8Array.from(bytes).buffer);

test('parses 8-bit and 16-bit heart rate values and skin contact flags', () => {
  assert.deepEqual(parseHeartRateMeasurement(view(0x00, 72)), { bpm: 72, contact: null });
  assert.deepEqual(parseHeartRateMeasurement(view(0x01, 0x2c, 0x01)), { bpm: 300, contact: null });
  // Polar H10 sends flags 0x10 (RR present) or 0x16 (contact supported + detected + RR).
  assert.deepEqual(parseHeartRateMeasurement(view(0x10, 64, 0x20, 0x03)), { bpm: 64, contact: null });
  assert.deepEqual(parseHeartRateMeasurement(view(0x16, 64, 0x20, 0x03)), { bpm: 64, contact: true });
  assert.deepEqual(parseHeartRateMeasurement(view(0x04, 0)), { bpm: 0, contact: false });
  for (const bad of [null, undefined, view(), view(0), view(0x01, 5)]) assert.equal(parseHeartRateMeasurement(bad), null);
});

test('only plausible readings are recorded and averaged', () => {
  for (const bpm of [0, 24, 251, 70.5, NaN, null]) assert.equal(isPlausibleBpm(bpm), false);
  let acc = emptyHr('s1');
  for (const bpm of [0, 300, ...Array.from({ length: 10 }, (_, i) => 100 + i * 2)]) acc = addHrSample(acc, bpm);
  assert.equal(acc.n, 10);
  assert.deepEqual(summarizeHr(acc), { avg: 109, max: 118, n: 10 });
  assert.equal(summarizeHr(addHrSample(emptyHr(), 120)), null, 'too few samples are unknown, not guessed');
});

test('stored heart rate is validated and never coerced', () => {
  assert.deepEqual(sanitizeHr({ avg: 120, max: 160, n: 30 }), { avg: 120, max: 160, n: 30 });
  for (const bad of [null, 'x', {}, { avg: 0, max: 160, n: 3 }, { avg: 170, max: 160, n: 3 }, { avg: 120, max: 160, n: 0 }, { avg: '120', max: 160, n: 3 }, { avg: 120, max: 999, n: 3 }]) {
    assert.equal(sanitizeHr(bad), null);
  }
});

test('heart rate is saved with a finished workout, survives load, merge and old data without it', () => {
  const state = core.defaultState();
  const session = core.startSession(state.routines[0]);
  session.exercises[0].sets[0].done = true;
  const plain = core.summarize(session);
  assert.equal('hr' in plain, false);
  assert.equal('hr' in core.summarize(session, Date.now(), { avg: 5, max: 4, n: 3 }), false, 'invalid values are dropped');
  const entry = core.summarize(session, Date.now(), { avg: 121, max: 158, n: 900 });
  assert.deepEqual(entry.hr, { avg: 121, max: 158, n: 900 });
  state.history = [entry];
  const loaded = core.sanitizeState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(loaded.history[0].hr, { avg: 121, max: 158, n: 900 });
  const merged = core.mergeState(core.defaultState(), loaded).state;
  assert.deepEqual(merged.history[0].hr, { avg: 121, max: 158, n: 900 });
  const old = core.sanitizeState({ v: core.SCHEMA, routines: state.routines, history: [plain] });
  assert.equal('hr' in old.history[0], false);
});

function fakeDevice({ name = 'Polar H10 4F2A', failConnects = 0 } = {}) {
  const device = Object.assign(new EventTarget(), { id: 'dev-1', name, connects: 0, notifying: false });
  const characteristic = Object.assign(new EventTarget(), {
    value: null,
    startNotifications: async () => { device.notifying = true; return characteristic; },
    stopNotifications: async () => { device.notifying = false; return characteristic; },
  });
  let fails = failConnects;
  device.gatt = {
    connect: async () => {
      device.connects++;
      if (fails-- > 0) throw new Error('out of range');
      return { getPrimaryService: async (s) => { assert.equal(s, 'heart_rate'); return { getCharacteristic: async (c) => { assert.equal(c, 'heart_rate_measurement'); return characteristic; } }; }, disconnect() {} };
    },
    disconnect() { device.dispatchEvent(new Event('gattserverdisconnected')); },
  };
  device.emit = (...bytes) => { characteristic.value = view(...bytes); characteristic.dispatchEvent(new Event('characteristicvaluechanged')); };
  return device;
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 25));

test('monitor connects, reports readings, ignores no-contact data and goes stale', async () => {
  const device = fakeDevice();
  const asked = [];
  const bluetooth = { requestDevice: async (options) => { asked.push(options); return device; } };
  let clock = 1000;
  const samples = [], changes = [];
  const monitor = createMonitor({ bluetooth, now: () => clock, onSample: (bpm) => samples.push(bpm), onChange: (i) => changes.push(i.status) });
  await monitor.connect();
  assert.deepEqual(asked, [{ filters: [{ services: ['heart_rate'] }] }]);
  assert.equal(monitor.info.status, 'connected');
  assert.equal(monitor.info.name, 'Polar H10 4F2A');
  device.emit(0x16, 71, 0, 0);
  device.emit(0x04, 0);
  device.emit(0x14, 0);
  assert.deepEqual(samples, [71]);
  assert.equal(monitor.current(), null, 'a no-contact reading clears the live value');
  device.emit(0x00, 88);
  assert.equal(monitor.current(), 88);
  clock += HR_STALE_MS + 1;
  assert.equal(monitor.current(), null);
  await monitor.disconnect();
  assert.equal(monitor.info.status, 'idle');
  assert.equal(device.notifying, false);
  assert.deepEqual(changes.filter((s, i) => s !== changes[i - 1]), ['connecting', 'connected', 'idle']);
});

test('closing the device chooser is not an error, other failures explain what to do', async () => {
  const cancelled = createMonitor({ bluetooth: { requestDevice: async () => { throw Object.assign(new Error('x'), { name: 'NotFoundError' }); } } });
  await cancelled.connect();
  assert.equal(cancelled.info.status, 'idle');
  assert.equal(cancelled.info.error, '');
  const device = fakeDevice({ failConnects: 1 });
  const failing = createMonitor({ bluetooth: { requestDevice: async () => device } });
  await failing.connect();
  assert.equal(failing.info.status, 'error');
  assert.match(failing.info.error, /elektrodit/);
  await failing.connect();
  assert.equal(failing.info.status, 'connected', 'the user can retry after an error');
  await failing.disconnect();
  const missing = createMonitor({ bluetooth: undefined });
  await missing.connect();
  assert.equal(missing.info.status, 'error');
});

test('a dropped connection reconnects by itself until the user disconnects', async () => {
  const device = fakeDevice();
  const monitor = createMonitor({ bluetooth: { requestDevice: async () => device }, retryMs: [5] });
  await monitor.connect();
  device.gatt.disconnect();
  assert.equal(monitor.info.status, 'reconnecting');
  await settle();
  assert.equal(monitor.info.status, 'connected');
  assert.equal(device.connects, 2);
  device.emit(0x00, 90);
  assert.equal(monitor.current(), 90, 'readings flow again after the reconnect');

  const flaky = fakeDevice();
  const second = createMonitor({ bluetooth: { requestDevice: async () => flaky }, retryMs: [5] });
  await second.connect();
  flaky.gatt.connect = async () => { flaky.connects++; throw new Error('away'); };
  flaky.gatt.disconnect();
  await settle();
  assert.equal(second.info.status, 'reconnecting');
  assert.ok(flaky.connects > 2, 'keeps trying');
  await second.disconnect();
  const tries = flaky.connects;
  await settle();
  assert.equal(flaky.connects, tries, 'stops trying once the user disconnects');
  assert.equal(second.info.status, 'idle');
});

test('a previously permitted device is restored silently, and only the remembered one', async () => {
  const device = fakeDevice(), other = Object.assign(fakeDevice({ name: 'Other' }), { id: 'dev-2' });
  let stored = null;
  const make = (recalled) => createMonitor({ bluetooth: { requestDevice: async () => device, getDevices: async () => [other, device] }, remember: (id) => { stored = id; }, recall: () => recalled });
  const monitor = make(null);
  await monitor.restore();
  assert.equal(monitor.info.status, 'idle');
  assert.equal(other.connects, 0);
  await monitor.connect();
  assert.equal(stored, 'dev-1');
  await monitor.disconnect();
  const restored = make(stored);
  await restored.restore();
  assert.equal(restored.info.status, 'connected');
  assert.equal(other.connects, 0);
  await restored.disconnect();
  device.gatt.connect = async () => { throw new Error('off'); };
  const absent = make('dev-1');
  await absent.restore();
  assert.equal(absent.info.status, 'idle', 'a strap that is switched off is not reported as an error');
});
