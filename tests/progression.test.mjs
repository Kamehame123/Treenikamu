import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../core.js';
import * as p from '../progression.js';

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 20, 12);
const fixture = (reps = '10', extra = {}) => ({
  ...core.defaultState(),
  routines: [core.sanitizeRoutine({
    id: 'routine', name: 'Voima',
    exercises: [{ id: 'exercise', name: 'Kyykky', sets: 3, reps, weight: '100 kg', ...extra,
      progression: { minReps: 8, maxReps: 15, ...extra.progression } }],
  })],
});
function record(state, days = 0, options = {}) {
  const session = core.startSession(state.routines[0], NOW - days * DAY - 3600000);
  if (options.fatigued) session.fatigued = true;
  for (const exercise of session.exercises) {
    exercise.rir = options.rir ?? '2';
    if (options.pain) exercise.pain = true;
    exercise.sets.forEach((set, i) => {
      set.done = options.partial ? i === 0 : true;
      set.actualReps = options.reps?.[i] ?? String(set.reps ?? exercise.reps).split(/[-–]/).at(-1);
      if (options.weight !== undefined) set.actualWeight = options.weight;
    });
  }
  const summary = core.summarize(session, NOW - days * DAY);
  state.history.unshift(summary);
  return summary;
}
const revise = (state) => p.reviseRoutine(state, state.routines[0].id, NOW);
const exercise = (state) => state.routines[0].exercises[0];
const decision = (state) => state.routines[0].revision.changes[0];
const memory = (initial) => {
  let value = initial ?? null;
  return { getItem: () => value, setItem: (_key, next) => { value = next; } };
};

function automaticFixture(reps, extra = {}) {
  const state = fixture(reps, extra);
  delete state.routines[0].exercises[0].progression;
  return state;
}

test('automatic ranges reflect existing strength, mixed and higher-rep work rather than 8-15', () => {
  for (const [reps, name, min, max, next] of [
    ['5', 'Takakyykky', 3, 6, '6'],
    ['8', 'Penkkipunnerrus', 6, 12, '9'],
    ['10', 'Vipunosto sivulle', 10, 20, '11'],
    ['15', 'Kulmasoutu', 10, 20, '16'],
    ['20', 'Pohjenousu', 10, 20, '20'],
    ['25', 'Oma liike', 15, 30, '26'],
  ]) {
    const state = automaticFixture(reps, { name });
    const config = p.progressionConfig(exercise(state));
    assert.equal(config.minReps, min);
    assert.equal(config.maxReps, max);
    record(state); revise(state);
    assert.equal(exercise(state).reps, next);
    assert.ok(decision(state).reason);
  }
});

test('automatic ceilings remain fixed through rep progression, new loads, reload and undo', () => {
  const state = automaticFixture('10');
  const original = structuredClone(exercise(state));
  record(state, 14); revise(state);
  assert.equal(exercise(state).reps, '11');
  assert.equal(exercise(state).progression.maxReps, 12);
  assert.equal(p.undoRevision(state, 'routine').ok, true);
  assert.deepEqual(exercise(state), original);
  record(state, 13); revise(state);
  record(state, 7); revise(state);
  assert.equal(exercise(state).reps, '12');
  record(state, 1); revise(state);
  assert.equal(exercise(state).weight, '100 kg');
  record(state); revise(state);
  assert.equal(exercise(state).weight, '102.5 kg');
  assert.equal(exercise(state).reps, '10');
  const store = memory();
  core.saveState(store, state);
  const restored = core.loadState(store);
  assert.equal(p.progressionConfig(exercise(restored)).maxReps, 12);
  record(restored); revise(restored);
  assert.equal(exercise(restored).reps, '11');
  assert.equal(exercise(restored).weight, '102.5 kg');
});

test('automatic selection preserves per-set targets and partial settings without inventing saved limits', () => {
  const state = automaticFixture('10', { setReps: ['5', '10', '15'] });
  exercise(state).progression = { weightStep: 1.25, autoLoad: false };
  const store = memory();
  core.saveState(store, state);
  assert.deepEqual(core.loadState(store), state);
  assert.deepEqual(core.validateRoutine(state.routines[0]), []);
  record(state); revise(state);
  assert.deepEqual(exercise(state).setReps, ['6', '11', '16']);
  assert.equal(exercise(state).progression.minReps, 5);
  assert.equal(exercise(state).progression.maxReps, 20);
  assert.equal(exercise(state).progression.weightStep, 1.25);
  assert.equal(exercise(state).progression.autoLoad, false);
});

test('automatic selection does not program near-maximal singles or change non-repetition work', () => {
  for (const reps of ['1', '2', '30 s', '2 min', 'AMRAP', '31']) {
    const state = automaticFixture(reps);
    record(state);
    const before = structuredClone(exercise(state));
    revise(state);
    assert.deepEqual(exercise(state), before);
    assert.equal(decision(state).kind, 'hold');
  }
});

test('successful work adds at most one rep per set, never load or sets at the same time', () => {
  const state = fixture('8');
  record(state);
  const before = structuredClone(state.history);
  assert.equal(revise(state).ok, true);
  assert.equal(exercise(state).reps, '9');
  assert.equal(exercise(state).weight, '100 kg');
  assert.equal(exercise(state).sets, 3);
  assert.deepEqual(state.history, before);
  assert.equal(decision(state).kind, 'reps');
});

test('individual targets progress independently without exceeding the selected ceiling', () => {
  const state = fixture('10', { setReps: ['8', '10', '15'] });
  record(state);
  revise(state);
  assert.deepEqual(exercise(state).setReps, ['9', '11', '15']);
  assert.equal(exercise(state).reps, '9');
});

test('range targets require their upper bound, and duration/free text targets stay intact', () => {
  const state = fixture('8–12');
  record(state, 0, { reps: ['10', '10', '10'] });
  revise(state);
  assert.equal(decision(state).kind, 'hold');
  const success = fixture('8-12');
  record(success); revise(success);
  assert.equal(exercise(success).reps, '13');
  for (const reps of ['30 s', '2 min', 'AMRAP', '5', '20', '12-8', '0']) {
    const unchanged = fixture(reps);
    record(unchanged);
    const original = structuredClone(exercise(unchanged));
    revise(unchanged);
    assert.deepEqual(exercise(unchanged), original);
    assert.equal(decision(unchanged).kind, 'hold');
  }
});

test('explicit lower-rep strength ranges are respected', () => {
  const state = fixture('5', { progression: { minReps: 4, maxReps: 6, weightStep: 2.5 } });
  record(state); revise(state);
  assert.equal(exercise(state).reps, '6');
  record(state, 0);
  // The previous entry used 5 reps, not the new 6-rep ceiling.
  state.history[0].id = 'new-ceiling';
  revise(state);
  assert.equal(exercise(state).weight, '100 kg');
});

test('load requires two consecutive comparable ceiling performances and resets reps', () => {
  const state = fixture('15');
  record(state, 7); record(state);
  const history = structuredClone(state.history);
  revise(state);
  assert.equal(decision(state).kind, 'load');
  assert.equal(exercise(state).weight, '102.5 kg');
  assert.equal(exercise(state).reps, '13');
  assert.equal(exercise(state).setReps, null);
  assert.equal(exercise(state).sets, 3);
  assert.deepEqual(state.history, history);
});

test('one ceiling session holds; RIR 0 or 1 never justifies a load/rep increase', () => {
  const first = fixture('15');
  record(first); revise(first);
  assert.equal(decision(first).kind, 'hold');
  for (const reps of ['10', '15']) for (const rir of ['0', '1']) {
    const state = fixture(reps);
    record(state, 7); record(state, 0, { rir });
    revise(state);
    assert.equal(decision(state).kind, 'hold');
    assert.equal(exercise(state).weight, '100 kg');
    assert.equal(exercise(state).reps, reps);
  }
});

test('equipment steps are decimal-safe and the exact 10 percent boundary is enforced', () => {
  for (const [weightStep, kind, expected] of [[2, 'load', '22 kg'], [2.01, 'hold', '20 kg']]) {
    const state = fixture('15', { weight: '20 kg', progression: { weightStep } });
    record(state, 7); record(state); revise(state);
    assert.equal(decision(state).kind, kind);
    assert.equal(exercise(state).weight, expected);
  }
  const state = fixture('15', { weight: '22,5 kg', progression: { weightStep: 1.25 } });
  record(state, 7); record(state); revise(state);
  assert.equal(exercise(state).weight, '23.75 kg');
});

test('new-load rep reductions scale with the step and never force work below the selected band', () => {
  for (const [step, expectedReps] of [[1, '14'], [2.5, '13'], [5, '12'], [10, '10']]) {
    const state = fixture('15', { progression: { weightStep: step } });
    record(state, 7); record(state); revise(state);
    assert.equal(decision(state).kind, 'load');
    assert.equal(exercise(state).reps, expectedReps);
    assert.equal(exercise(state).weight, `${100 + step} kg`);
  }
  const strength = fixture('6', { progression: { minReps: 3, maxReps: 6, weightStep: 10 } });
  record(strength, 7); record(strength);
  const before = structuredClone(exercise(strength));
  revise(strength);
  assert.equal(decision(strength).kind, 'hold');
  assert.deepEqual(exercise(strength), before);
});

test('bodyweight, assistance, disabled auto-load, and ambiguous units are never guessed', () => {
  for (const extra of [
    { weight: '' }, { weight: '0' }, { weight: '2 x 10 kg' }, { weight: '20 lb' },
    { name: 'Avustettu leuanveto' }, { name: 'Assisted pull up' },
    { progression: { autoLoad: false } },
  ]) {
    const state = fixture('15', extra);
    record(state, 7); record(state);
    const original = structuredClone(exercise(state));
    revise(state);
    assert.deepEqual(exercise(state), original);
    assert.equal(decision(state).kind, 'hold');
  }
  assert.equal(p.parseWeight('25,5 kg'), 25.5);
  for (const weight of ['-1', 'NaN', '1e3', '2x10', '10 lbs', 'Infinity']) assert.equal(p.parseWeight(weight), null);
});

test('missing logs, effort, partial sets, invalid input and changed actual loads block progression', () => {
  for (const alter of [
    (e) => { delete e.rir; },
    (e) => { e.rir = '6'; },
    (e) => { e.rir = '-1'; },
    (e) => { delete e.sets[1].actualReps; },
    (e) => { e.sets[1].actualReps = '9.5'; },
    (e) => { e.sets[1].actualReps = '101'; },
    (e) => { e.sets[1].done = false; },
    (e) => { e.sets[1].actualWeight = '105 kg'; },
  ]) {
    const state = fixture();
    const log = record(state);
    alter(log.exercises[0]);
    const before = structuredClone(exercise(state));
    revise(state);
    assert.deepEqual(exercise(state), before);
    assert.equal(decision(state).kind, 'hold');
  }
  const equivalent = fixture();
  record(equivalent, 0, { weight: '100,0' });
  revise(equivalent);
  assert.equal(decision(equivalent).kind, 'reps');
});

test('pain always blocks changes, even when fatigued or otherwise ready for more', () => {
  for (const fatigued of [false, true]) {
    const state = fixture();
    record(state, 7); record(state, 0, { pain: true, fatigued });
    const original = structuredClone(exercise(state));
    revise(state);
    assert.deepEqual(exercise(state), original);
    assert.match(decision(state).reason, /kipua/);
  }
});

test('a single bad day holds, while repeated substantial underperformance deloads', () => {
  const single = fixture('12');
  record(single, 0, { reps: ['9', '9', '9'], rir: '1' });
  revise(single);
  assert.equal(decision(single).kind, 'hold');
  const repeated = fixture('12');
  record(repeated, 7, { reps: ['9', '9', '9'], rir: '1' });
  record(repeated, 0, { reps: ['9', '9', '9'], rir: '1' });
  revise(repeated);
  assert.equal(decision(repeated).kind, 'deload');
  assert.equal(exercise(repeated).sets, 2);
  assert.equal(exercise(repeated).reps, '8');
  assert.equal(exercise(repeated).weight, '90 kg');
  assert.deepEqual(exercise(repeated).recoveryBase, { sets: 3, reps: '12', weight: '100 kg', setReps: null });
});

test('explicit fatigue deloads without requiring failure; coarse steps do not over-reduce load', () => {
  const state = fixture('10', { weight: '5 kg', progression: { weightStep: 2.5 } });
  record(state, 0, { fatigued: true });
  revise(state);
  assert.equal(decision(state).kind, 'deload');
  assert.equal(exercise(state).sets, 2);
  assert.equal(exercise(state).weight, '5 kg');
});

test('a successful recovery session restores the previous plan, not a higher load', () => {
  const state = fixture('12');
  const original = structuredClone(exercise(state));
  record(state, 7, { fatigued: true }); revise(state);
  record(state);
  revise(state);
  assert.equal(decision(state).kind, 'restore');
  assert.deepEqual(exercise(state), original);
  assert.equal(p.undoRevision(state, 'routine').ok, true);
  assert.equal(exercise(state).weight, '90 kg');
  assert.ok(exercise(state).recoveryBase);
});

test('continued fatigue holds the deload rather than repeatedly halving volume', () => {
  const state = fixture('12');
  record(state, 7, { fatigued: true }); revise(state);
  const deload = structuredClone(exercise(state));
  record(state, 0, { fatigued: true }); revise(state);
  assert.equal(decision(state).kind, 'hold');
  assert.deepEqual(exercise(state), deload);
});

test('an already minimal prescription is truly unchanged when no deload reduction is possible', () => {
  const state = fixture('8', { sets: 1, weight: '' });
  record(state, 0, { fatigued: true });
  const before = structuredClone(exercise(state));
  revise(state);
  assert.equal(decision(state).kind, 'hold');
  assert.deepEqual(exercise(state), before);
  assert.equal(p.canUndoRevision(state.routines[0]), false);
});

test('stale, changed, interrupted, painful and fatigued prior sessions cannot confirm load increases', () => {
  for (const options of [{ days: 22 }, { partial: true }, { pain: true }, { fatigued: true }, { rir: '' }]) {
    const state = fixture('15');
    record(state, options.days ?? 7, options);
    record(state); revise(state);
    assert.equal(decision(state).kind, 'hold');
  }
  const stale = fixture();
  record(stale, 15); revise(stale);
  assert.equal(decision(stale).kind, 'hold');
  const edited = fixture();
  record(edited);
  exercise(edited).name = 'Uusi liike';
  revise(edited);
  assert.equal(decision(edited).kind, 'hold');
});

test('undo is exact, keeps history, and consumed source sessions cannot apply twice after reload', () => {
  const state = fixture('10', { setReps: ['8', '10', '12'] });
  const original = structuredClone(exercise(state));
  record(state);
  const history = structuredClone(state.history);
  revise(state);
  assert.equal(revise(state).ok, false);
  const store = memory();
  core.saveState(store, state);
  const restored = core.loadState(store);
  assert.equal(p.canUndoRevision(restored.routines[0]), true);
  assert.equal(p.undoRevision(restored, 'routine').ok, true);
  assert.deepEqual(exercise(restored), original);
  assert.deepEqual(restored.history, history);
  core.saveState(store, restored);
  const again = core.loadState(store);
  assert.equal(revise(again).ok, false);
  assert.equal(p.undoRevision(again, 'routine').ok, false);
  record(again);
  assert.equal(revise(again).ok, true);
});

test('undo cannot overwrite intervening manual edits or an active workout', () => {
  const state = fixture();
  record(state); revise(state);
  const revised = structuredClone(exercise(state));
  state.session = core.startSession(state.routines[0]);
  assert.equal(p.undoRevision(state, 'routine').ok, false);
  assert.equal(revise(state).ok, false);
  state.session = null;
  exercise(state).weight = '50 kg';
  assert.equal(p.undoRevision(state, 'routine').ok, false);
  assert.notDeepEqual(exercise(state), revised);
});

test('only matching routine and exercise identities are used, not names or old summary counts', () => {
  const legacy = fixture();
  legacy.history.push({ id: 'legacy', name: 'Voima', setsDone: 3, setsTotal: 3, endedAt: NOW });
  assert.equal(revise(legacy).ok, false);
  const state = fixture('15');
  record(state, 7);
  state.history[0].routineId = 'different';
  record(state);
  revise(state);
  assert.equal(decision(state).kind, 'hold');
  assert.equal(p.reviseRoutine(state, 'missing', NOW).ok, false);
});

test('old browser data upgrades additively without overwriting storage or losing any records', () => {
  const legacy = fixture();
  delete legacy.routines[0].autoProgress;
  legacy.history = [{ id: 'legacy', name: 'A', startedAt: 1000, endedAt: 2000, setsDone: 2, setsTotal: 3 }];
  legacy.customExercises = [{ id: 'own', name: 'Oma', category: 'Selkä', equipment: 'Talja', reps: '10' }];
  legacy.session = core.startSession(legacy.routines[0], 1000);
  legacy.session.exercises[0].sets[0].done = true;
  legacy.restEnd = 3000;
  const raw = JSON.stringify(legacy), store = memory(raw);
  const loaded = core.loadState(store);
  assert.equal(store.getItem(), raw);
  assert.equal(loaded.routines[0].autoProgress, false);
  assert.deepEqual(loaded.history, legacy.history);
  assert.deepEqual(loaded.customExercises, legacy.customExercises);
  assert.deepEqual(loaded.session, legacy.session);
  assert.equal(loaded.restEnd, 3000);
  assert.deepEqual(core.loadState(store), loaded);
});

test('new detailed history, recovery bases, revisions and settings survive every persistence path', () => {
  const state = fixture();
  state.routines[0].autoProgress = true;
  record(state, 7, { fatigued: true });
  revise(state);
  state.session = core.startSession(state.routines[0]);
  state.session.exercises[0].sets[0] = { done: true, actualReps: '8', actualWeight: '90,0', reps: '8' };
  state.session.exercises[0].rir = '0';
  state.session.exercises[0].pain = true;
  const store = memory();
  assert.equal(core.saveState(store, state), true);
  assert.deepEqual(core.loadState(store), state);
  const backup = core.parseBackup(JSON.stringify(core.buildBackup(state, NOW)));
  assert.equal(backup.ok, true);
  assert.deepEqual(backup.state, state);
  for (const merge of [core.mergeState, core.replaceState]) {
    const applied = merge({ ...core.defaultState(), routines: [] }, backup.state).state;
    assert.deepEqual(applied.routines, state.routines);
    assert.deepEqual(applied.history, state.history);
    assert.deepEqual(applied.session, state.session);
    assert.deepEqual(merge(applied, backup.state).state, applied);
  }
});

test('failed persistence leaves original bytes available; retry preserves history and undo', () => {
  const state = fixture();
  record(state);
  const store = memory(JSON.stringify(state));
  const original = store.getItem();
  const failed = { getItem: store.getItem, setItem() { throw new Error('quota'); } };
  const next = core.loadState(failed);
  revise(next);
  assert.equal(core.saveState(failed, next), false);
  assert.equal(store.getItem(), original);
  assert.equal(core.saveState(store, next), true);
  const restored = core.loadState(store);
  assert.deepEqual(restored.history, state.history);
  assert.equal(p.undoRevision(restored, 'routine').ok, true);
  assert.deepEqual(restored.routines[0].exercises, state.routines[0].exercises);
});

test('conflicting imported plans retain history/session relationships and re-import is idempotent', () => {
  const local = fixture('8'), incoming = fixture('12');
  record(incoming);
  incoming.session = core.startSession(incoming.routines[0]);
  const original = structuredClone(incoming);
  const merged = core.mergeState(local, incoming).state;
  const imported = merged.routines.find((r) => r.id !== 'routine');
  assert.ok(imported);
  assert.equal(merged.history[0].routineId, imported.id);
  assert.equal(merged.session.routineId, imported.id);
  assert.deepEqual(merged.history[0].exercises, incoming.history[0].exercises);
  assert.deepEqual(core.mergeState(merged, incoming).state, merged);
  assert.deepEqual(incoming, original);
  const store = memory();
  core.saveState(store, merged);
  assert.deepEqual(core.loadState(store), merged);
});

test('progression settings are bounded defensively and invalid editor values are reported', () => {
  const starter = core.defaultState().routines[0];
  assert.equal(JSON.stringify(core.sanitizeRoutine(starter)), JSON.stringify(starter));
  assert.deepEqual(p.progressionConfig({}), { minReps: 6, maxReps: 12, weightStep: 2.5, autoLoad: true });
  const state = fixture();
  exercise(state).progression = { minReps: 15, maxReps: 8, weightStep: 0 };
  assert.equal(core.validateRoutine(state.routines[0]).length, 2);
  const sanitized = core.sanitizeRoutine(state.routines[0]);
  assert.equal(sanitized.exercises[0].progression.maxReps, 15);
  assert.equal(sanitized.exercises[0].progression.weightStep, 2.5);
});
