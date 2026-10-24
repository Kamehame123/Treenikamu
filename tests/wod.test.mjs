import test from 'node:test';
import assert from 'node:assert/strict';
import * as w from '../wod.js';

const fran = () => ({
  id: 'w1', name: 'Fran', format: 'fortime', scheme: '21-15-9', minutes: 10, score: 'time',
  stimulus: 'Nopea ja kova', notes: 'Skaalaa niin, että aika on alle 10 min.',
  movements: [
    { id: 'm1', name: 'Kyykkypunnerrus tangolla', amount: '', load: '43 kg', scaled: { load: '30 kg' }, sourceId: 'lib-kyykkypunnerrus-tangolla' },
    { id: 'm2', name: 'Leuanveto', amount: '', load: '', scaled: { name: 'Käänteinen soutu' } },
  ],
});
const T0 = 1_700_000_000_000;
const at = (ms) => T0 + w.PREROLL_MS + ms;

test('sanitizeWod keeps only the parameters of its format and clamps them', () => {
  const amrap = w.sanitizeWod({ format: 'amrap', minutes: 999, scheme: '21-15-9', every: 60, work: 20, score: 'kg', movements: [{ name: 'Yleisliike', amount: '10' }], junk: 1 });
  assert.equal(amrap.minutes, 180);
  assert.equal(amrap.score, 'roundsReps', 'a score that the format does not allow falls back to its default');
  for (const key of ['scheme', 'every', 'work', 'rest', 'rounds', 'alternate', 'ascending', 'junk']) assert.equal(key in amrap, false, key);
  const emom = w.sanitizeWod({ format: 'emom', every: 5, rounds: '12', alternate: true, ascending: 'yes', minutes: 4 });
  assert.deepEqual([emom.every, emom.rounds, emom.alternate, 'ascending' in emom, 'minutes' in emom], [10, 12, true, false, false]);
  const intervals = w.sanitizeWod({ format: 'intervals', work: 1, rest: -5, rounds: 0 });
  assert.deepEqual([intervals.work, intervals.rest, intervals.rounds, intervals.score], [5, 0, 1, 'reps']);
  const unknown = w.sanitizeWod({ format: 'chipper', rounds: 'x' });
  assert.deepEqual([unknown.format, unknown.rounds, unknown.minutes, unknown.score], ['fortime', 1, 0, 'time']);
  assert.ok(unknown.id, 'a missing id is generated');
});

test('sanitizeWod normalizes a rep ladder and makes it the round count', () => {
  const wod = w.sanitizeWod({ format: 'fortime', scheme: ' 21 – 15 / 9 ', rounds: 7 });
  assert.equal(wod.scheme, '21-15-9');
  assert.equal(wod.rounds, 3);
  assert.equal('scheme' in w.sanitizeWod({ format: 'fortime', scheme: 'abc', rounds: 5 }), false);
  assert.equal(w.sanitizeWod({ format: 'fortime', scheme: 'abc', rounds: 5 }).rounds, 5);
  assert.deepEqual(w.parseScheme('50-40-30-20-10'), [50, 40, 30, 20, 10]);
  assert.deepEqual(w.parseScheme(''), []);
  for (const bad of ['21', '21-0-9', '1000-1', '21-15-9-'.repeat(8), '21-x']) assert.equal(w.parseScheme(bad), null, bad);
});

test('movements: blanks are dropped, limits apply, ids stay unique and scaled versions are optional', () => {
  const wod = w.sanitizeWod({
    format: 'amrap', minutes: 12,
    movements: [{ id: 'a', name: '  Yleisliike  ', amount: '10', load: '' }, { id: 'a', name: 'Juoksu', amount: '200 m' },
      { name: '' }, null, { name: 'Laatikkohyppy', scaled: { name: '', amount: '', load: '' } },
      ...Array.from({ length: 30 }, (_, i) => ({ name: `Liike ${i}` }))],
  });
  assert.equal(wod.movements.length, 18, 'at most 20 entries are read, blanks dropped');
  assert.equal(wod.movements[0].name, 'Yleisliike');
  assert.notEqual(wod.movements[0].id, wod.movements[1].id);
  assert.equal('scaled' in wod.movements[2], false);
  assert.equal(w.sanitizeWods(Array.from({ length: 5 }, () => fran())).length, w.MAX_WODS);
});

test('blocks keep line breaks and drop when empty', () => {
  assert.deepEqual(w.sanitizeBlock({ text: '  400 m juoksu \r\n\r\n\r\n10   kyykkyä ', minutes: 99 }), { text: '400 m juoksu\n\n10 kyykkyä', minutes: 60 });
  assert.equal(w.sanitizeBlock({ text: '   ', minutes: 0 }), null);
  assert.deepEqual(w.sanitizeBlock({ text: 'Venyttely', minutes: 5, done: true }, { session: true }), { text: 'Venyttely', minutes: 5, done: true });
});

test('results: each kind keeps its fields and anything unreadable is dropped, not guessed', () => {
  assert.deepEqual(w.sanitizeResult({ kind: 'time', seconds: 272, division: 'rx', rpe: 9, notes: ' hyvä ' }), { kind: 'time', seconds: 272, division: 'rx', notes: 'hyvä', rpe: 9 });
  assert.deepEqual(w.sanitizeResult({ kind: 'time', capped: true, reps: 30, seconds: 600, division: 'scaled' }), { kind: 'time', capped: true, reps: 30, seconds: 600, division: 'scaled' });
  assert.deepEqual(w.sanitizeResult({ kind: 'roundsReps', rounds: '7', reps: 12 }), { kind: 'roundsReps', rounds: 7, reps: 12, division: 'rx' });
  assert.deepEqual(w.sanitizeResult({ kind: 'kg', value: 102.499999 }), { kind: 'kg', value: 102.5, division: 'rx' });
  assert.deepEqual(w.sanitizeResult({ kind: 'none', rpe: 11 }), { kind: 'none', division: 'rx' });
  for (const bad of [null, {}, { kind: 'time' }, { kind: 'time', seconds: 0 }, { kind: 'time', capped: true }, { kind: 'roundsReps', rounds: 1.5, reps: 0 },
    { kind: 'reps', value: -1 }, { kind: 'kg', value: 0 }, { kind: 'cal', value: '12abc' }, { kind: 'points', value: 3 }]) {
    assert.equal(w.sanitizeResult(bad), null, JSON.stringify(bad));
  }
});

test('clock and history snapshots are validated', () => {
  assert.equal(w.sanitizeClock({ startedAt: 'x' }), null);
  assert.equal(w.sanitizeClock({ startedAt: T0, pausedMs: -1 }), null);
  assert.deepEqual(w.sanitizeClock({ startedAt: T0, pausedAt: 'bad', laps: [3000, 'x', -1, 1000], endedAt: T0 + 5 }), { startedAt: T0, pausedAt: null, pausedMs: 0, laps: [1000, 3000], endedAt: T0 + 5 });
  assert.equal(w.sanitizeHistoryWod({ name: 'Fran' }), null, 'a result without its workout key cannot be compared');
  const { id, ...snapshot } = w.sanitizeHistoryWod({ key: 'wabc', format: 'amrap', board: 'AMRAP 12 min\n10 Yleisliike', result: { kind: 'roundsReps', rounds: 5, reps: 0 }, junk: 1 });
  assert.ok(id, 'a missing id is generated');
  assert.deepEqual(snapshot, { key: 'wabc', name: 'AMRAP', format: 'amrap', score: 'roundsReps', board: 'AMRAP 12 min\n10 Yleisliike', result: { kind: 'roundsReps', rounds: 5, reps: 0, division: 'rx' } });
  assert.equal(w.sanitizeHistoryWod({ id: 'h1', key: 'wabc', result: { kind: 'bogus' } }).result, undefined, 'an unreadable result is dropped, the entry kept');
  const ids = w.sanitizeHistoryWods([{ id: 'same', key: 'a' }, { id: 'same', key: 'b' }, { key: '' }, 'x']).map((x) => x.id);
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1]);
});

test('session copies keep key, division, clock and result', () => {
  const wod = w.sanitizeSessionWod({ ...fran(), division: 'scaled', clock: { startedAt: T0, pausedAt: null, pausedMs: 0, laps: [] }, result: { kind: 'time', seconds: 300, division: 'scaled' } });
  assert.equal(wod.key, w.wodKey(fran()));
  assert.equal(wod.division, 'scaled');
  assert.equal(wod.clock.startedAt, T0);
  assert.equal(wod.result.seconds, 300);
  assert.equal(w.sanitizeSessionWod({ ...fran(), key: 'wsaved' }).key, 'wsaved', 'a stored key is never recomputed');
  assert.equal(w.sanitizeSessionWod({ ...fran(), division: 'rx+' }).division, 'rx');
});

test('whiteboard shows the ladder, loads and the scaled version', () => {
  const wod = w.sanitizeWod(fran());
  assert.deepEqual(w.boardLines(wod), ['21-15-9 aikaa vastaan · aikaraja 10 min', 'Kyykkypunnerrus tangolla (43 kg)', 'Leuanveto']);
  assert.deepEqual(w.boardLines(wod, 'scaled'), ['21-15-9 aikaa vastaan · aikaraja 10 min', 'Kyykkypunnerrus tangolla (30 kg)', 'Käänteinen soutu']);
  assert.equal(w.boardText(wod), '21-15-9 aikaa vastaan · aikaraja 10 min\nKyykkypunnerrus tangolla (43 kg)\nLeuanveto');
  const swap = w.movementVersion({ name: 'Rengasdippi', amount: '10', load: '10 kg', scaled: { name: 'Dippi' } }, 'scaled');
  assert.deepEqual(swap, { name: 'Dippi', amount: '10', load: '' }, 'a substituted movement does not inherit the Rx load');
  assert.equal(w.wodHeadline(w.sanitizeWod({ format: 'fortime', rounds: 5 })), '5 kierrosta aikaa vastaan');
  assert.equal(w.wodHeadline(w.sanitizeWod({ format: 'fortime' })), 'Aikaa vastaan');
  assert.equal(w.wodHeadline(w.sanitizeWod({ format: 'emom', rounds: 12, alternate: true })), 'EMOM 12 min · vuorotellen');
  assert.equal(w.wodHeadline(w.sanitizeWod({ format: 'emom', every: 120, rounds: 5 })), 'Joka 2 min × 5');
  assert.equal(w.wodHeadline(w.sanitizeWod({ format: 'emom', every: 60, rounds: 30, ascending: true })), 'EMOM 30 min · nousevat toistot');
  assert.equal(w.wodHeadline(w.sanitizeWod({ format: 'intervals', work: 20, rest: 10, rounds: 8 })), '8 × 20 s työ / 10 s lepo');
  assert.equal(w.wodHeadline(w.sanitizeWod({ format: 'intervals', work: 180, rest: 0, rounds: 5 })), '5 × 3 min työ');
  assert.equal(w.wodHeadline(w.sanitizeWod({ format: 'maxload', minutes: 15 })), 'Maksimikuorma · 15 min');
  assert.equal(w.wodTitle(w.sanitizeWod({ format: 'amrap', minutes: 20 })), 'AMRAP 20 min');
});

test('reps per round follow the ladder or climb in a Death By', () => {
  const wod = w.sanitizeWod({ ...fran(), movements: [...fran().movements, { name: 'Juoksu', amount: '400 m' }] });
  assert.deepEqual([1, 2, 3].map((r) => w.repsForRound(wod, wod.movements[0], r)), ['21', '15', '9']);
  assert.equal(w.repsForRound(wod, wod.movements[2], 2), '400 m', 'a fixed amount stays the same every round');
  const deathBy = w.sanitizeWod({ format: 'emom', rounds: 30, ascending: true, score: 'rounds', movements: [{ name: 'Yleisliike' }, { name: 'Kyykky', amount: '2' }] });
  assert.equal(w.repsForRound(deathBy, deathBy.movements[0], 7), '7');
  assert.equal(w.repsForRound(deathBy, deathBy.movements[1], 7), '14');
});

test('planned minutes per format', () => {
  assert.equal(w.wodMinutes(w.sanitizeWod(fran())), 10);
  assert.equal(w.wodMinutes(w.sanitizeWod({ format: 'fortime' })), null);
  assert.equal(w.wodMinutes(w.sanitizeWod({ format: 'emom', every: 90, rounds: 8 })), 12);
  assert.equal(w.wodMinutes(w.sanitizeWod({ format: 'intervals', work: 20, rest: 10, rounds: 8 })), 3.8);
});

test('modalities come from the exercise library', () => {
  const wod = w.sanitizeWod({ format: 'amrap', minutes: 20, movements: [{ name: 'Kyykkypunnerrus tangolla' }, { name: 'yleisliike' }, { name: 'Juoksu' }, { name: 'Oma keksitty liike' }] });
  assert.deepEqual(w.modalities(wod), ['G', 'W', 'M']);
  assert.deepEqual(w.modalities(w.sanitizeWod({ format: 'amrap', movements: [{ name: 'Tuntematon' }] })), []);
});

test('wodKey identifies the work, not the label', () => {
  const key = w.wodKey(fran());
  assert.match(key, /^w[0-9a-z]+$/);
  assert.equal(w.wodKey(fran()), key, 'stable');
  const same = [
    { ...fran(), name: 'Toinen nimi', id: 'other', notes: '', stimulus: 'x', template: 'fran', minutes: 0 },
    { ...fran(), movements: fran().movements.map((m) => ({ ...m, id: `${m.id}-x`, scaled: { name: 'Jotain muuta', load: '1 kg' }, sourceId: '' })) },
    { ...fran(), movements: [{ ...fran().movements[0], name: '  kyykkypunnerrus   TANGOLLA', load: '43kg' }, fran().movements[1]] },
    { ...fran(), scheme: '21 / 15 / 9' },
  ];
  for (const variant of same) assert.equal(w.wodKey(variant), key, JSON.stringify(variant).slice(0, 80));
  const different = [
    { ...fran(), scheme: '15-12-9' },
    { ...fran(), format: 'amrap', minutes: 10 },
    { ...fran(), movements: [{ ...fran().movements[0], load: '40 kg' }, fran().movements[1]] },
    { ...fran(), movements: [{ ...fran().movements[0], amount: '10' }, fran().movements[1]] },
    { ...fran(), movements: [...fran().movements].reverse() },
    { ...fran(), movements: [fran().movements[0]] },
  ];
  for (const variant of different) assert.notEqual(w.wodKey(variant), key, JSON.stringify(variant).slice(0, 80));
  const amrap = { format: 'amrap', minutes: 12, score: 'roundsReps', movements: [{ name: 'Yleisliike', amount: '10' }] };
  assert.notEqual(w.wodKey(amrap), w.wodKey({ ...amrap, minutes: 15 }));
  assert.notEqual(w.wodKey(amrap), w.wodKey({ ...amrap, score: 'reps' }));
  assert.equal(w.wodKey({ format: 'maxload', minutes: 15, movements: [{ name: 'Takakyykky', amount: '1' }] }),
    w.wodKey({ format: 'maxload', minutes: 20, movements: [{ name: 'Takakyykky', amount: '1' }] }), 'the max-load window is logistics, not the test');
});

test('validateWod names the WOD part and the field to fix', () => {
  assert.deepEqual(w.validateWod(fran(), 'WOD 1'), []);
  assert.deepEqual(w.validateWod({ format: 'x' }, 'WOD 1'), ['WOD 1: valitse muoto.']);
  assert.deepEqual(w.validateWod({ format: 'amrap', minutes: '0', movements: [] }, 'WOD 2'), ['WOD 2: keston on oltava 1–180 minuuttia.', 'WOD 2: lisää vähintään yksi liike.']);
  assert.deepEqual(w.validateWod({ format: 'fortime', scheme: '21-15-x', minutes: '', movements: [{ name: 'A' }, { name: ' ' }] }, 'WOD'),
    ['WOD: kirjoita toistokaava muodossa 21-15-9 (2–20 lukua, kukin 1–999).', 'WOD, liike 2: lisää nimi.']);
  assert.deepEqual(w.validateWod({ format: 'fortime', rounds: '0', minutes: '200', movements: [{ name: 'A' }] }, 'WOD'),
    ['WOD: kierroksia on oltava 1–100.', 'WOD: aikaraja on 0–180 minuuttia (0 = ei aikarajaa).']);
  assert.deepEqual(w.validateWod({ format: 'emom', every: '5', rounds: '10', score: 'time', movements: [{ name: 'A' }] }, 'WOD'),
    ['WOD: jakson pituuden on oltava 10–600 sekuntia.', 'WOD: valitse tuloksen tyyppi.']);
  assert.deepEqual(w.validateWod({ format: 'intervals', work: '20', rest: '', rounds: '8', movements: [{ name: 'A' }] }, 'WOD'), ['WOD: lepojakson on oltava 0–600 sekuntia.']);
  assert.deepEqual(w.validateBlock({ minutes: '61' }, 'Lämmittely'), ['Lämmittely: keston on oltava 0–60 minuuttia.']);
  assert.deepEqual(w.validateBlock({ minutes: '' }, 'Lämmittely'), []);
});

test('For Time clock: pre-roll, count-up, rounds, cap and an exact end', () => {
  const wod = w.sanitizeSessionWod(fran());
  w.startClock(wod, T0);
  let face = w.clockFace(wod, wod.clock, T0 + 1000);
  assert.deepEqual([face.phase, face.label, face.time, face.cue, face.sound], ['preroll', 'Valmistaudu', '9', 'pre', null]);
  face = w.clockFace(wod, wod.clock, T0 + 7500);
  assert.deepEqual([face.time, face.cue, face.sound], ['3', 'pre:3', 'tick']);
  face = w.clockFace(wod, wod.clock, at(500));
  assert.deepEqual([face.phase, face.label, face.time, face.cue, face.sound, face.say, face.target, face.detail],
    ['run', 'Nyt!', '0:00', 'run', 'go', 'Nyt!', 'Nyt: 21', 'Kierros 1/3 · aikaraja 10:00']);
  assert.equal(w.addLap(wod, at(95_400)), true);
  face = w.clockFace(wod, wod.clock, at(100_900));
  assert.deepEqual([face.label, face.time, face.round, face.target], ['Aikaa vastaan', '1:40', 2, 'Nyt: 15']);
  assert.equal(w.clockFace(wod, wod.clock, at(597_500)).cue, 'run:3');
  assert.equal(w.settleClock(wod, at(599_000)), false);
  assert.equal(w.settleClock(wod, at(700_000)), true, 'noticed late, ended at the cap');
  assert.equal(wod.clock.endedAt, at(600_000));
  face = w.clockFace(wod, wod.clock, at(900_000));
  assert.deepEqual([face.phase, face.label, face.time, face.sound], ['done', 'Aikaraja', '10:00', 'done']);
  assert.deepEqual(w.resultFields(wod), { min: '', sec: '', capped: true, reps: '', rounds: '', value: '', division: 'rx', notes: '', rpe: '' });
});

test('finishing For Time early gives the time; pauses are excluded', () => {
  const wod = w.sanitizeSessionWod({ ...fran(), minutes: 0 });
  w.startClock(wod, T0);
  assert.equal(w.pauseClock(wod, at(60_000)), true);
  assert.equal(w.pauseClock(wod, at(61_000)), false);
  assert.equal(w.addLap(wod, at(70_000)), false, 'no laps while paused');
  assert.equal(w.clockFace(wod, wod.clock, at(90_000)).time, '1:00');
  assert.equal(w.clockFace(wod, wod.clock, at(90_000)).paused, true);
  assert.equal(w.resumeClock(wod, at(90_000)), true);
  assert.equal(w.clockFace(wod, wod.clock, at(302_400)).time, '4:32');
  assert.equal(w.settleClock(wod, at(9_000_000)), false, 'no cap: runs until the athlete is done');
  assert.equal(w.stopClock(wod, at(302_400)), 'ended');
  assert.equal(w.clockElapsed(wod.clock, at(999_999)), w.PREROLL_MS + 272_400);
  const face = w.clockFace(wod, wod.clock, at(999_999));
  assert.deepEqual([face.phase, face.label, face.time, face.say], ['done', 'Valmis', '4:32', 'Valmis. Aika 4:32.']);
  assert.deepEqual([w.resultFields(wod).min, w.resultFields(wod).sec, w.resultFields(wod).capped], ['4', '32', false]);
  assert.equal(w.stopClock(wod, at(999_999)), 'none');
});

test('stopping during the pre-roll removes the clock; stopping while paused freezes the paused time', () => {
  const wod = w.sanitizeSessionWod(fran());
  w.startClock(wod, T0);
  assert.equal(w.stopClock(wod, T0 + 4000), 'cancelled');
  assert.equal('clock' in wod, false);
  w.startClock(wod, T0);
  w.pauseClock(wod, at(30_000));
  assert.equal(w.stopClock(wod, at(500_000)), 'ended');
  assert.equal(w.clockAt(wod, w.clockElapsed(wod.clock)).workMs, 30_000);
});

test('AMRAP counts down and its laps become rounds', () => {
  const wod = w.sanitizeSessionWod({ format: 'amrap', minutes: 12, movements: [{ name: 'Yleisliike', amount: '10' }] });
  w.startClock(wod, T0);
  assert.equal(w.addLap(wod, T0 + 5000), false, 'no laps during the pre-roll');
  let face = w.clockFace(wod, wod.clock, at(0));
  assert.deepEqual([face.time, face.label, face.detail, face.round], ['12:00', 'Nyt!', 'Kierros 1', 1]);
  for (const ms of [60_000, 120_000, 180_000]) w.addLap(wod, at(ms));
  assert.equal(w.undoLap(wod), true);
  face = w.clockFace(wod, wod.clock, at(200_000));
  assert.deepEqual([face.time, face.label, face.detail], ['8:40', 'AMRAP', 'Kierros 3']);
  assert.equal(w.clockFace(wod, wod.clock, at(717_100)).cue, 'run:3');
  assert.equal(w.clockFace(wod, wod.clock, at(719_500)).cue, 'run:1');
  assert.equal(w.addLap(wod, at(720_000)), false, 'the time is up');
  assert.equal(w.settleClock(wod, at(720_000)), true);
  face = w.clockFace(wod, wod.clock, at(800_000));
  assert.deepEqual([face.label, face.detail, face.time], ['Aika loppui', '2 kierrosta', '12:00']);
  assert.equal(w.resultFields(wod).rounds, '2');
});

test('EMOM: each interval cues once, alternates movements and climbs in Death By', () => {
  const wod = w.sanitizeSessionWod({ format: 'emom', rounds: 12, alternate: true, movements: [{ name: 'Yleisliike', amount: '12' }, { name: 'Kahvakuulaheilautus', amount: '15', load: '24 kg', scaled: { load: '16 kg' } }, { name: 'Hiihtolaite', amount: '12 cal' }] });
  w.startClock(wod, T0);
  let face = w.clockFace(wod, wod.clock, at(0));
  assert.deepEqual([face.label, face.time, face.target, face.cue, face.sound, face.say], ['Minuutti 1/12', '1:00', '12 Yleisliike', 'int:1', 'go', 'Nyt! Minuutti 1/12: 12 Yleisliike.']);
  face = w.clockFace(wod, wod.clock, at(61_000));
  assert.deepEqual([face.label, face.time, face.target, face.detail], ['Minuutti 2/12', '0:59', '15 Kahvakuulaheilautus (24 kg)', 'Kokonaisaikaa jäljellä 10:59']);
  wod.division = 'scaled';
  assert.equal(w.clockFace(wod, wod.clock, at(61_000)).target, '15 Kahvakuulaheilautus (16 kg)');
  assert.equal(w.clockFace(wod, wod.clock, at(150_000)).target, '12 cal Hiihtolaite');
  assert.equal(w.clockFace(wod, wod.clock, at(237_500)).cue, 'int:4:3');
  assert.equal(w.clockFace(wod, wod.clock, at(240_000)).cue, 'int:5');
  const deathBy = w.sanitizeSessionWod({ format: 'emom', every: 60, rounds: 30, ascending: true, score: 'rounds', movements: [{ name: 'Yleisliike' }] });
  w.startClock(deathBy, T0);
  assert.equal(w.clockFace(deathBy, deathBy.clock, at(6 * 60_000 + 5000)).target, '7 Yleisliike');
  assert.equal(w.stopClock(deathBy, at(13 * 60_000 + 40_000)), 'ended');
  assert.equal(w.resultFields(deathBy).value, '13', 'the failed minute is not counted');
  const e2mom = w.sanitizeWod({ format: 'emom', every: 120, rounds: 5, movements: [{ name: 'Rinnalleveto', amount: '3' }] });
  assert.equal(w.clockFace(e2mom, { startedAt: T0, pausedAt: null, pausedMs: 0, laps: [] }, at(130_000)).label, 'Jakso 2/5');
});

test('intervals alternate work and rest and end after the last work interval', () => {
  const wod = w.sanitizeSessionWod({ format: 'intervals', work: 20, rest: 10, rounds: 8, movements: [{ name: 'Kehonpainokyykky' }] });
  w.startClock(wod, T0);
  let face = w.clockFace(wod, wod.clock, at(1000));
  assert.deepEqual([face.label, face.time, face.detail, face.cue, face.sound], ['TYÖ', '0:19', 'Kierros 1/8', 'seg:1:work', 'go']);
  face = w.clockFace(wod, wod.clock, at(20_000));
  assert.deepEqual([face.label, face.time, face.cue, face.sound, face.say], ['LEPO', '0:10', 'seg:1:rest', 'rest', 'Lepo, kierros 1/8.']);
  assert.equal(w.clockFace(wod, wod.clock, at(30_000)).say, 'Työ, kierros 2/8.');
  assert.equal(w.clockFace(wod, wod.clock, at(229_000)).phase, 'run');
  assert.equal(w.clockFace(wod, wod.clock, at(230_000)).phase, 'done', 'the trailing rest is not part of the workout');
});

test('the cue sequence beeps 3-2-1 before each change and exactly once per change', () => {
  const wod = w.sanitizeSessionWod({ format: 'emom', rounds: 2, movements: [{ name: 'Yleisliike', amount: '5' }] });
  w.startClock(wod, T0);
  const sounds = [];
  let last = null;
  for (let t = T0; t <= at(125_000); t += 250) {
    const face = w.clockFace(wod, wod.clock, t);
    if (face.cue !== last) { sounds.push(`${face.cue}=${face.sound}`); last = face.cue; }
  }
  assert.deepEqual(sounds, ['pre=null', 'pre:3=tick', 'pre:2=tick', 'pre:1=tick', 'int:1=go', 'int:1:3=tick', 'int:1:2=tick', 'int:1:1=tick',
    'int:2=go', 'int:2:3=tick', 'int:2:2=tick', 'int:2:1=tick', 'done=done']);
});

test('max load counts down its window', () => {
  const wod = w.sanitizeSessionWod({ format: 'maxload', minutes: 15, movements: [{ name: 'Takakyykky', amount: '1' }] });
  w.startClock(wod, T0);
  const face = w.clockFace(wod, wod.clock, at(5000));
  assert.deepEqual([face.label, face.time, face.round], ['Maksimikuorma', '14:55', 0]);
});

test('formatting and comparing scores', () => {
  assert.equal(w.formatTime(272), '4:32');
  assert.equal(w.formatTime(3723), '1:02:03');
  assert.equal(w.formatScore({ kind: 'time', capped: true, reps: 15, seconds: 600 }), 'Aikaraja + 15 toistoa');
  assert.equal(w.formatScore({ kind: 'time', capped: true, reps: 15, seconds: 600 }, { long: true }), 'Aikaraja 10:00 + 15 toistoa');
  assert.equal(w.formatScore({ kind: 'roundsReps', rounds: 7, reps: 12 }), '7 + 12');
  assert.equal(w.formatScore({ kind: 'roundsReps', rounds: 7, reps: 12 }, { long: true }), '7 kierrosta + 12 toistoa');
  assert.equal(w.formatScore({ kind: 'kg', value: 102.5 }), '102,5 kg');
  assert.equal(w.formatScore({ kind: 'cal', value: 120 }), '120 cal');
  assert.equal(w.formatScore({ kind: 'none' }), 'Tehty');
  assert.equal(w.resultLabel({ kind: 'time', seconds: 250, division: 'scaled' }), '4:10 · Skaalattu');
  const time = (seconds) => ({ kind: 'time', seconds }), capped = (reps) => ({ kind: 'time', capped: true, reps });
  assert.ok(w.compareScores(time(250), time(272)) > 0);
  assert.ok(w.compareScores(time(599), capped(999)) > 0, 'any finish beats a capped result');
  assert.ok(w.compareScores(capped(40), capped(30)) > 0);
  assert.ok(w.compareScores({ kind: 'roundsReps', rounds: 7, reps: 0 }, { kind: 'roundsReps', rounds: 6, reps: 99 }) > 0);
  assert.ok(w.compareScores({ kind: 'roundsReps', rounds: 7, reps: 5 }, { kind: 'roundsReps', rounds: 7, reps: 4 }) > 0);
  assert.ok(w.compareScores({ kind: 'kg', value: 100 }, { kind: 'kg', value: 102.5 }) < 0);
  assert.equal(w.compareScores({ kind: 'none' }, { kind: 'none' }), 0);
  assert.equal(w.compareScores(time(1), { kind: 'reps', value: 1 }), 0, 'different kinds are not comparable');
});

test('buildResult validates the form per score type', () => {
  const fortime = w.sanitizeWod(fran());
  assert.deepEqual(w.buildResult(fortime, { min: '4', sec: '32', division: 'rx', notes: ' ok ', rpe: '9' }), { ok: true, result: { kind: 'time', seconds: 272, division: 'rx', notes: 'ok', rpe: 9 } });
  assert.deepEqual(w.buildResult(fortime, { min: '', sec: '45' }).result.seconds, 45);
  assert.equal(w.buildResult(fortime, { min: '4', sec: '60' }).ok, false);
  assert.equal(w.buildResult(fortime, { min: '', sec: '' }).error, 'Anna aika minuutteina ja sekunteina (sekunnit 0–59), esim. 4 min 32 s.');
  assert.deepEqual(w.buildResult(fortime, { capped: true, reps: '30', division: 'scaled' }).result, { kind: 'time', capped: true, reps: 30, seconds: 600, division: 'scaled' });
  assert.equal(w.buildResult(fortime, { capped: true, reps: '' }).error, 'Anna aikarajaan mennessä tehdyt toistot kokonaislukuna.');
  assert.equal(w.buildResult(fortime, { min: '4', sec: '0', rpe: '11' }).error, 'Rasittavuuden (RPE) on oltava kokonaisluku 1–10.');
  const amrap = w.sanitizeWod({ format: 'amrap', minutes: 12 });
  assert.deepEqual(w.buildResult(amrap, { rounds: '7', reps: '' }).result, { kind: 'roundsReps', rounds: 7, reps: 0, division: 'rx' });
  assert.equal(w.buildResult(amrap, { rounds: '', reps: '5' }).ok, false);
  const kg = w.sanitizeWod({ format: 'maxload', minutes: 15 });
  assert.deepEqual(w.buildResult(kg, { value: '102,5' }).result, { kind: 'kg', value: 102.5, division: 'rx' });
  for (const bad of ['0', '-5', '1,234', 'abc', '']) assert.equal(w.buildResult(kg, { value: bad }).ok, false, bad);
  const cal = w.sanitizeWod({ format: 'intervals', score: 'cal' });
  assert.equal(w.buildResult(cal, { value: '1.5' }).error, 'Anna kalorit kokonaislukuna.');
  assert.deepEqual(w.buildResult(w.sanitizeWod({ format: 'emom' }), { division: 'scaled' }).result, { kind: 'none', division: 'scaled' });
});

test('resultFields shows a saved result for correction', () => {
  const wod = w.sanitizeSessionWod({ ...fran(), result: { kind: 'time', seconds: 272, division: 'scaled', notes: 'n', rpe: 8 } });
  assert.deepEqual(w.resultFields(wod), { min: '4', sec: '32', capped: false, reps: '', rounds: '', value: '', division: 'scaled', notes: 'n', rpe: '8' });
  const kg = w.sanitizeSessionWod({ format: 'maxload', minutes: 15, result: { kind: 'kg', value: 102.5 } });
  assert.equal(w.resultFields(kg).value, '102,5');
  assert.deepEqual(w.resultFields(w.sanitizeSessionWod({ format: 'amrap', division: 'scaled' })).division, 'scaled', 'a new form starts from the chosen division');
});

test('history: previous result, records per division and the PR rule', () => {
  const key = w.wodKey(fran());
  const entry = (id, endedAt, result, extra = {}) => ({ id, endedAt, wods: [{ id: `x${id}`, key, name: 'Fran', format: 'fortime', score: 'time', board: 'b', result: { division: 'rx', ...result } }], ...extra });
  const history = [
    entry('a', 1000, { kind: 'time', seconds: 300 }),
    entry('b', 2000, { kind: 'time', seconds: 280 }),
    entry('c', 3000, { kind: 'time', capped: true, reps: 50 }),
    entry('d', 4000, { kind: 'time', seconds: 240, division: 'scaled' }),
    entry('e', 5000, { kind: 'time', seconds: 280 }),
    entry('b', 9000, { kind: 'time', seconds: 1 }),
    { id: 'f', endedAt: 6000, wods: [{ key: 'wother', name: 'Muu', format: 'amrap', result: { kind: 'roundsReps', rounds: 5, reps: 0, division: 'rx' } }] },
    { id: 'g', endedAt: 7000, wods: [{ key, name: 'Fran', format: 'fortime' }] },
    { id: 'h', endedAt: 8000, exercises: [] },
  ];
  assert.equal(w.wodAttempts(history, key).length, 5, 'duplicate history ids and unlogged parts are skipped');
  assert.equal(w.previousResult(history, key).sessionId, 'e');
  const best = w.bestResults(history, key);
  assert.equal(best.rx.sessionId, 'b', 'a tie keeps the first time the best was reached');
  assert.equal(best.scaled.result.seconds, 240);
  assert.equal(w.isPersonalRecord(history, key, { kind: 'time', seconds: 279, division: 'rx' }), true);
  assert.equal(w.isPersonalRecord(history, key, { kind: 'time', seconds: 280, division: 'rx' }), false, 'equalling is not a new record');
  assert.equal(w.isPersonalRecord(history, key, { kind: 'time', seconds: 250, division: 'scaled' }), false);
  assert.equal(w.isPersonalRecord(history, 'wnew', { kind: 'time', seconds: 1, division: 'rx' }), false, 'the first result is a baseline');
  assert.equal(w.isPersonalRecord(history, key, { kind: 'none', division: 'rx' }), false);
  const records = w.wodRecords(history);
  assert.deepEqual(records.map((r) => [r.name, r.attempts.length]), [['Fran', 5], ['Muu', 1]]);
  assert.equal(records[0].best.rx.result.seconds, 280);
  assert.equal(records[0].latestAt, 5000);
  const doneOnly = w.wodRecords([{ id: 'x', endedAt: 1, wods: [{ key: 'k', name: 'EMOM', format: 'emom', result: { kind: 'none', division: 'rx' } }] }]);
  assert.deepEqual([doneOnly[0].best.rx, doneOnly[0].attempts.length], [null, 1]);
});

test('historyWod stores a compact board of the version done', () => {
  const wod = w.sanitizeSessionWod({ ...fran(), division: 'scaled', result: { kind: 'time', seconds: 330, division: 'scaled' } });
  const h = w.historyWod(wod);
  assert.deepEqual(Object.keys(h), ['id', 'key', 'name', 'format', 'score', 'board', 'result']);
  assert.equal(h.board, '21-15-9 aikaa vastaan · aikaraja 10 min\nKyykkypunnerrus tangolla (30 kg)\nKäänteinen soutu');
  assert.equal(h.key, wod.key);
  const unnamed = w.historyWod(w.sanitizeSessionWod({ format: 'amrap', minutes: 20, movements: [{ name: 'Yleisliike' }] }));
  assert.equal(unnamed.name, 'AMRAP 20 min');
  assert.equal('result' in unnamed, false);
});
