import test from 'node:test';
import assert from 'node:assert/strict';
import * as t from '../wod-templates.js';
import * as w from '../wod.js';
import * as c from '../core.js';
import { EXERCISES } from '../exercises.js';

const LIBRARY = new Map(EXERCISES.map((e) => [e.id, e]));
const SEXES = Object.keys(t.SEXES);
const PARAMS = ['rounds', 'scheme', 'minutes', 'every', 'alternate', 'ascending', 'work', 'rest', 'score'];

test('every template builds a valid functional program for both load standards', () => {
  for (const template of t.TEMPLATES) {
    for (const sex of SEXES) {
      const label = `${template.id} ${sex}`;
      const raw = t.templateRoutine(template, sex);
      assert.deepEqual(c.validateRoutine(raw), [], label);
      const clean = c.sanitizeRoutine(raw);
      assert.deepEqual(c.sanitizeRoutine(clean), clean, `${label}: sanitizing is stable`);
      assert.equal(clean.type, 'functional', label);
      assert.deepEqual(clean.warmup, raw.warmup, `${label}: warm-up kept whole`);
      assert.deepEqual(clean.cooldown, raw.cooldown, `${label}: cool-down kept whole`);
      assert.equal(clean.exercises.length, raw.exercises.length, label);
      const [wod] = raw.wods, [kept] = clean.wods;
      for (const key of PARAMS.filter((k) => Object.hasOwn(wod, k))) assert.equal(kept[key], wod[key], `${label}: ${key}`);
      if (wod.scheme) assert.equal(kept.rounds, w.parseScheme(wod.scheme).length, `${label}: a ladder sets the rounds`);
      for (const key of ['name', 'template', 'format', 'stimulus', 'notes']) assert.equal(kept[key], wod[key], `${label}: ${key} kept whole`);
      assert.equal(kept.movements.length, wod.movements.length, label);
      wod.movements.forEach((m, i) => {
        const { id, ...rest } = kept.movements[i];
        assert.deepEqual(rest, m, `${label}: movement ${i + 1} kept whole`);
        assert.equal(m.name, LIBRARY.get(m.sourceId)?.name, `${label}: movement ${i + 1} comes from the library`);
        if (m.scaled) assert.ok(m.scaled.name || m.scaled.amount || m.scaled.load, `${label}: movement ${i + 1} has a scaled version`);
      });
      assert.ok(w.boardText(kept).length < 1000 && w.boardText(kept, 'scaled').length < 1000, label);
      const session = c.startSession(clean, 1000);
      assert.equal(session.wods.length, 1, label);
      assert.deepEqual(c.sanitizeSession(session), session, `${label}: starts as a clean workout`);
    }
  }
});

test('templates are unique, grouped and listed in gallery order', () => {
  const ids = t.TEMPLATES.map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => id.length <= 40 && /^[a-z0-9-]+$/.test(id)));
  assert.ok(t.TEMPLATES.every((x) => Object.hasOwn(t.TEMPLATE_GROUPS, x.group)));
  const benchmarks = t.TEMPLATES.filter((x) => x.group === 'benchmark').map((x) => x.name);
  assert.deepEqual(benchmarks, [...benchmarks].sort((a, b) => a.localeCompare(b, 'fi-FI')));
  assert.deepEqual([...benchmarks].sort(), ['Annie', 'Cindy', 'DT', 'Diane', 'Elizabeth', 'Fran', 'Grace', 'Helen', 'Isabel', 'Jackie', 'Karen', 'Murph']);
  const formats = t.TEMPLATES.filter((x) => x.group === 'format');
  assert.equal(formats[0].id, 'tunti', 'the whole class comes first');
  assert.deepEqual(new Set(formats.map((x) => x.wod.format)), new Set(w.WOD_FORMATS), 'every format has an example');
  assert.equal(t.templateById('fran').name, 'Fran');
  assert.equal(t.templateById('nope'), null);
});

test('benchmark loads follow the women and men standards and give each its own WOD key', () => {
  const rx = { fran: [29, 43], grace: [43, 61], isabel: [43, 61], elizabeth: [43, 61], diane: [70, 102], dt: [47, 70], helen: [16, 24], karen: [6, 9], jackie: [15, 20] };
  for (const [id, [women, men]] of Object.entries(rx)) {
    const loads = (sex) => t.templateWod(t.templateById(id), sex).movements.map((m) => m.load).filter(Boolean);
    assert.ok(loads('women').length && loads('women').every((l) => l.startsWith(`${women} kg`)), `${id} women`);
    assert.ok(loads('men').length && loads('men').every((l) => l.startsWith(`${men} kg`)), `${id} men`);
  }
  const fran = t.templateById('fran');
  const women = t.templateWod(fran, 'women'), men = t.templateWod(fran, 'men');
  assert.deepEqual([women.name, women.template], ['Fran', 'fran']);
  assert.notEqual(w.wodKey(women), w.wodKey(men));
  assert.equal(w.wodKey(women), w.wodKey(t.templateWod(fran, 'women')), 'the same template always gives the same key');
  assert.equal(w.boardText(w.sanitizeWod(women), 'scaled'), '21-15-9 aikaa vastaan · aikaraja 10 min\nKyykkypunnerrus tangolla (20 kg)\nAvustettu leuanveto');
  assert.match(t.templateWod(t.templateById('murph'), 'men').notes, /9 kg painoliivi/);
  assert.match(t.templateWod(t.templateById('murph'), 'women').notes, /6 kg painoliivi/);
  assert.equal(t.templateWod(t.templateById('amrap-12'), 'women').name, '', 'a format template takes its title from the format');
});

test('Murph scales to a half Murph and Annie to single jumps', () => {
  const murph = w.sanitizeWod(t.templateWod(t.templateById('murph'), 'men'));
  assert.deepEqual(w.boardLines(murph, 'scaled').slice(1), ['800 m Juoksu', '50 Käänteinen soutu', '100 Etunojapunnerrus polvilta', '150 Kehonpainokyykky', '800 m Juoksu']);
  assert.equal(w.wodMinutes(murph), null, 'Murph has no time cap');
  const annie = w.sanitizeWod(t.templateWod(t.templateById('annie'), 'women'));
  assert.equal(w.repsForRound(annie, annie.movements[0], 1), '50');
  assert.equal(w.movementLine(annie.movements[0], 'scaled', '50'), '50 Hyppynaru, kaksinkertainen määrä');
});

test('the whole class has warm-up, strength, WOD and cool-down within an hour', () => {
  const routine = c.sanitizeRoutine(t.templateRoutine(t.templateById('tunti'), 'men'));
  assert.deepEqual(routine.exercises.map((e) => [e.name, e.sets, e.reps, e.tracking?.sourceId]), [['Takakyykky', 5, '5', 'lib-takakyykky']]);
  assert.equal(routine.wods[0].format, 'amrap');
  assert.deepEqual(w.modalities(routine.wods[0]), ['G', 'W', 'M']);
  const minutes = routine.warmup.minutes + 20 + w.wodMinutes(routine.wods[0]) + routine.cooldown.minutes;
  assert.ok(minutes <= 60, `${minutes} min`);
});
