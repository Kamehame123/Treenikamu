import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../core.js';
import * as w from '../wod.js';
import { reviseRoutine } from '../progression.js';

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

test('new UI set taps capture the displayed reps without replacing overrides or reconstructing older results', () => {
  const r = routine(); r.exercises[0].setReps = ['5', '8-12', '8'];
  const s = c.startSession(r), original = structuredClone(r);
  assert.equal(c.toggleSet(s, 0, 0, { logReps: true }), true);
  assert.equal(s.exercises[0].sets[0].actualReps, '5');
  assert.equal(c.toggleSet(s, 0, 0, { logReps: true }), false);
  assert.equal(s.exercises[0].sets[0].actualReps, '5', 'undo keeps the entered count but excludes the unfinished set');
  c.toggleSet(s, 0, 1, { logReps: true });
  assert.equal(s.exercises[0].sets[1].actualReps, undefined, 'a range target never records its upper bound');
  assert.equal(c.isRepRange(s.exercises[0], s.exercises[0].sets[1]), true);
  for (const actualReps of ['0', '7', 'invalid']) {
    const set = s.exercises[0].sets[2]; set.done = false; set.actualReps = actualReps;
    c.toggleSet(s, 0, 2, { logReps: true });
    assert.equal(set.actualReps, actualReps);
  }
  c.toggleSet(s, 1, 0);
  assert.equal(s.exercises[1].sets[0].actualReps, undefined, 'completion-only APIs and old snapshots remain distinct');
  assert.deepEqual(r, original);
});

test('UI completion never converts timed, free-text or invalid targets into actual reps', () => {
  for (const target of ['45 s', '2 min', 'AMRAP', '0', '10000', '12-8']) {
    const s = c.startSession(routine()), e = s.exercises[0]; e.reps = target;
    c.toggleSet(s, 0, 0, { logReps: true });
    assert.equal(e.sets[0].actualReps, undefined, target);
  }
  const s = c.startSession(routine()); s.exercises[0].sets[0].actualSeconds = '45';
  c.toggleSet(s, 0, 0, { logReps: true });
  assert.equal(s.exercises[0].sets[0].actualReps, undefined);
});

test('old completed reps are filled only by explicit confirmation, preserving overrides, incomplete sets and timed work', () => {
  const state = c.defaultState(), s = c.startSession(routine(), 1000), e = s.exercises[0];
  e.sets = [{ done: true }, { done: true, reps: '8-12' }, { done: false },
    { done: true, actualReps: '0' }, { done: true, actualReps: '7' },
    { done: true, reps: '45 s' }, { done: true, actualSeconds: '30' }];
  state.history = [c.summarize(s, 5000)];
  const h = state.history[0], before = structuredClone(state);
  assert.deepEqual(c.historyRepSuggestions(h.exercises[0]), [{ si: 0, reps: 5 }], 'range targets are never suggested');
  assert.deepEqual(state, before, 'suggestions alone are read-only');
  assert.equal(c.confirmHistoryReps(state, h.id, 0, 6000).ok, true);
  const expected = structuredClone(before);
  expected.history[0].exercises[0].sets[0].actualReps = '5';
  expected.history[0].editedAt = 6000;
  assert.deepEqual(state, expected);
  assert.equal(c.confirmHistoryReps(state, h.id, 0).ok, false);
  assert.equal(c.confirmHistoryReps(state, 'missing', 0).ok, false);
  assert.equal(c.confirmHistoryReps(state, h.id, 99).ok, false);
  assert.deepEqual(state, expected, 'retry is non-destructive and does not duplicate or alter confirmed results');
});

test('a workout load choice is saved to the session and once to the program, never to history', () => {
  const state = c.defaultState();
  state.routines = [routine()];
  state.session = c.startSession(state.routines[0], 1000);
  state.history = [{ id: 'old', name: 'Vanha', startedAt: 1, endedAt: 2, setsDone: 0, setsTotal: 0, exercises: [] }];
  const before = structuredClone(state.history);
  assert.equal(state.session.exercises[0].tracking, undefined);
  assert.deepEqual(c.setSessionLoadType(state, 0, 'external'), { ok: true, programUpdated: true });
  assert.equal(state.session.exercises[0].tracking.loadType, 'external');
  assert.equal(state.routines[0].exercises[0].tracking.loadType, 'external');
  assert.deepEqual(state.history, before);
  assert.deepEqual(c.setSessionLoadType(state, 0, 'per-hand'), { ok: true, programUpdated: false }, 'a program choice is not overwritten');
  assert.equal(state.routines[0].exercises[0].tracking.loadType, 'external');
  assert.equal(c.setSessionLoadType(state, 0, 'unknown').ok, false);
  assert.equal(c.setSessionLoadType(state, 99, 'external').ok, false);
  assert.equal(c.startSession(state.routines[0], 3000).exercises[0].tracking.loadType, 'external');
});

test('explicit historical load corrections preserve metadata and unrelated data through backup and reload', () => {
  const state = c.defaultState(), s = c.startSession(routine(), 1000);
  s.exercises[0].tracking = { sourceId: 'library', category: 'Jalat', equipment: 'Levytanko', loadType: 'unknown', variant: 'Sali A' };
  s.exercises[0].sets[0].done = true;
  state.history = [c.summarize(s, 5000)]; state.session = c.startSession(routine(), 2000);
  const h = state.history[0], before = structuredClone(state);
  assert.equal(c.editHistoryLoadType(state, h.id, 0, 'per-hand', 6000).ok, true);
  const expected = structuredClone(before);
  expected.history[0].exercises[0].tracking.loadType = 'per-hand'; expected.history[0].editedAt = 6000;
  assert.deepEqual(state, expected);
  assert.equal(c.editHistoryLoadType(state, h.id, 0, 'guessed').ok, false);
  assert.equal(c.editHistoryLoadType(state, h.id, 0, '__proto__').ok, false);
  assert.equal(c.editHistoryLoadType(state, 'missing', 0, 'external').ok, false);
  assert.equal(c.editHistoryLoadType(state, h.id, 99, 'external').ok, false);
  assert.deepEqual(state, expected);
  c.confirmHistoryReps(state, h.id, 0, 6000);
  const parsed = c.parseBackup(JSON.stringify(c.buildBackup(state, 7000)));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.state.history, state.history);
  const storage = mem(); assert.equal(c.saveState(storage, state), true);
  assert.deepEqual(c.loadState(storage).history, state.history);
  assert.deepEqual(state.routines, before.routines); assert.deepEqual(state.session, before.session);
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
  for (const target of ['45 s', '2 min', 'AMRAP', '0', '10000', '12-8']) {
    set.reps = target;
    assert.equal(c.setRepCount(exercise, set), null);
    const before = structuredClone(s);
    assert.equal(c.adjustSetReps(s, 0, 0, -1).ok, false);
    assert.deepEqual(s, before);
  }
});

test('quick rep bounds and invalid actions report errors without changing records', () => {
  const s = c.startSession(routine()), exercise = s.exercises[0], set = exercise.sets[0];
  for (const [actual, delta] of [['0', -1], ['9999', 1], ['10000', -1], ['-1', 1], ['1.5', 1], ['', 1], ['bad', -1]]) {
    set.actualReps = actual;
    const before = structuredClone(s);
    const result = c.adjustSetReps(s, 0, 0, delta);
    assert.equal(result.ok, false);
    assert.ok(result.error.length);
    assert.deepEqual(s, before);
  }
  set.actualReps = '0';
  assert.deepEqual(c.adjustSetReps(s, 0, 0, 1), { ok: true, reps: 1 });
  set.actualReps = '9999';
  assert.deepEqual(c.adjustSetReps(s, 0, 0, -1), { ok: true, reps: 9998 });
  set.actualReps = '9998';
  assert.deepEqual(c.adjustSetReps(s, 0, 0, 1), { ok: true, reps: 9999 });
  for (const [session, ei, si, delta] of [[null, 0, 0, 1], [s, 99, 0, 1], [s, 0, 99, 1], [s, 0, 0, 0], [s, 0, 0, 2]]) {
    const before = structuredClone(s);
    const result = c.adjustSetReps(session, ei, si, delta);
    assert.equal(result.ok, false);
    assert.ok(result.error.length);
    assert.deepEqual(s, before);
  }
});

test('quick weight adjustments use the exercise step, keep decimals and clear the override at the planned weight', () => {
  const r = routine();
  r.exercises[0].weight = '22,5 kg';
  const s = c.startSession(r), exercise = s.exercises[0], set = exercise.sets[0];
  const step = c.weightStepFor(exercise);
  assert.equal(step, 2);
  assert.equal(c.setWeightValue(exercise, set), 22.5);
  assert.deepEqual(c.adjustSetWeight(s, 0, 0, 1), { ok: true, weight: 24.5 });
  assert.equal(set.actualWeight, '24,5');
  assert.equal(c.weightStepFor(exercise), step, 'the step is fixed by the plan, not by the logged weight');
  assert.deepEqual(c.adjustSetWeight(s, 0, 0, -1), { ok: true, weight: 22.5 });
  assert.equal('actualWeight' in set, false);
  assert.deepEqual(c.adjustSetWeight(s, 0, 0, -1), { ok: true, weight: 20.5 });
  assert.equal(exercise.weight, '22,5 kg');
  assert.equal(r.exercises[0].weight, '22,5 kg');
});

test('a saved routine weight step wins over the automatic one and reaches the session', () => {
  const r = routine();
  r.exercises[0].weight = '100 kg';
  r.exercises[0].progression = { weightStep: 1.25 };
  const s = c.startSession(r);
  assert.equal(s.exercises[0].weightStep, 1.25);
  assert.equal('weightStep' in s.exercises[1], false);
  assert.deepEqual(c.adjustSetWeight(s, 0, 0, 1), { ok: true, weight: 101.25 });
  assert.equal(c.sanitizeSession(s).exercises[0].weightStep, 1.25);
  s.exercises[0].weightStep = 'bad';
  assert.equal('weightStep' in c.sanitizeSession(s).exercises[0], false);
  assert.equal(c.weightStepFor(s.exercises[0]), 2.5);
});

test('typed weights accept decimal commas and units, and report bad input without changing records', () => {
  const r = routine();
  r.exercises[0].weight = '100 kg';
  const s = c.startSession(r), set = s.exercises[0].sets[0];
  assert.deepEqual(c.setSetWeight(s, 0, 0, '97,5'), { ok: true, weight: 97.5 });
  assert.equal(set.actualWeight, '97,5');
  assert.deepEqual(c.setSetWeight(s, 0, 0, '100'), { ok: true, weight: 100 });
  assert.equal('actualWeight' in set, false);
  assert.deepEqual(c.setSetWeight(s, 0, 0, '12.25'), { ok: true, weight: 12.25 });
  assert.deepEqual(c.setSetWeight(s, 0, 0, ''), { ok: true, weight: 100 });
  assert.equal('actualWeight' in set, false);
  for (const bad of ['105 lbs', 'abc', '-5', '10001', '1e3', '2 x 10']) {
    const before = structuredClone(s);
    assert.equal(c.setSetWeight(s, 0, 0, bad).ok, false, bad);
    assert.deepEqual(s, before);
  }
  assert.equal(c.setSetWeight(s, 9, 0, '5').ok, false);
  assert.equal(c.setSetWeight(null, 0, 0, '5').ok, false);
});

test('typed reps accept 0–9999 and leave the target and other sets alone', () => {
  const s = c.startSession(routine()), sets = s.exercises[0].sets;
  assert.deepEqual(c.setSetReps(s, 0, 0, '7'), { ok: true, reps: 7 });
  assert.deepEqual(c.setSetReps(s, 0, 1, ' 012 '), { ok: true, reps: 12 });
  assert.deepEqual(c.setSetReps(s, 0, 2, '0'), { ok: true, reps: 0 });
  assert.deepEqual(sets.map((x) => x.actualReps), ['7', '12', '0']);
  assert.equal(s.exercises[0].reps, '5');
  for (const bad of ['', '10000', '-1', '1,5', 'x']) {
    const before = structuredClone(s);
    assert.equal(c.setSetReps(s, 0, 0, bad).ok, false, bad);
    assert.deepEqual(s, before);
  }
  assert.equal(c.setSetReps(s, 0, 9, '5').ok, false);
});

test('quick weight handles empty plans, bounds and non-numeric weights without changing records', () => {
  const s = c.startSession(routine()), exercise = s.exercises[0], set = exercise.sets[0];
  exercise.weight = '';
  assert.equal(c.setWeightValue(exercise, set), 0);
  assert.equal(c.adjustSetWeight(s, 0, 0, -1).ok, false);
  assert.deepEqual(c.adjustSetWeight(s, 0, 0, 1), { ok: true, weight: 2.5 });
  assert.deepEqual(c.adjustSetWeight(s, 0, 0, -1), { ok: true, weight: 0 });
  exercise.weight = '0,2';
  assert.deepEqual(c.adjustSetWeight(s, 0, 0, -1), { ok: true, weight: 0 });
  assert.equal(set.actualWeight, '0');
  exercise.weight = '';
  delete set.actualWeight;
  for (const weight of ['2 x 10 kg', 'oma paino']) {
    exercise.weight = weight;
    const before = structuredClone(s);
    assert.equal(c.adjustSetWeight(s, 0, 0, 1).ok, false);
    assert.deepEqual(s, before);
  }
  exercise.weight = '10000';
  assert.equal(c.adjustSetWeight(s, 0, 0, 1).ok, false);
  assert.equal(c.adjustSetWeight(s, 9, 0, 1).ok, false);
  assert.equal(c.adjustSetWeight(null, 0, 0, 1).ok, false);
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

const bench = { id: 'lib-penkkipunnerrus', name: 'Penkkipunnerrus', category: 'Rinta', equipment: 'Levytanko', reps: '8' };
const fly = { id: 'lib-rintaprassi', name: 'Rintaprassi', category: 'Rinta', equipment: 'Laite', reps: '12' };

test('replacing a session exercise keeps targets, clears values and never touches the program', () => {
  const r = routine();
  r.exercises[0].weight = '100 kg';
  r.exercises[0].setReps = ['5', '6', '8'];
  const original = structuredClone(r);
  const s = c.startSession(r);
  s.exercises[0].rir = '2'; s.exercises[0].pain = true;
  c.toggleSet(s, 0, 0); c.adjustSetWeight(s, 0, 0, 1);
  const programId = s.exercises[0].id;
  assert.deepEqual(c.replaceSessionExercise(s, programId, bench), { ok: true, index: 0 });
  const swapped = s.exercises[0];
  assert.equal(swapped.name, 'Penkkipunnerrus');
  assert.equal(swapped.id, 'adhoc-lib-penkkipunnerrus');
  assert.notEqual(swapped.id, programId);
  assert.equal(swapped.weight, '');
  assert.equal(swapped.reps, '5');
  assert.deepEqual(swapped.sets, [{ done: false, kind: 'working', reps: '5' }, { done: false, kind: 'working', reps: '6' }, { done: false, kind: 'working', reps: '8' }]);
  assert.equal(swapped.tracking.sourceId, 'lib-penkkipunnerrus');
  assert.equal('rir' in swapped, false);
  assert.equal('pain' in swapped, false);
  assert.deepEqual(r, original);
  assert.equal(c.sanitizeSession(s).exercises[0].id, 'adhoc-lib-penkkipunnerrus');
  assert.equal(c.replaceSessionExercise(s, 'missing', bench).ok, false);
  assert.equal(c.replaceSessionExercise(null, 'x', bench).ok, false);
});

test('inserting puts the exercise after the current one, or last when all are done', () => {
  const s = c.startSession(routine());
  [0, 1, 2].forEach((i) => c.toggleSet(s, 0, i));
  assert.deepEqual(c.insertSessionExercise(s, fly), { ok: true, index: 2 });
  assert.deepEqual(s.exercises.map((e) => e.name), ['Squat', 'Row', 'Rintaprassi']);
  assert.deepEqual(s.exercises[2].sets, [0, 1, 2].map(() => ({ done: false, kind: 'working' })));
  assert.equal(s.exercises[2].reps, '12');
  assert.equal(s.exercises[2].weight, '');
  [0, 1].forEach((i) => c.toggleSet(s, 1, i));
  assert.equal(c.currentExercise(s), 2);
  assert.deepEqual(c.insertSessionExercise(s, bench), { ok: true, index: 3 });
  [0, 1, 2].forEach((i) => c.toggleSet(s, 2, i));
  [0, 1, 2].forEach((i) => c.toggleSet(s, 3, i));
  assert.equal(c.currentExercise(s), -1);
  assert.deepEqual(c.insertSessionExercise(s, fly), { ok: true, index: 4 });
  assert.equal(new Set(s.exercises.map((e) => e.id)).size, 5, 'ids stay unique when the same library exercise is added twice');
  assert.equal(c.insertSessionExercise(s, null).ok, false);
});

test('inserting respects the exercise limit', () => {
  const s = c.startSession(routine());
  while (s.exercises.length < c.SESSION_EXERCISE_LIMIT) assert.equal(c.insertSessionExercise(s, fly).ok, true);
  const before = structuredClone(s);
  assert.equal(c.insertSessionExercise(s, bench).ok, false);
  assert.deepEqual(s, before);
});

test('removing a session exercise keeps the last one and the program unchanged', () => {
  const r = routine(), original = structuredClone(r);
  const s = c.startSession(r);
  assert.equal(c.removeSessionExercise(s, 'missing').ok, false);
  assert.deepEqual(c.removeSessionExercise(s, 'e1'), { ok: true, index: 0 });
  assert.deepEqual(s.exercises.map((e) => e.id), ['e2']);
  const before = structuredClone(s);
  assert.equal(c.removeSessionExercise(s, 'e2').ok, false);
  assert.deepEqual(s, before);
  assert.deepEqual(r, original);
  assert.equal(c.loggedSetCount(c.startSession(r).exercises[0]), 0);
});

test('swap category falls back from tracking to the library, custom exercises and nothing', () => {
  assert.equal(c.sessionExerciseCategory({ name: 'x', tracking: { category: 'Selkä' } }), 'Selkä');
  assert.equal(c.sessionExerciseCategory({ name: 'Penkkipunnerrus' }), 'Rinta');
  assert.equal(c.sessionExerciseCategory({ name: 'Oma veto' }, [{ name: 'Oma veto', category: 'Hauis' }]), 'Hauis');
  assert.equal(c.sessionExerciseCategory({ name: 'Tuntematon liike' }), '');
  assert.equal(c.sessionExerciseCategory(null), '');
});

test('a changed session is saved to history and survives reload while the program stays identical', () => {
  const state = c.defaultState();
  const programs = structuredClone(state.routines);
  state.session = c.startSession(state.routines[0]);
  const first = state.session.exercises[0].id;
  c.replaceSessionExercise(state.session, first, bench);
  c.removeSessionExercise(state.session, state.session.exercises[1].id);
  c.insertSessionExercise(state.session, fly);
  state.session.exercises.forEach((e, ei) => e.sets.forEach((_, si) => c.toggleSet(state.session, ei, si)));
  const store = mem();
  assert.equal(c.saveState(store, state), true);
  const recovered = c.loadState(store);
  assert.deepEqual(recovered.session.exercises.map((e) => e.name), state.session.exercises.map((e) => e.name));
  recovered.history.unshift(c.summarize(recovered.session));
  assert.ok(recovered.history[0].exercises.some((e) => e.name === 'Penkkipunnerrus' && e.sets.every((x) => x.done)));
  assert.ok(recovered.history[0].exercises.some((e) => e.name === 'Rintaprassi'));
  assert.deepEqual(recovered.routines, programs);
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

test('saveStateResult tells a full storage apart from other failures', () => {
  const full = new DOMException('full', 'QuotaExceededError');
  assert.deepEqual(c.saveStateResult({ setItem() { throw full; } }, c.defaultState()), { ok: false, quota: true });
  assert.deepEqual(c.saveStateResult({ setItem() { throw new Error('denied'); } }, c.defaultState()), { ok: false, quota: false });
  assert.deepEqual(c.saveStateResult({ setItem() {} }, c.defaultState()), { ok: true, quota: false });
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
  const future = JSON.stringify({ ...c.defaultState(), v: c.SCHEMA + 1, futureFeature: { important: true } });
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

test('schema 1 data and backups upgrade to schema 2 with nothing else changed', () => {
  const st = sample();
  st.session = c.startSession(st.routines[0]);
  const v1 = JSON.parse(JSON.stringify({ ...st, v: 1 }));
  const before = JSON.stringify(v1);
  assert.equal(c.SCHEMA, 2);
  assert.deepEqual(c.migrateData(v1), { ...v1, v: 2 });
  assert.equal(JSON.stringify(v1), before, 'the input is not modified');
  assert.deepEqual(c.sanitizeState(v1), c.sanitizeState({ ...v1, v: 2 }));
  const parsed = c.parseBackup(JSON.stringify({ format: c.BACKUP_FORMAT, formatVersion: 1, data: v1 }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.meta.fromVersion, 1);
  assert.equal(parsed.state.v, 2);
  assert.deepEqual(parsed.state.routines, c.sanitizeState(v1).routines);
  assert.deepEqual(parsed.state.history, c.sanitizeState(v1).history);
  const store = mem([[c.STORAGE_KEY, JSON.stringify(v1)]]);
  assert.equal(c.storageProblem(store.getItem(c.STORAGE_KEY)), null, 'schema 1 data on this device is read, not refused');
  assert.equal(c.saveState(store, c.sanitizeState(v1)), true);
  assert.equal(JSON.parse(store.getItem(c.STORAGE_KEY)).v, 2);
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
  local.history = Array.from({ length: c.MAX_HISTORY }, (_, i) => ({ id: `l${i}`, name: 'A', startedAt: 1, endedAt: 1000 + i, setsDone: 1, setsTotal: 1 }));
  local.routines = Array.from({ length: 100 }, (_, i) => ({ id: `r${i}`, name: `R${i}`, exercises: [{ id: 'e', name: 'X', sets: 1, reps: '1', weight: '' }] }));
  const incoming = { ...c.defaultState(), history: [{ id: 'old', name: 'A', startedAt: 1, endedAt: 2, setsDone: 1, setsTotal: 1 }], session: null };
  incoming.routines = [{ id: 'extra', name: 'Extra', exercises: [{ id: 'e', name: 'X', sets: 1, reps: '1', weight: '' }] }];
  const { state, result } = c.mergeState(local, incoming);
  assert.equal(state.history.length, c.MAX_HISTORY);
  assert.equal(state.routines.length, 100);
  assert.equal(result.skipped, 1);
});

test('history keeps well over 100 workouts and only the 10,000 cap trims it', () => {
  assert.equal(c.MAX_HISTORY, 10000);
  const make = (n) => Array.from({ length: n }, (_, i) => ({ id: `h${i}`, name: 'A', startedAt: 1, endedAt: 1000 + i, setsDone: 1, setsTotal: 1 }));
  const loaded = c.sanitizeState({ ...c.defaultState(), history: make(250) });
  assert.equal(loaded.history.length, 250);
  assert.equal(c.sanitizeState({ ...c.defaultState(), history: make(c.MAX_HISTORY + 5) }).history.length, c.MAX_HISTORY);
  const local = c.defaultState(); local.history = make(150);
  const incoming = { ...c.defaultState(), history: [{ id: 'older', name: 'A', startedAt: 1, endedAt: 2, setsDone: 1, setsTotal: 1 }] };
  const merged = c.mergeState(local, incoming);
  assert.equal(merged.state.history.length, 151);
  assert.equal(merged.result.history, 1);
});

test('unparseable saved text is detected and never overwritten', () => {
  for (const bad of ['{not json', '[1,2]', '42', '"text"', '{"routines":']) {
    assert.equal(c.storageProblem(bad), 'unreadable', bad);
    const store = mem([[c.STORAGE_KEY, bad]]);
    assert.equal(c.saveState(store, c.defaultState()), false);
    assert.equal(store.getItem(c.STORAGE_KEY), bad);
  }
  for (const ok of [null, '', 'null', '{}', JSON.stringify(c.defaultState())]) assert.equal(c.storageProblem(ok), null, String(ok));
  assert.equal(c.storageProblem(JSON.stringify({ v: c.SCHEMA + 1 })), 'newer');
  assert.equal(c.saveState(mem(), c.defaultState()), true);
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

// ---- Completed workouts: delete, restore, correct ----

const finished = () => {
  const st = c.defaultState();
  const session = c.startSession({ id: 'r', name: 'A', exercises: [{ id: 'e1', name: 'Penkki', sets: 2, reps: '8', weight: '60 kg' }] }, 1000);
  session.exercises[0].sets.forEach((s) => { s.done = true; });
  st.history = [c.summarize(session, 1000 + 3600000), { id: 'old', name: 'Vanha', startedAt: 0, endedAt: 5000, setsDone: 3, setsTotal: 3 }];
  return st;
};

test('deleting and restoring a workout keeps its position and is idempotent', () => {
  const st = finished();
  const id = st.history[0].id;
  const removed = c.deleteHistoryEntry(st, id);
  assert.equal(removed.ok, true);
  assert.deepEqual(st.history.map((h) => h.id), ['old']);
  assert.equal(c.deleteHistoryEntry(st, id).ok, false);
  assert.equal(c.restoreHistoryEntry(st, removed.entry, removed.index).ok, true);
  assert.equal(st.history[0].id, id);
  assert.equal(c.restoreHistoryEntry(st, removed.entry, removed.index).ok, false);
  assert.equal(st.history.length, 2);
});

test('editing a logged set corrects reps, weight and done state and recounts sets', () => {
  const st = finished(), id = st.history[0].id;
  assert.equal(c.editHistorySet(st, id, 0, 1, 'done', false, 777).ok, true);
  assert.equal(st.history[0].setsDone, 1);
  assert.equal(st.history[0].editedAt, 777);
  assert.equal(c.editHistorySet(st, id, 0, 0, 'actualReps', '7').ok, true);
  assert.equal(st.history[0].exercises[0].sets[0].actualReps, '7');
  assert.equal(c.editHistorySet(st, id, 0, 0, 'actualWeight', '62,5').ok, true);
  assert.equal(st.history[0].exercises[0].sets[0].actualWeight, '62,5');
  assert.equal(c.editHistorySet(st, id, 0, 0, 'actualWeight', '60').ok, true);
  assert.equal('actualWeight' in st.history[0].exercises[0].sets[0], false);
  assert.equal(c.editHistorySet(st, id, 0, 0, 'actualReps', '').ok, true);
  assert.equal('actualReps' in st.history[0].exercises[0].sets[0], false);
});

test('invalid history edits are rejected and change nothing', () => {
  const st = finished(), id = st.history[0].id, before = JSON.stringify(st);
  for (const [field, value] of [['actualReps', '10000'], ['actualReps', '-1'], ['actualReps', '5x'], ['actualWeight', '105 lbs'], ['actualWeight', '-5'], ['actualWeight', '1e3'], ['nope', '1']]) {
    assert.equal(c.editHistorySet(st, id, 0, 0, field, value).ok, false, `${field} ${value}`);
  }
  assert.equal(c.editHistorySet(st, id, 5, 0, 'done', true).ok, false);
  assert.equal(c.editHistorySet(st, 'missing', 0, 0, 'done', true).ok, false);
  assert.equal(JSON.stringify(st), before);
});

test('legacy summary-only workouts can be deleted but their sets cannot be edited', () => {
  const st = finished();
  assert.equal(c.editHistorySet(st, 'old', 0, 0, 'done', true).ok, false);
  assert.equal(c.shortenHistoryDuration(st, 'old', '1').ok, false);
  assert.equal(c.deleteHistoryEntry(st, 'old').ok, true);
});

test('a workout duration can only be shortened', () => {
  const st = finished(), id = st.history[0].id;
  assert.equal(c.shortenHistoryDuration(st, id, '90').ok, false);
  assert.equal(c.shortenHistoryDuration(st, id, '60').ok, false);
  assert.equal(c.shortenHistoryDuration(st, id, '0').ok, false);
  assert.equal(c.shortenHistoryDuration(st, id, '45,5').ok, false);
  assert.equal(c.shortenHistoryDuration(st, id, '45', 888).ok, true);
  assert.equal(st.history[0].endedAt - st.history[0].startedAt, 45 * 60000);
  assert.equal(st.history[0].editedAt, 888);
});

test('editedAt survives normalization and is dropped when invalid', () => {
  const st = finished(), id = st.history[0].id;
  c.editHistorySet(st, id, 0, 0, 'actualReps', '9', 4242);
  assert.equal(c.parseBackup(JSON.stringify(c.buildBackup(st))).state.history[0].editedAt, 4242);
  const bad = c.buildBackup(finished());
  bad.data.history[0].editedAt = 'x';
  assert.equal('editedAt' in c.parseBackup(JSON.stringify(bad)).state.history[0], false);
});

// ---- Functional training ("Toiminnallinen treeni") ----

const fran = () => ({
  id: 'w1', name: 'Fran', template: 'fran', format: 'fortime', scheme: '21-15-9', minutes: 10, score: 'time',
  movements: [
    { id: 'm1', name: 'Kyykkypunnerrus tangolla', load: '43/29 kg', scaled: { load: '30/20 kg' }, sourceId: 'lib-kyykkypunnerrus-tangolla' },
    { id: 'm2', name: 'Leuanveto myötäotteella', scaled: { name: 'Leuanveto kuminauhalla' }, sourceId: 'lib-leuanveto-myotaotteella' },
  ],
});
const functional = (extra = {}) => ({
  id: 'f', name: 'Perjantai-WOD', type: 'functional',
  warmup: { text: '3 kierrosta:\n10 kyykkyä\n200 m juoksu', minutes: 10 },
  exercises: [{ id: 'e1', name: 'Takakyykky', sets: 5, reps: '5', weight: '80 kg' }],
  wods: [fran()],
  cooldown: { text: 'Venyttely', minutes: 5 },
  ...extra,
});

test('gym programs, workouts and history keep exactly their earlier shape', () => {
  const r = c.sanitizeRoutine(routine());
  assert.deepEqual(Object.keys(r), ['id', 'name', 'exercises', 'autoProgress']);
  const s = c.startSession(r, 1000);
  assert.deepEqual(Object.keys(s), ['id', 'routineId', 'name', 'startedAt', 'exercises']);
  assert.deepEqual(c.sanitizeSession(s), s);
  s.exercises[0].sets[0].done = true;
  assert.deepEqual(c.progress(s), { done: 1, total: 5, wodsDone: 0, wodsTotal: 0, pct: 20 });
  assert.deepEqual(Object.keys(c.summarize(s, 2000)), ['id', 'name', 'startedAt', 'endedAt', 'setsDone', 'setsTotal', 'routineId', 'exercises']);
  assert.equal(c.sessionHasWork(s), true);
  assert.equal(c.sessionHasWork(c.startSession(r, 1000)), false);
  assert.deepEqual(c.validateRoutine({ name: 'X', exercises: [] }), ['Lisää vähintään yksi nimetty liike.']);
  assert.deepEqual(c.validateRoutine({ name: 'X', exercises: [{ name: '', sets: 1, reps: '5' }] }), ['Liike 1: lisää nimi.']);
});

test('a functional program keeps its warm-up, WOD parts and cool-down, and may have only WODs', () => {
  const r = c.sanitizeRoutine(functional());
  assert.equal(r.type, 'functional');
  assert.deepEqual(r.warmup, { text: '3 kierrosta:\n10 kyykkyä\n200 m juoksu', minutes: 10 });
  assert.deepEqual(r.cooldown, { text: 'Venyttely', minutes: 5 });
  assert.deepEqual([r.wods.length, r.wods[0].scheme, r.wods[0].rounds], [1, '21-15-9', 3]);
  assert.deepEqual(c.sanitizeRoutine(r), r, 'sanitizing is stable');
  assert.deepEqual(c.validateRoutine(r), []);
  const wodOnly = c.sanitizeRoutine(functional({ id: 'g', exercises: [], warmup: null, cooldown: { text: ' ', minutes: 0 } }));
  assert.deepEqual(wodOnly.exercises, []);
  assert.equal('warmup' in wodOnly, false);
  assert.equal('cooldown' in wodOnly, false);
  assert.deepEqual(c.validateRoutine(wodOnly), []);
  const st = c.sanitizeState({ routines: [r, wodOnly] });
  assert.deepEqual(st.routines, [r, wodOnly]);
});

test('functional validation needs a WOD part and names each part as the editor shows it', () => {
  assert.deepEqual(c.validateRoutine(functional({ wods: [] })), ['Lisää vähintään yksi WOD-osa.']);
  assert.deepEqual(c.validateRoutine(functional({ exercises: [{ name: '', sets: 0, reps: '' }] })), [
    'Voima / taito, liike 1: lisää nimi.',
    'Voima / taito, liike 1: sarjojen määrän on oltava kokonaisluku 1–20.',
    'Voima / taito, liike 1: lisää toistotavoite tai kesto.',
  ]);
  assert.deepEqual(c.validateRoutine(functional({
    warmup: { text: 'x', minutes: 61 },
    wods: [fran(), { format: 'amrap', minutes: 12, movements: [] }],
    cooldown: { minutes: 'abc' },
  })), ['Lämmittely: keston on oltava 0–60 minuuttia.', 'WOD 2: lisää vähintään yksi liike.', 'Loppuverryttely: keston on oltava 0–60 minuuttia.']);
  assert.deepEqual(c.validateRoutine(functional({ wods: [{ ...fran(), scheme: '21-x' }] })), ['WOD: kirjoita toistokaava muodossa 21-15-9 (2–20 lukua, kukin 1–999).']);
  assert.ok(c.validateRoutine(functional({ wods: [fran(), fran(), fran(), fran()] })).includes('WOD-osia voi olla enintään 3.'));
});

test('a functional workout starts with every part; Kevennetty and Super never change the WOD', () => {
  const r = c.sanitizeRoutine(functional());
  const s = c.startSession(r, 1000);
  assert.equal(s.type, 'functional');
  assert.deepEqual(s.warmup, { ...r.warmup, done: false });
  assert.deepEqual(s.cooldown, { ...r.cooldown, done: false });
  assert.equal(s.exercises.length, 1);
  const { key, division, ...plan } = s.wods[0];
  assert.deepEqual(plan, r.wods[0]);
  assert.equal(key, w.wodKey(r.wods[0]));
  assert.equal(division, 'rx');
  assert.deepEqual(c.sanitizeSession(s), s, 'a started workout is already clean');
  s.wods[0].movements[0].name = 'Muutettu';
  assert.equal(r.wods[0].movements[0].name, 'Kyykkypunnerrus tangolla', 'the workout does not share objects with the program');
  const light = c.startSession(r, 1000, { mode: 'light' });
  assert.equal(light.fatigued, true);
  assert.equal(light.wods[0].division, 'scaled');
  assert.deepEqual(light.wods[0].movements, r.wods[0].movements);
  assert.equal(light.exercises[0].reps, '4');
  const boosted = c.startSession(r, 1000, { mode: 'super' });
  assert.equal(boosted.exercises[0].sets.length, 6);
  assert.deepEqual(boosted.wods[0].movements, r.wods[0].movements);
  assert.equal(boosted.wods[0].division, 'rx');
});

test('each WOD part starts in the division of its previous result', () => {
  const r = c.sanitizeRoutine(functional());
  const key = w.wodKey(r.wods[0]);
  const history = [
    { id: 'h2', endedAt: 9000, wods: [{ key: 'other', result: { kind: 'time', seconds: 200, division: 'rx' } }] },
    { id: 'h1', endedAt: 5000, wods: [{ key, result: { kind: 'time', seconds: 300, division: 'scaled' } }] },
  ];
  assert.equal(c.startSession(r, 10000, { history }).wods[0].division, 'scaled');
  history.unshift({ id: 'h3', endedAt: 9500, wods: [{ key, result: { kind: 'time', seconds: 280, division: 'rx' } }] });
  assert.equal(c.startSession(r, 10000, { history }).wods[0].division, 'rx');
  assert.equal(c.startSession(r, 10000, { history, mode: 'light' }).wods[0].division, 'scaled');
});

test('a WOD-only workout is saved with its result and survives reload, backup and merge', () => {
  const r = c.sanitizeRoutine(functional({ exercises: [] }));
  const s = c.startSession(r, 1000);
  assert.deepEqual(s.exercises, []);
  assert.deepEqual(c.progress(s), { done: 0, total: 0, wodsDone: 0, wodsTotal: 1, pct: 0 });
  assert.equal(c.sessionHasWork(s), false);
  s.wods[0].result = { kind: 'time', seconds: 245, division: 'rx', rpe: 9 };
  assert.deepEqual(c.progress(s), { done: 0, total: 0, wodsDone: 1, wodsTotal: 1, pct: 100 });
  assert.equal(c.sessionHasWork(s), true);
  const st = c.defaultState();
  st.routines = [r];
  st.session = s;
  const store = mem();
  assert.equal(c.saveState(store, st), true);
  const reloaded = c.loadState(store);
  assert.deepEqual(reloaded.session, s, 'a running WOD-only workout survives a reload');
  const h = c.summarize(reloaded.session, 1000 + 20 * 60000);
  assert.equal('exercises' in h, false);
  assert.equal(h.type, 'functional');
  assert.deepEqual([h.setsDone, h.setsTotal], [0, 0]);
  assert.deepEqual(h.wods, [{
    id: 'w1', key: s.wods[0].key, name: 'Fran', format: 'fortime', score: 'time',
    board: w.boardText(s.wods[0], 'rx'), result: { kind: 'time', seconds: 245, division: 'rx', rpe: 9 },
  }]);
  reloaded.history = [h];
  reloaded.session = null;
  assert.deepEqual(c.sanitizeState(reloaded).history, [h], 'history normalization keeps the WOD parts');
  const back = c.parseBackup(JSON.stringify(c.buildBackup(reloaded)));
  assert.equal(back.ok, true);
  assert.deepEqual(back.state.history, [h]);
  assert.deepEqual(back.state.routines, [r]);
  const local = c.defaultState();
  local.routines = [c.sanitizeRoutine({ ...r, wods: [{ ...r.wods[0], minutes: 12 }] })];
  const merged = c.mergeState(local, back.state);
  assert.deepEqual(merged.result, { routines: 1, history: 1, skipped: 0, session: false });
  const copy = merged.state.routines.find((x) => x.name === 'Perjantai-WOD (tuotu)');
  assert.deepEqual({ ...copy, id: r.id, name: r.name }, r, 'the imported copy keeps its type and WOD parts');
  assert.equal(merged.state.history[0].routineId, copy.id);
  assert.deepEqual(c.mergeState(merged.state, back.state).result, { routines: 0, history: 0, skipped: 0, session: false });
});

test('the last exercise of a workout with WOD parts can be removed', () => {
  const s = c.startSession(c.sanitizeRoutine(functional()), 1000);
  assert.equal(c.removeSessionExercise(s, 'e1').ok, true);
  assert.deepEqual(s.exercises, []);
  assert.deepEqual(c.sanitizeSession(s), s);
  assert.equal(c.removeSessionExercise(s, 'e1').ok, false);
});

test('a WOD result in history can be corrected or cleared, never with another score type', () => {
  const st = c.defaultState();
  st.history = [c.summarize(c.startSession(c.sanitizeRoutine(functional({ exercises: [] })), 1000), 2000)];
  const id = st.history[0].id;
  assert.equal('result' in st.history[0].wods[0], false, 'a WOD without a result is kept so it can be filled in later');
  assert.equal(c.editHistoryWod(st, id, 0, { kind: 'time', seconds: 300, division: 'scaled' }, 777).ok, true);
  assert.deepEqual(st.history[0].wods[0].result, { kind: 'time', seconds: 300, division: 'scaled' });
  assert.equal(st.history[0].editedAt, 777);
  const before = JSON.stringify(st);
  assert.equal(c.editHistoryWod(st, id, 0, { kind: 'reps', value: 50 }).ok, false);
  assert.equal(c.editHistoryWod(st, id, 0, { kind: 'time', seconds: 0 }).ok, false);
  assert.equal(c.editHistoryWod(st, id, 1, null).ok, false);
  assert.equal(c.editHistoryWod(st, 'missing', 0, null).ok, false);
  assert.equal(c.editHistorySet(st, id, 0, 0, 'done', true).ok, false, 'there are no sets to edit');
  assert.equal(JSON.stringify(st), before);
  assert.equal(c.editHistoryWod(st, id, 0, null, 888).ok, true);
  assert.equal('result' in st.history[0].wods[0], false);
  assert.equal(st.history[0].editedAt, 888);
  assert.equal(c.parseBackup(JSON.stringify(c.buildBackup(st))).state.history[0].wods.length, 1);
});

test('progression review ignores WOD parts: WOD-only workouts are not reviewed and WODs are kept', () => {
  const st = c.defaultState();
  const wodOnly = c.sanitizeRoutine(functional({ exercises: [], autoProgress: true }));
  st.routines = [wodOnly];
  const s = c.startSession(wodOnly, 1000);
  s.wods[0].result = { kind: 'time', seconds: 245, division: 'rx' };
  st.history = [c.summarize(s, 2000)];
  const before = JSON.stringify(st.routines);
  assert.equal(reviseRoutine(st, 'f', 3000).ok, false);
  assert.equal(JSON.stringify(st.routines), before);
  const mixed = c.sanitizeRoutine(functional({ id: 'g', autoProgress: true }));
  st.routines = [mixed];
  const s2 = c.startSession(mixed, 1000);
  s2.exercises[0].sets.forEach((set) => { set.done = true; set.actualReps = '5'; });
  s2.exercises[0].rir = '3';
  st.history = [c.summarize(s2, 2000)];
  assert.equal(reviseRoutine(st, 'g', 3000).ok, true);
  assert.deepEqual(st.routines[0].wods, mixed.wods);
  assert.equal(st.routines[0].type, 'functional');
  assert.deepEqual(c.sanitizeRoutine(st.routines[0]), st.routines[0]);
});

test('hostile functional data is cleaned without losing the valid parts', () => {
  const st = c.sanitizeState({
    routines: [{ id: 'x', name: 'X', type: 'evil', wods: 'nope', warmup: 5, cooldown: { text: 7 }, exercises: [{ name: 'Curl' }] }],
    session: { id: 's', name: 'S', exercises: 'x', warmup: { text: 'a', minutes: 99, done: 'yes' },
      wods: [{ format: 'amrap', minutes: 999, movements: [{ name: 'Burpee' }, { name: '' }], result: { kind: 'roundsReps', rounds: 5, reps: 3 } }] },
    history: [{ id: 'h', name: 'H', startedAt: 1, endedAt: 2, type: 'x', wods: [{ name: 'no key' }, { key: 'k1', format: 'amrap', score: 'roundsReps', result: { kind: 'roundsReps', rounds: -1, reps: 0 } }] }],
  });
  assert.deepEqual(Object.keys(st.routines[0]), ['id', 'name', 'exercises', 'autoProgress']);
  assert.deepEqual(st.session.exercises, []);
  assert.deepEqual(st.session.warmup, { text: 'a', minutes: 60, done: false });
  assert.deepEqual([st.session.wods[0].minutes, st.session.wods[0].movements.length], [180, 1]);
  assert.deepEqual(st.session.wods[0].result, { kind: 'roundsReps', rounds: 5, reps: 3, division: 'rx' });
  assert.equal('type' in st.history[0], false);
  assert.deepEqual(st.history[0].wods.map((x) => [x.key, 'result' in x]), [['k1', false]]);
  assert.equal(c.sanitizeSession({ id: 's', exercises: [], wods: [] }), null, 'a workout needs exercises or WOD parts');
});
