import test from 'node:test';
import assert from 'node:assert/strict';
import { EXERCISES, CATEGORIES, EQUIPMENT, findExercises, normalizeSearch } from '../exercises.js';
import * as core from '../core.js';

test('large curated catalogue has unique names/ids, valid tags and bounded targets', () => {
  assert.ok(EXERCISES.length >= 300, `only ${EXERCISES.length} exercises`);
  assert.equal(new Set(EXERCISES.map((e) => e.id)).size, EXERCISES.length);
  assert.equal(new Set(EXERCISES.map((e) => e.name)).size, EXERCISES.length);
  for (const e of EXERCISES) {
    assert.ok(e.name.length <= 60, e.name); assert.ok(e.reps.length <= 20);
    assert.ok(CATEGORIES.includes(e.category)); assert.ok(EQUIPMENT.includes(e.equipment));
  }
});
test('search supports Finnish accents, English aliases, word order and combined filters', () => {
  assert.equal(normalizeSearch('YLÄTALJA'), 'ylatalja');
  assert.ok(findExercises('ylatalja').some((e) => e.name === 'Ylätalja leveällä otteella'));
  assert.ok(findExercises('bench press').some((e) => e.name === 'Penkkipunnerrus'));
  const rows = findExercises('käsipaino', { category: 'Rinta', equipment: 'Käsipainot' });
  assert.ok(rows.length >= 5); assert.ok(rows.every((e) => e.category === 'Rinta' && e.equipment === 'Käsipainot'));
  assert.deepEqual(findExercises('ei-tällaista-liikettä-xyz'), []);
});
test('custom library records survive persistence and legacy state defaults safely', () => {
  const old = { v: 1, routines: [{ id: 'old', name: 'My unchanged workout', exercises: [{ id: 'e', name: 'My squat', sets: 4, reps: '6', weight: '77 kg' }] }] };
  const migrated = core.sanitizeState(old);
  assert.deepEqual(migrated.customExercises, []);
  assert.equal(migrated.routines[0].name, 'My unchanged workout');
  assert.equal(migrated.routines[0].exercises[0].weight, '77 kg');
  const record = { id: 'own-1', name: 'Oma ääkkösliike', category: 'Selkä', equipment: 'Talja', reps: '12' };
  const state = core.sanitizeState({ ...migrated, customExercises: [record, record, null, { name: ' ' }] });
  assert.equal(state.customExercises.length, 1);
  assert.equal(state.customExercises[0].name, record.name);
  assert.ok(findExercises('aakkosliike', { custom: state.customExercises, customOnly: true })[0].custom);
  assert.equal(core.sanitizeState(state).customExercises.length, 1);
});
test('Finnish defaults, validation and timed targets are localized', () => {
  assert.equal(core.defaultState().routines[0].name, 'Koko keho A');
  assert.equal(core.targetLabel('8–12'), '8–12 toistoa');
  assert.equal(core.targetLabel('30 s'), '30 s');
  assert.equal(core.targetLabel('2 minuuttia'), '2 minuuttia');
  assert.match(core.validateRoutine({ name: '', exercises: [] }).join(' '), /harjoitukselle nimi/);
});

test('custom records round-trip through backup import and restore', () => {
  const state = core.defaultState();
  state.customExercises = [{ id: 'own-a', name: 'Oma liike ä', category: 'Selkä', equipment: 'Talja', reps: '8–12' }];
  const parsed = core.parseBackup(JSON.stringify(core.buildBackup(state)));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.state.customExercises, state.customExercises);
  assert.deepEqual(core.replaceState(core.defaultState(), parsed.state).state.customExercises, state.customExercises);
});
test('custom import deduplicates names and respects the durable library cap', () => {
  const local = core.defaultState(), incoming = core.defaultState();
  local.customExercises = Array.from({ length: core.MAX_CUSTOM_EXERCISES }, (_, i) => ({ id: `own-${i}`, name: `Oma ${i}`, category: 'Selkä', equipment: 'Talja', reps: '10' }));
  incoming.customExercises = [{ ...local.customExercises[0], id: 'different-id' }, { id: 'extra', name: 'Ylimääräinen', category: 'Selkä', equipment: 'Talja', reps: '10' }];
  const merged = core.mergeState(local, incoming).state;
  assert.equal(merged.customExercises.length, core.MAX_CUSTOM_EXERCISES);
  assert.deepEqual(core.sanitizeState(merged).customExercises, merged.customExercises);
});