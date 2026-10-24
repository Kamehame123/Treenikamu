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

test('functional training movements are findable by their usual English names', () => {
  const find = (query) => findExercises(query).map((e) => e.name);
  for (const [query, name] of [
    ['toes to bar', 'Varpaat tankoon'], ['t2b', 'Varpaat tankoon'], ['double under', 'Tuplahyppy narulla'], ['c2b', 'Rintatankoon leuanveto'],
    ['ring muscle up', 'Lihasylösnousu renkailla'], ['bar muscle up', 'Lihasylösnousu tangolla'], ['wall walk', 'Seinäkävely'], ['handstand walk', 'Käsilläkävely'],
    ['l-sit', 'L-istunta'], ['ghd', 'GHD-istumaannousu'], ['rope climb', 'Köysikiipeily'], ['ring dip', 'Rengasdippi'], ['clean and jerk', 'Rinnalleveto ja työntö'],
    ['split jerk', 'Saksaustyöntö'], ['push jerk', 'Työntö ilman saksausta'], ['sdhp', 'Sumoveto leukaan'], ['dumbbell snatch', 'Tempaus käsipainolla'],
    ['dumbbell thruster', 'Kyykkypunnerrus käsipainoilla'], ['devil press', 'Devil press'], ['burpee box jump over', 'Yleisliike laatikon yli'],
    ['bar facing burpee', 'Yleisliike tangon yli'], ['shuttle run', 'Sukkulajuoksu'], ['air squat', 'Kehonpainokyykky'], ['abmat', 'Istumaannousu'],
    ['echo bike', 'Ilmavastuspyörä'], ['ring row', 'Käänteinen soutu'], ['russian swing', 'Kahvakuulaheilautus'],
  ]) assert.ok(find(query).includes(name), `${query} -> ${name}`);
});

test('library additions keep existing ids and defaults; explicit defaults fix holds and skills', () => {
  const byId = new Map(EXERCISES.map((e) => [e.id, e]));
  for (const [id, name, reps] of [['lib-kasillaseisontapunnerrus-seinaa-vasten', 'Käsilläseisontapunnerrus seinää vasten', '8'],
    ['lib-kehonpainokyykky', 'Kehonpainokyykky', '8'], ['lib-istumaannousu', 'Istumaannousu', '12'], ['lib-kahvakuulaheilautus', 'Kahvakuulaheilautus', '8'],
    ['lib-tyonto', 'Työntö', '5'], ['lib-hyppynaru', 'Hyppynaru', '5 min'], ['lib-leuanveto-myotaotteella', 'Leuanveto myötäotteella', '8']]) {
    assert.deepEqual([byId.get(id)?.name, byId.get(id)?.reps], [name, reps], id);
  }
  const reps = (id) => byId.get(id).reps;
  assert.deepEqual(['lib-kasillaseisonta-seinaa-vasten', 'lib-l-istunta', 'lib-seinakavely', 'lib-koysikiipeily', 'lib-lihasylosnousu-renkailla'].map(reps), ['30 s', '20 s', '5', '3', '3']);
  for (const e of EXERCISES) assert.equal(e.id, `lib-${normalizeSearch(e.name).replace(/ /g, '-')}`, e.name);
});