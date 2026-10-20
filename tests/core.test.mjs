import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../core.js';

const routine = () => ({ id: 'r', name: 'A', exercises: [{ id: 'e1', name: 'Squat', sets: 3, reps: '5' }, { id: 'e2', name: 'Row', sets: 2, reps: '8' }] });
const mem = (init) => { const m = new Map(init); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test('startSession builds independent unchecked sets', () => {
  const s = c.startSession(routine());
  assert.equal(c.progress(s).total, 5);
  assert.equal(c.progress(s).done, 0);
  c.toggleSet(s, 0, 1);
  assert.deepEqual(s.exercises[0].sets.map((x) => x.done), [false, true, false]);
});

test('toggle is reversible; invalid indexes are safe', () => {
  const s = c.startSession(routine());
  assert.equal(c.toggleSet(s, 0, 0), true);
  assert.equal(c.toggleSet(s, 0, 0), false);
  assert.equal(c.toggleSet(s, 9, 0), false);
  assert.equal(c.toggleSet(null, 0, 0), false);
});

test('quick rep adjustments change only actual reps, including on completed sets', () => {
  const r = routine();
  r.exercises[0].setReps = ['5', '8', '12'];
  const s = c.startSession(r);
  const original = structuredClone(r);
  assert.equal(c.setRepCount(s.exercises[0], s.exercises[0].sets[1]), 8);
  assert.deepEqual(c.adjustSetReps(s, 0, 1, -1), { ok: true, reps: 7 });
  assert.deepEqual(c.adjustSetReps(s, 0, 1, -1), { ok: true, reps: 6 });
  c.toggleSet(s, 0, 1);
  assert.deepEqual(c.adjustSetReps(s, 0, 1, 1), { ok: true, reps: 7 });
  assert.deepEqual(s.exercises[0].sets[1], { done: true, reps: '8', actualReps: '7' });
  assert.deepEqual(s.exercises[0].sets[0], { done: false, reps: '5' });
  assert.equal(s.exercises[0].reps, '5');
  assert.deepEqual(r, original);
  assert.equal(c.progress(s).done, 1);
});

test('quick reps use range ceilings and manual logs but never reinterpret timed targets', () => {
  const s = c.startSession(routine());
  const exercise = s.exercises[0], set = exercise.sets[0];
  for (const target of ['8-12', '8–12']) {
    set.reps = target;
    delete set.actualReps;
    assert.deepEqual(c.adjustSetReps(s, 0, 0, -1), { ok: true, reps: 11 });
  }
  set.actualReps = '4';
  assert.deepEqual(c.adjustSetReps(s, 0, 0, 1), { ok: true, reps: 5 });
  for (const target of ['45 s', '2 min', 'AMRAP', '0', '101', '12-8']) {
    set.reps = target;
    assert.equal(c.setRepCount(exercise, set), null);
    const before = structuredClone(s);
    assert.equal(c.adjustSetReps(s, 0, 0, -1).ok, false);
    assert.deepEqual(s, before);
  }
});

test('quick rep bounds and invalid actions report errors without changing records', () => {
  const s = c.startSession(routine()), exercise = s.exercises[0], set = exercise.sets[0];
  for (const [actual, delta] of [['0', -1], ['100', 1], ['-1', 1], ['1.5', 1], ['', 1], ['bad', -1]]) {
    set.actualReps = actual;
    const before = structuredClone(s);
    const result = c.adjustSetReps(s, 0, 0, delta);
    assert.equal(result.ok, false);
    assert.ok(result.error.length);
    assert.deepEqual(s, before);
  }
  set.actualReps = '0';
  assert.deepEqual(c.adjustSetReps(s, 0, 0, 1), { ok: true, reps: 1 });
  set.actualReps = '100';
  assert.deepEqual(c.adjustSetReps(s, 0, 0, -1), { ok: true, reps: 99 });
  for (const [session, ei, si, delta] of [[null, 0, 0, 1], [s, 99, 0, 1], [s, 0, 99, 1], [s, 0, 0, 0], [s, 0, 0, 2]]) {
    const before = structuredClone(s);
    const result = c.adjustSetReps(session, ei, si, delta);
    assert.equal(result.ok, false);
    assert.ok(result.error.length);
    assert.deepEqual(s, before);
  }
});

test('adjusted actual reps survive reload, history and backup restore without changing targets', () => {
  const state = c.defaultState();
  state.session = c.startSession(state.routines[0]);
  c.adjustSetReps(state.session, 0, 0, -1);
  c.toggleSet(state.session, 0, 0);
  const store = mem();
  assert.equal(c.saveState(store, state), true);
  const recovered = c.loadState(store);
  assert.deepEqual(recovered, state);
  recovered.history.unshift(c.summarize(recovered.session));
  recovered.session = null;
  const parsed = c.parseBackup(JSON.stringify(c.buildBackup(recovered)));
  assert.equal(parsed.ok, true);
  const restored = c.replaceState(c.defaultState(), parsed.state).state;
  assert.equal(restored.history[0].exercises[0].sets[0].actualReps, '4');
  assert.equal(restored.history[0].exercises[0].sets[0].done, true);
  assert.equal(restored.history[0].exercises[0].sets[1].actualReps, undefined);
  assert.deepEqual(restored.routines, state.routines);
});

test('currentExercise advances and returns -1 when finished', () => {
  const s = c.startSession(routine());
  assert.equal(c.currentExercise(s), 0);
  [0, 1, 2].forEach((i) => c.toggleSet(s, 0, i));
  assert.equal(c.currentExercise(s), 1);
  [0, 1].forEach((i) => c.toggleSet(s, 1, i));
  assert.equal(c.currentExercise(s), -1);
  assert.equal(c.progress(s).pct, 100);
});

test('add/remove set respect bounds', () => {
  const s = c.startSession(routine());
  for (let i = 0; i < 50; i++) c.addSet(s, 1);
  assert.equal(s.exercises[1].sets.length, 20);
  for (let i = 0; i < 50; i++) c.removeSet(s, 1);
  assert.equal(s.exercises[1].sets.length, 1);
});

test('set buttons format weights, unweighted reps, ranges and durations', () => {
  for (const weight of ['25', '25kg', '25 kg', ' 25 kg ']) {
    assert.equal(c.setTargetLabel('5', weight), '5 x 25kg');
  }
  assert.equal(c.setTargetLabel('5', '25,5 kg'), '5 x 25,5kg');
  assert.equal(c.setTargetLabel('5', '25.5'), '5 x 25.5kg');
  assert.equal(c.setTargetLabel('5', '0'), '5 x 0kg');
  assert.equal(c.setTargetLabel('5'), '5 toistoa');
  assert.equal(c.setTargetLabel('8–12', '  '), '8–12 toistoa');
  assert.equal(c.setTargetLabel('30 s'), '30 s');
  assert.equal(c.setTargetLabel('2 min', '10 kg'), '2 min x 10kg');
  assert.equal(c.setTargetLabel('8', '2 x 10 kg'), '8 x 2 x 10kg');
});

test('per-set routine targets are bounded, cleaned and filled from the shared target', () => {
  const r = routine();
  r.exercises[0].setReps = [' 6 ', '', '30 s', 'unused'];
  const cleaned = c.sanitizeRoutine(r);
  assert.deepEqual(cleaned.exercises[0].setReps, ['6', '5', '30 s']);
  assert.equal(cleaned.exercises[1].setReps, null);
  assert.deepEqual(r.exercises[0].setReps, [' 6 ', '', '30 s', 'unused']);
  const huge = c.sanitizeRoutine({ exercises: [{ name: 'A', sets: 10000, setReps: Array(100).fill('8') }] });
  assert.equal(huge.exercises[0].setReps.length, c.MAX_SETS);
});

test('per-set session targets remain independent through toggles, add, remove and recovery', () => {
  const r = routine();
  r.exercises[0].setReps = ['5', '8', '12'];
  r.exercises[0].weight = '25 kg';
  const s = c.startSession(r);
  c.toggleSet(s, 0, 1);
  c.addSet(s, 0);
  assert.deepEqual(s.exercises[0].sets, [
    { done: false, reps: '5' }, { done: true, reps: '8' },
    { done: false, reps: '12' }, { done: false, reps: '12' },
  ]);
  c.addSet(s, 1);
  assert.deepEqual(s.exercises[1].sets.at(-1), { done: false });
  c.removeSet(s, 0);
  assert.deepEqual(c.sanitizeSession(s), s);
  assert.deepEqual(r.exercises[0].setReps, ['5', '8', '12']);
  assert.equal(s.exercises[0].weight, '25 kg');
});

test('validation reports missing per-set targets rather than silently replacing them', () => {
  const r = routine();
  r.exercises[0].setReps = ['5', ' ', '12'];
  assert.match(c.validateRoutine(r).join(' '), /Liike 1, sarja 2/);
  r.exercises[0].setReps = ['5'];
  assert.equal(c.validateRoutine(r).length, 2);
  r.exercises[0].setReps = ['5', '8', '12'];
  assert.deepEqual(c.validateRoutine(r), []);
  r.exercises[0].setReps = null;
  assert.deepEqual(c.validateRoutine(r), []);
});

test('legacy data upgrades additively without rewriting storage or losing records', () => {
  const legacy = sample();
  for (const r of legacy.routines) for (const e of r.exercises) delete e.setReps;
  legacy.customExercises = [{ id: 'own-1', name: 'Own', category: 'Selkä', equipment: 'Talja', reps: '8' }];
  legacy.session = c.startSession(legacy.routines[0], 1000);
  c.toggleSet(legacy.session, 0, 0);
  legacy.restEnd = 5000;
  const raw = JSON.stringify(legacy);
  const store = mem([[c.STORAGE_KEY, raw]]);
  const restored = c.loadState(store);
  assert.equal(store.getItem(c.STORAGE_KEY), raw);
  assert.deepEqual(restored.history, legacy.history);
  assert.deepEqual(restored.customExercises, legacy.customExercises);
  assert.deepEqual(restored.session, legacy.session);
  assert.equal(restored.restEnd, legacy.restEnd);
  assert.equal(restored.routines[0].exercises[0].setReps, null);
  assert.deepEqual(c.loadState(store), restored);
  assert.equal(c.saveState(store, restored), true);
  assert.deepEqual(c.loadState(store), restored);
});

test('per-set targets round-trip through storage, backups, merge and replace', () => {
  const state = sample();
  state.routines[0].exercises[0].setReps = ['5', '8', '12'];
  state.session = c.startSession(state.routines[0], 1000);
  c.toggleSet(state.session, 0, 1);
  const store = mem();
  assert.equal(c.saveState(store, state), true);
  assert.deepEqual(c.loadState(store), state);
  const parsed = c.parseBackup(JSON.stringify(c.buildBackup(state)));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.state, state);
  for (const apply of [c.mergeState, c.replaceState]) {
    const restored = apply({ ...c.defaultState(), routines: [] }, parsed.state).state;
    assert.deepEqual(restored.routines, state.routines);
    assert.deepEqual(restored.session, state.session);
    assert.deepEqual(restored.history, state.history);
  }
});

test('a failed save leaves existing per-set training data recoverable for retry', () => {
  const state = sample();
  state.routines[0].exercises[0].setReps = ['5', '8', '12'];
  state.session = c.startSession(state.routines[0]);
  c.toggleSet(state.session, 0, 0);
  const original = JSON.stringify(state);
  const store = mem([[c.STORAGE_KEY, original]]);
  const failing = { getItem: store.getItem, setItem() { throw new Error('quota'); } };
  const next = c.loadState(failing);
  c.toggleSet(next.session, 0, 1);
  assert.equal(c.saveState(failing, next), false);
  assert.equal(store.getItem(c.STORAGE_KEY), original);
  assert.equal(c.saveState(store, next), true);
  assert.deepEqual(c.loadState(store), next);
});

test('empty routine cannot start', () => {
  assert.equal(c.startSession({ name: 'x', exercises: [{ name: '  ' }] }), null);
});

test('state round-trips and recovers a session', () => {
  const st = c.defaultState();
  st.session = c.startSession(st.routines[0]);
  c.toggleSet(st.session, 0, 0);
  const store = mem();
  assert.equal(c.saveState(store, st), true);
  const back = c.loadState(store);
  assert.equal(c.progress(back.session).done, 1);
});

test('corrupt storage falls back to defaults', () => {
  for (const bad of ['{not json', 'null', '42', '{"routines":"x","session":{"exercises":5}}']) {
    const s = c.loadState(mem([[c.STORAGE_KEY, bad]]));
    assert.ok(s.routines.length >= 1);
    assert.equal(s.session, null);
  }
});

test('sanitize clamps hostile values', () => {
  const r = c.sanitizeRoutine({ name: 'x'.repeat(500), exercises: [{ name: 'A', sets: 9999, reps: '' }, { name: 'B', sets: -4 }] });
  assert.equal(r.name.length, 60);
  assert.equal(r.exercises[0].sets, 20);
  assert.equal(r.exercises[1].sets, 1);
  assert.equal(r.exercises[0].reps, '10');
});

test('saveState reports failure when storage throws', () => {
  assert.equal(c.saveState({ setItem() { throw new Error('quota'); } }, c.defaultState()), false);
});

test('formatDuration', () => {
  assert.equal(c.formatDuration(65000), '1:05');
  assert.equal(c.formatDuration(3723000), '1:02:03');
  assert.equal(c.formatDuration(-5), '0:00');
});

test('validateRoutine', () => {
  assert.equal(c.validateRoutine({ name: '', exercises: [] }).length, 2);
  assert.equal(c.validateRoutine(routine()).length, 0);
});

test('recovery repairs zero-set exercises without marking work complete', () => {
  const s = c.sanitizeSession({ exercises: [{ name: 'Squat', sets: [] }] });
  assert.ok(s.exercises[0].sets.length >= 1);
  assert.equal(c.progress(s).done, 0);
});

test('recovery never treats the string false as a completed set', () => {
  const s = c.sanitizeSession({ exercises: [{ sets: [{ done: 'false' }, { done: true }] }] });
  assert.equal(c.progress(s).done, 1);
});

test('non-finite timestamps and durations cannot produce NaN UI', () => {
  const s = c.sanitizeSession({ startedAt: 'Infinity', exercises: [{ sets: [{}] }] });
  assert.ok(Number.isFinite(s.startedAt));
  assert.equal(c.formatDuration(NaN), '0:00');
  assert.equal(c.formatDuration(Infinity), '0:00');
});

test('validation rejects every unnamed row, missing target and invalid set count', () => {
  for (const e of [
    { name: '', sets: 3, reps: '10' },
    { name: 'Curl', sets: 0, reps: '10' },
    { name: 'Curl', sets: 2.5, reps: '10' },
    { name: 'Curl', sets: 3, reps: '' },
  ]) {
    assert.ok(c.validateRoutine({ ...routine(), exercises: [...routine().exercises, e] }).length > 0);
  }
});

test('orphan rest timer is cleared on recovery', () => {
  assert.equal(c.sanitizeState({ restEnd: Date.now() + 100000 }).restEnd, null);
});

test('duplicate ids are repaired so template selection is unambiguous', () => {
  const s = c.sanitizeState({ routines: [routine(), routine()] });
  assert.notEqual(s.routines[0].id, s.routines[1].id);
});

test('an older app cannot overwrite a newer schema', () => {
  const future = JSON.stringify({ ...c.defaultState(), v: 2, futureFeature: { important: true } });
  const store = mem([[c.STORAGE_KEY, future]]);
  assert.equal(c.saveState(store, c.defaultState()), false);
  assert.equal(store.getItem(c.STORAGE_KEY), future);
});

// ---- Backup / import / historical compatibility ----

const sample = () => {
  const st = c.defaultState();
  st.history = [
    { id: 'h1', name: 'A', startedAt: 1000, endedAt: 5000, setsDone: 3, setsTotal: 3 },
    { id: 'h2', name: 'A', startedAt: 500, endedAt: 900, setsDone: 1, setsTotal: 2 },
  ];
  return st;
};

test('every released schema version has a migration to the next', () => {
  for (let v = 1; v < c.SCHEMA; v++) assert.equal(typeof c.MIGRATIONS[v], 'function', `migration from v${v}`);
});

test('export envelope round-trips through parseBackup', () => {
  const st = sample();
  st.session = c.startSession(st.routines[0]);
  st.restEnd = Date.now() + 5000;
  const file = c.buildBackup(st, Date.UTC(2026, 0, 2));
  assert.equal(file.format, 'gym-tracker-backup');
  assert.equal(file.exportedAt, '2026-01-02T00:00:00.000Z');
  assert.equal('restEnd' in file.data, false);
  const parsed = c.parseBackup(JSON.stringify(file));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.meta.legacy, false);
  assert.deepEqual(parsed.state.history, st.history);
  assert.deepEqual(parsed.state.routines, st.routines);
  assert.equal(parsed.state.session.id, st.session.id);
  assert.equal(parsed.state.restEnd, null);
});

test('legacy raw-state export (pre-envelope) still imports', () => {
  const legacy = JSON.stringify({ ...sample(), restEnd: null });
  const parsed = c.parseBackup(legacy);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.meta.legacy, true);
  assert.equal(parsed.state.history.length, 2);
});

test('data without a version is treated as schema 1', () => {
  const parsed = c.parseBackup(JSON.stringify({ routines: [routine()], history: [] }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.state.routines[0].name, 'A');
});

test('missing newer fields get defaults (additive changes need no migration)', () => {
  const parsed = c.parseBackup(JSON.stringify({ format: c.BACKUP_FORMAT, formatVersion: 1, data: { v: 1, routines: [{ name: 'Old', exercises: [{ name: 'Curl' }] }] } }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.state.settings.restSeconds, 90);
  assert.equal(parsed.state.routines[0].exercises[0].sets, 3);
});

test('migrations run in order, from the data version, without mutating the input', () => {
  const migrations = {
    1: (d) => ({ ...d, a: 1 }),
    2: (d) => ({ ...d, b: d.a + 1 }),
  };
  const input = { v: 1, routines: [] };
  const out = c.migrateData(input, migrations, 3);
  assert.deepEqual(out, { v: 3, routines: [], a: 1, b: 2 });
  assert.deepEqual(input, { v: 1, routines: [] });
  assert.deepEqual(c.migrateData({ v: 2, a: 5 }, migrations, 3), { v: 3, a: 5, b: 6 });
  assert.equal(c.migrateData({ v: 3, x: 1 }, migrations, 3).x, 1);
  assert.throws(() => c.migrateData({ v: 1 }, { }, 2));
});

test('files from a newer app or envelope are refused with a clear message', () => {
  const newerData = c.parseBackup(JSON.stringify({ format: c.BACKUP_FORMAT, formatVersion: 1, data: { v: c.SCHEMA + 1, routines: [] } }));
  assert.equal(newerData.ok, false);
  assert.ok(newerData.error.length > 0);
  const newerEnvelope = c.parseBackup(JSON.stringify({ format: c.BACKUP_FORMAT, formatVersion: c.BACKUP_VERSION + 1, data: {} }));
  assert.equal(newerEnvelope.ok, false);
  assert.ok(newerEnvelope.error.length > 0);
});

test('invalid files are rejected without throwing', () => {
  for (const bad of ['', '{nope', 'null', '[]', '42', '{}', '{"format":"other","data":{}}', '{"format":"gym-tracker-backup","formatVersion":"x","data":{}}', '{"format":"gym-tracker-backup","formatVersion":1}', '{"routines":[],"v":0}', '{"routines":[],"v":"2"}']) {
    const parsed = c.parseBackup(bad);
    assert.equal(parsed.ok, false, bad);
    assert.ok(parsed.error.length > 0);
  }
  assert.equal(c.parseBackup('x'.repeat(c.MAX_BACKUP_BYTES + 1)).ok, false);
  assert.equal(c.parseBackup(undefined).ok, false);
});

test('hostile backup content is sanitised', () => {
  const parsed = c.parseBackup(JSON.stringify({ format: c.BACKUP_FORMAT, formatVersion: 1, data: { v: 1, routines: [{ name: '<b>' + 'x'.repeat(500), exercises: [{ name: 'A', sets: 9999 }] }], history: [null, 5, { id: 'h', endedAt: 'soon', setsDone: -3 }] } }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.state.routines[0].name.length, 60);
  assert.equal(parsed.state.routines[0].exercises[0].sets, 20);
  assert.equal(parsed.state.history.length, 1);
  assert.equal(parsed.state.history[0].setsDone, 0);
});

test('importing an empty backup adds no phantom starter plan', () => {
  const parsed = c.parseBackup(JSON.stringify(c.buildBackup({ ...c.defaultState(), routines: [], history: [] })));
  assert.equal(parsed.state.routines.length, 0);
  const { state } = c.mergeState(sample(), parsed.state);
  assert.equal(state.routines.length, 1);
});

test('merge adds missing items, keeps local ones, orders history and is idempotent', () => {
  const local = sample();
  const incoming = c.parseBackup(JSON.stringify(c.buildBackup({
    ...c.defaultState(),
    routines: [{ id: 'new', name: 'Pull', exercises: [{ id: 'x', name: 'Row', sets: 3, reps: '8', weight: '' }] }],
    history: [{ id: 'h1', name: 'A', startedAt: 1000, endedAt: 5000, setsDone: 3, setsTotal: 3 }, { id: 'h3', name: 'B', startedAt: 7000, endedAt: 9000, setsDone: 2, setsTotal: 2 }],
    settings: { restSeconds: 300, autoRest: false },
  }))).state;
  const first = c.mergeState(local, incoming);
  assert.deepEqual(first.result, { routines: 1, history: 1, skipped: 0, session: false });
  assert.deepEqual(first.state.history.map((h) => h.id), ['h3', 'h1', 'h2']);
  assert.equal(first.state.settings.restSeconds, 90);
  assert.equal(local.history.length, 2, 'input not mutated');
  const second = c.mergeState(first.state, incoming);
  assert.deepEqual(second.result, { routines: 0, history: 0, skipped: 0, session: false });
  assert.deepEqual(second.state.routines, first.state.routines);
});

test('merge keeps a differing workout with the same id as a separate copy', () => {
  const local = c.defaultState();
  local.routines = [routine()];
  const edited = { ...routine(), exercises: [{ id: 'e1', name: 'Deadlift', sets: 1, reps: '5', weight: '' }] };
  const { state, result } = c.mergeState(local, { ...c.defaultState(), routines: [edited], history: [], session: null });
  assert.equal(result.routines, 1);
  assert.equal(state.routines.length, 2);
  assert.equal(state.routines[0].exercises[0].name, 'Squat');
  assert.ok(state.routines[1].name.startsWith('A ('));
  assert.notEqual(state.routines[1].id, 'r');
});

test('merge respects the history and workout caps', () => {
  const local = c.defaultState();
  local.history = Array.from({ length: 100 }, (_, i) => ({ id: `l${i}`, name: 'A', startedAt: 1, endedAt: 1000 + i, setsDone: 1, setsTotal: 1 }));
  local.routines = Array.from({ length: 100 }, (_, i) => ({ id: `r${i}`, name: `R${i}`, exercises: [{ id: 'e', name: 'X', sets: 1, reps: '1', weight: '' }] }));
  const incoming = { ...c.defaultState(), history: [{ id: 'old', name: 'A', startedAt: 1, endedAt: 2, setsDone: 1, setsTotal: 1 }], session: null };
  incoming.routines = [{ id: 'extra', name: 'Extra', exercises: [{ id: 'e', name: 'X', sets: 1, reps: '1', weight: '' }] }];
  const { state, result } = c.mergeState(local, incoming);
  assert.equal(state.history.length, 100);
  assert.equal(result.history, 0);
  assert.equal(state.routines.length, 100);
  assert.equal(result.skipped, 1);
});

test('a running workout is never replaced by an imported one', () => {
  const local = sample();
  local.session = c.startSession(local.routines[0]);
  const incoming = sample();
  incoming.session = c.startSession(incoming.routines[0]);
  for (const fn of [c.mergeState, c.replaceState]) {
    const { state, result } = fn(local, incoming);
    assert.equal(state.session.id, local.session.id);
    assert.equal(result.session, false);
  }
  const idle = c.mergeState(sample(), incoming);
  assert.equal(idle.result.session, true);
  assert.equal(idle.state.session.id, incoming.session.id);
});

test('replace swaps plans, history and settings; keeps local plans when backup has none', () => {
  const local = sample();
  const incoming = { ...c.defaultState(), routines: [{ id: 'z', name: 'Z', exercises: [{ id: 'e', name: 'X', sets: 1, reps: '1', weight: '' }] }], history: [], settings: { restSeconds: 200, autoRest: false }, session: null };
  const { state, result } = c.replaceState(local, incoming);
  assert.deepEqual(state.routines.map((r) => r.id), ['z']);
  assert.equal(state.history.length, 0);
  assert.equal(state.settings.restSeconds, 200);
  assert.deepEqual(result, { routines: 1, history: 0, skipped: 0, session: false });
  assert.equal(c.replaceState(local, { ...incoming, routines: [] }).state.routines.length, local.routines.length);
});

test('import result survives save and load', () => {
  const store = mem();
  const incoming = c.parseBackup(JSON.stringify(c.buildBackup(sample()))).state;
  const { state } = c.mergeState(c.defaultState(), incoming);
  assert.equal(c.saveState(store, state), true);
  assert.equal(c.loadState(store).history.length, 2);
});

test('future record lists are merged by id on import and replaced on restore', () => {
  const local = { ...c.defaultState(), things: [{ id: 'a', n: 1 }] };
  const incoming = { ...c.defaultState(), things: [{ id: 'a', n: 9 }, { id: 'b', n: 2 }], extra: { x: 1 } };
  assert.deepEqual(c.mergeState(local, incoming).state.things, [{ id: 'a', n: 1 }, { id: 'b', n: 2 }]);
  assert.deepEqual(c.replaceState(local, incoming).state.things, incoming.things);
  assert.deepEqual(c.replaceState(local, incoming).state.extra, { x: 1 });
});
