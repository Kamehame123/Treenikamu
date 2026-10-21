import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import * as core from '../core.js';
import * as stats from '../statistics.js';
import { statisticsView, escapeHtml } from '../statistics-ui.js';
import { DAY, NOW, workout, baselineHistory, configuredState, statisticsRoutine } from './statistics-fixtures.mjs';

const dataFor = (history, extra = {}) => stats.buildStatistics(history, { now: NOW, range: 'all', ...extra });
const approximately = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('statistics count actual completed work, known zeros and partial sessions, never targets', () => {
  const h = workout();
  h.exercises[0].sets[0].actualReps = '0';
  delete h.exercises[0].sets[1].actualReps;
  h.exercises[1].sets[0].done = false;
  h.setsDone = 3;
  const { totals } = dataFor([h]);
  assert.equal(totals.workouts, 1);
  assert.equal(totals.partial, 1);
  assert.equal(totals.sets, 3);
  assert.equal(totals.reps, 6);
  assert.equal(totals.repSets, 2);
  assert.equal(totals.volume, 600);
  assert.equal(totals.volumeSets, 2);
  assert.equal(totals.missingReps, 1);
});

test('legacy history stays useful without manufactured performance; invalid/future records and duplicate IDs are excluded', () => {
  const legacy = { id: 'old', name: 'Old', startedAt: NOW - 3600000, endedAt: NOW, setsDone: 3, setsTotal: 4 };
  const data = dataFor([legacy, legacy, workout('future', NOW + DAY), { ...legacy, id: 'bad', startedAt: NOW + 1 }]);
  assert.equal(data.totals.workouts, 1);
  assert.equal(data.totals.legacy, 1);
  assert.equal(data.totals.sets, 3);
  assert.equal(data.totals.repSets, 0);
  assert.equal(data.allGroups.length, 0);
  assert.equal(data.excluded, 2);
});

test('unknown, bodyweight, assisted and other units never become external kg volume or strength observations', () => {
  for (const loadType of ['unknown', 'bodyweight', 'assisted', 'other']) {
    const h = workout(); h.exercises.forEach((e) => { e.tracking.loadType = loadType; });
    const data = dataFor([h]);
    assert.equal(data.totals.volumeSets, 0, loadType);
    assert.equal(data.allGroups.every((g) => g.observations.length === 0), true);
    assert.equal(data.totals.reps, 24);
  }
  const h = workout(); h.exercises.forEach((e) => { e.tracking.loadType = 'per-hand'; });
  assert.equal(dataFor([h]).totals.volume, 2400, 'dumbbell loads must not be doubled');
});

test('decimal kg loads and explicit overrides use existing parsing; blank loads are not guessed', () => {
  const h = workout();
  h.exercises[0].weight = '12,5 kg';
  h.exercises[0].sets[0].actualWeight = '15 kg';
  h.exercises[1].weight = '';
  const data = dataFor([h]);
  assert.equal(data.totals.volume, 165);
  assert.equal(data.totals.volumeSets, 2);
  assert.equal(stats.estimateStrength(100, 1), 100);
  assert.equal(stats.estimateStrength(100, 11), null);
  assert.equal(stats.estimateStrength(0, 5), null);
});

test('working/warmup classifications, actual time and set RIR remain distinct from targets and exercise RIR', () => {
  const h = workout();
  const e = h.exercises[0];
  e.rir = '2';
  e.sets[0].kind = 'warmup';
  delete e.sets[1].kind; delete e.sets[1].setRir;
  h.exercises[1].sets.forEach((s) => { delete s.actualReps; s.actualSeconds = '45'; });
  const data = dataFor([h]);
  assert.equal(data.totals.workingSets, 2);
  assert.equal(data.totals.unclassifiedSets, 1);
  assert.equal(data.totals.seconds, 90);
  assert.equal(data.totals.missingReps, 0);
  assert.equal(data.allGroups.every((g) => g.observations.length === 0), true);
  assert.deepEqual(data.efforts, [0, 0, 2, 0, 0, 0]);
});

test('one exercise RIR describes only the last working set and never overrides logged per-set RIR', () => {
  const h = workout();
  h.exercises[0].rir = '1';
  h.exercises[0].sets.forEach((s) => { delete s.setRir; });
  assert.deepEqual(dataFor([h]).efforts, [0, 1, 2, 0, 0, 0]);
  const withSetRir = workout(); withSetRir.exercises[0].rir = '1';
  assert.deepEqual(dataFor([withSetRir]).efforts, [0, 0, 4, 0, 0, 0]);
  const warmupOnly = workout(); warmupOnly.exercises[0].rir = '1';
  warmupOnly.exercises[0].sets.forEach((s) => { delete s.setRir; s.kind = 'warmup'; });
  assert.deepEqual(dataFor([warmupOnly]).efforts, [0, 0, 2, 0, 0, 0]);
});

test('pain, fatigue, high-rep and unknown-effort sets remain workload data but cannot support the index', () => {
  for (const modify of [
    (h) => { h.fatigued = true; },
    (h) => h.exercises.forEach((e) => { e.pain = true; }),
    (h) => h.exercises.forEach((e) => { e.deload = true; }),
    (h) => h.exercises.forEach((e) => e.sets.forEach((s) => { s.actualReps = '11'; })),
    (h) => h.exercises.forEach((e) => e.sets.forEach((s) => { delete s.setRir; })),
    (h) => h.exercises.forEach((e) => e.sets.forEach((s) => { s.setRir = '5'; })),
  ]) {
    const h = workout(); modify(h);
    const data = dataFor([h]);
    assert.equal(data.totals.sets, 4);
    assert.equal(data.allGroups.every((g) => g.observations.length === 0), true);
  }
});

test('index requires 2-6 distinct benchmarks and three sessions, not three sets', () => {
  const data = dataFor([workout()]);
  assert.equal(stats.configureIndex(data, data.allGroups.map((g) => g.key)).ok, false);
  assert.equal(stats.configureIndex(data, [data.allGroups[0].key, data.allGroups[0].key]).ok, false);
  assert.equal(stats.configureIndex(dataFor(baselineHistory()), data.allGroups.map((g) => g.key)).ok, true);
});

test('a recent different effort does not hide an otherwise eligible three-session benchmark', () => {
  const history = baselineHistory(NOW - DAY), latest = workout('new-effort', NOW);
  latest.exercises.forEach((e) => e.sets.forEach((s) => { s.setRir = '1'; }));
  const data = dataFor([...history, latest]);
  for (const group of data.allGroups) assert.equal(stats.indexCandidate(group, NOW).rir, 2);
  assert.equal(stats.configureIndex(data, data.allGroups.map((g) => g.key)).ok, true);
});

test('fixed-basket geometric index has exact proportional behavior and robust three-session medians', () => {
  const state = configuredState(NOW - 4 * DAY);
  const future = [1, 2, 3].map((i) => workout(`progress-${i}`, NOW - (3 - i) * DAY, [110, 110]));
  let data = dataFor([...state.history, ...future]);
  approximately(stats.calculateIndex(data, state.statistics).value, 110);
  future.forEach((h) => { h.exercises[1].weight = '90'; });
  data = dataFor([...state.history, ...future]);
  approximately(stats.calculateIndex(data, state.statistics).value, 100 * Math.sqrt(1.1 * 0.9));
  future[0].exercises[0].weight = '999';
  approximately(stats.calculateIndex(dataFor([...state.history, ...future]), state.statistics).value, 100 * Math.sqrt(1.1 * 0.9));
});

test('extra sets, different effort, unrelated exercises and prescriptions cannot inflate the index', () => {
  const state = configuredState(NOW - DAY), h = workout('next', NOW);
  h.exercises[0].sets.push(...structuredClone(h.exercises[0].sets));
  h.exercises[0].sets.push({ done: true, actualWeight: '1000', actualReps: '6', kind: 'working', setRir: '0' });
  const unrelated = structuredClone(h.exercises[0]); unrelated.id = 'new'; unrelated.weight = '999';
  h.exercises.push(unrelated);
  h.exercises[1].reps = '100';
  const index = stats.calculateIndex(dataFor([...state.history, h]), state.statistics);
  approximately(index.value, 100);
  assert.equal(index.total, 2);
  assert.equal(state.statistics.benchmarks.length, 2);
});

test('missing or stale benchmarks suppress the whole index without reweighting; deloads do not produce fake losses', () => {
  const state = configuredState(NOW - 29 * DAY);
  const h = workout('fresh', NOW); h.exercises.pop();
  let index = stats.calculateIndex(dataFor([...state.history, h]), state.statistics);
  assert.equal(index.value, null);
  assert.equal(index.covered, 1);
  const fresh = configuredState(NOW - DAY);
  const deload = workout('deload', NOW, [50, 50]); deload.fatigued = true;
  index = stats.calculateIndex(dataFor([...fresh.history, deload]), fresh.statistics);
  approximately(index.value, 100);
  assert.equal(stats.calculateIndex(dataFor(fresh.history), fresh.statistics, fresh.statistics.createdAt - 1).value, null);
  const invalid = structuredClone(fresh.statistics);
  invalid.benchmarks.push({ ...invalid.benchmarks[0], key: 'invalid', baseline: 0 });
  assert.equal(stats.sanitizeIndex(invalid), null, 'corrupt baskets must never lose components and silently reweight');
});

test('routine, exercise identity, load convention and equipment changes create separate series', () => {
  const original = workout('a', NOW - DAY);
  for (const modify of [
    (h) => { h.routineId = 'different'; },
    (h) => h.exercises.forEach((e) => { e.name += ' uusi'; }),
    (h) => h.exercises.forEach((e) => { e.tracking.variant = 'machine 2'; }),
    (h) => h.exercises.forEach((e) => { e.tracking.loadType = 'per-hand'; }),
  ]) {
    const changed = workout('b'); modify(changed);
    assert.equal(dataFor([original, changed]).allGroups.length, 4);
  }
});

test('routine and exercise filters also filter period comparisons while preserving whole-session time', () => {
  const a = workout('a'), b = workout('b'); b.routineId = 'other';
  const all = dataFor([a, b]);
  const key = all.allGroups.find((g) => g.routineId === 'r').key;
  const filtered = dataFor([a, b], { routineId: 'r', exerciseKey: key });
  assert.equal(filtered.totals.workouts, 1);
  assert.equal(filtered.totals.sets, 2);
  assert.equal(filtered.totals.duration, 3600000);
  assert.equal(filtered.exercises.length, 1);
});

test('custom periods reject missing/reversed/future/impossible dates and include the end date', () => {
  for (const [from, to] of [['', '2026-10-20'], ['2026-02-30', '2026-10-20'], ['2026-10-21', '2026-10-20'], ['2026-10-20', '2026-10-21']]) {
    assert.equal(stats.statisticsPeriod('custom', NOW, NOW, from, to).ok, false);
  }
  const period = stats.statisticsPeriod('custom', NOW, NOW, '2026-10-20', '2026-10-20');
  assert.equal(period.ok, true);
  assert.equal(dataFor([workout()], { range: 'custom', from: '2026-10-20', to: '2026-10-20' }).totals.workouts, 1);
  const data = dataFor([workout()]);
  assert.equal(data.weeks[0].date, '2026-10-19');
});

test('calendar periods and comparisons preserve local days and elapsed time across DST in Helsinki', () => {
  const script = `import {statisticsPeriod, localDateKey} from './statistics.js';
    const now = +new Date(2026, 9, 26, 15, 30);
    const p = statisticsPeriod('4w', now);
    if (localDateKey(p.from) !== '2026-09-29' || localDateKey(p.previous.from) !== '2026-09-01' ||
      new Date(p.previous.to - 1).getHours() !== 15 || new Date(p.previous.to - 1).getMinutes() !== 30)
      throw Error(JSON.stringify(p));`;
  execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: new URL('..', import.meta.url), env: { ...process.env, TZ: 'Europe/Helsinki' } });
});

test('metadata, classifications and fixed baselines survive normalization, backup, replacement and idempotent merge', () => {
  const state = configuredState();
  state.session = core.startSession(state.routines[0], NOW);
  Object.assign(state.session.exercises[0].sets[0], { setRir: '2', actualSeconds: '45', kind: 'warmup' });
  const parsed = core.parseBackup(JSON.stringify(core.buildBackup(state, NOW)));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.state.statistics, state.statistics);
  assert.deepEqual(parsed.state.session, state.session);
  assert.deepEqual(core.sanitizeState(state), state);
  const merged = core.mergeState(core.defaultState(), parsed.state).state;
  approximately(stats.calculateIndex(dataFor(merged.history), merged.statistics).value, 100);
  const twice = core.mergeState(merged, parsed.state).state;
  assert.deepEqual(twice, merged);
  const old = core.defaultState();
  assert.equal(core.replaceState(state, old).state.statistics, undefined);
  assert.equal(core.replaceState(old, parsed.state).state.statistics.version, 1);
});

test('merging a conflicting routine remaps its imported index, while local configured index wins', () => {
  const incoming = configuredState(), local = core.defaultState();
  local.routines = [statisticsRoutine()]; local.routines[0].name = 'Different local plan';
  const merged = core.mergeState(local, incoming).state;
  assert.notEqual(merged.history[0].routineId, 'r');
  approximately(stats.calculateIndex(dataFor(merged.history), merged.statistics).value, 100);
  assert.deepEqual(core.mergeState(merged, incoming).state, merged);
  const existing = configuredState(NOW - DAY);
  assert.deepEqual(core.mergeState(existing, incoming).state.statistics, existing.statistics);
});

test('old data receives no fabricated tracking; library metadata handles assistance and dumbbell conventions', () => {
  const old = core.defaultState(), loaded = core.sanitizeState(old);
  assert.equal(loaded.routines[0].exercises[0].tracking, undefined);
  assert.equal(loaded.statistics, undefined);
  assert.equal(stats.libraryTracking({ id: 'x', name: 'Avustettu leuanveto', equipment: 'Laite' }).loadType, 'assisted');
  assert.equal(stats.libraryTracking({ id: 'x', name: 'Press', equipment: 'Käsipainot' }).loadType, 'per-hand');
  assert.equal(stats.sanitizeIndex({ version: 99, benchmarks: [] }), null);
});

test('automatic deload status is snapshotted without changing later plans or old training', () => {
  const routine = statisticsRoutine();
  routine.exercises[0].recoveryBase = { sets: 3, reps: '6', weight: '110', setReps: null };
  const session = core.startSession(routine, NOW - 1000);
  assert.equal(session.exercises[0].deload, true);
  delete routine.exercises[0].recoveryBase;
  const history = core.summarize(session, NOW);
  assert.equal(core.sanitizeState({ ...core.defaultState(), history: [history] }).history[0].exercises[0].deload, true);
});

test('exercise history pagination keeps every record available without unbounded chart or table DOM', () => {
  const state = configuredState();
  state.history = Array.from({ length: 120 }, (_, i) => workout(`page-${i}`, NOW - i * DAY));
  const data = dataFor(state.history), exerciseKey = data.allGroups[0].key;
  const first = statisticsView(state, { now: NOW, range: 'all', exerciseKey, page: 0 });
  const last = statisticsView(state, { now: NOW, range: 'all', exerciseKey, page: 2 });
  assert.match(first, /Sivu 1\/3 · 120 treeniä/);
  assert.match(last, /Sivu 3\/3 · 120 treeniä/);
  assert.match(first, /data-page="1"/);
  assert.match(last, /data-page="1"/);
});

test('accessible rendering escapes user input, has no remote dependencies and never prints NaN or Infinity', () => {
  const state = configuredState();
  state.history[0].exercises[0].name = '<img src=x onerror=alert(1)>';
  const html = statisticsView(state, { now: NOW, range: 'all', routineId: '', exerciseKey: '' });
  assert.equal(html.includes('<img src=x'), false);
  assert.equal(html.includes('&lt;img'), true);
  assert.match(html, /<caption>/);
  assert.match(html, /role="img"/);
  assert.doesNotMatch(html, /NaN|Infinity|<script/);
  assert.equal(escapeHtml('<"&'), '&lt;&quot;&amp;');
});

test('full 10000-workout history remains bounded for charts and efficient to aggregate', (t) => {
  const sample = workout(), history = Array.from({ length: 10000 }, (_, i) => ({
    ...sample, id: `w-${i}`, startedAt: NOW - i * DAY - 3600000, endedAt: NOW - i * DAY,
  }));
  const start = performance.now(), data = dataFor(history), elapsed = performance.now() - start;
  assert.equal(data.totals.workouts, 10000);
  assert.equal(data.totals.sets, 40000);
  assert.equal(data.weeks.length, 104);
  assert.equal(data.days.length, 84);
  assert.ok(elapsed < 3000, `10000 workouts took ${elapsed}ms`);
  t.diagnostic(`Aggregated 10000 workouts in ${Math.round(elapsed)} ms`);
});

test('all analytics modules ship through both the static server and the atomic offline cache', async () => {
  const [server, worker] = await Promise.all(['tools/serve.mjs', 'sw.js'].map((path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')));
  for (const name of ['statistics.js', 'statistics-ui.js']) {
    assert.ok(server.includes(`'${name}'`), `${name} missing from server allowlist`);
    assert.ok(worker.includes(`'./${name}'`), `${name} missing from offline cache`);
  }
});
