import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../core.js';
import { defaultTimerName, sanitizeTimers, buildTimer, phaseAt, runElapsed, sanitizeRun, totalSeconds, formatClock, formatLength, draftFrom, newInterval, presetKind, presetSeconds, sanitizeDefaults, intervalSeconds, TIMER_PRESETS } from '../timer.js';

const seq = (over = {}) => ({ id: 'a', name: 'Intervallit', repeats: 3, intervals: [{ id: 'i1', label: 'Juoksu', seconds: 60 }, { id: 'i2', label: 'Kävely', seconds: 30 }], ...over });
const draft = (over = {}) => ({ id: null, name: '', repeats: '2', intervals: [{ id: 'x', label: 'Juoksu', min: '1', sec: '' }], ...over });

test('unnamed sequences get the lowest unused Sarja N', () => {
  assert.equal(defaultTimerName([]), 'Sarja 1');
  assert.equal(defaultTimerName([{ name: 'Sarja 1' }, { name: 'Sarja 2' }]), 'Sarja 3');
  assert.equal(defaultTimerName([{ name: 'Sarja 1' }, { name: 'Sarja 3' }]), 'Sarja 2', 'a deleted number is reused');
  assert.equal(defaultTimerName([{ name: 'Oma' }]), 'Sarja 1');
  const first = buildTimer(draft(), []).timer;
  const second = buildTimer(draft(), [first]).timer;
  const third = buildTimer(draft({ name: '   ' }), [first, second]).timer;
  assert.deepEqual([first.name, second.name, third.name], ['Sarja 1', 'Sarja 2', 'Sarja 3']);
  assert.equal(buildTimer(draft({ name: 'Mäki' }), []).timer.name, 'Mäki');
});

test('editing keeps the name and does not count itself when naming', () => {
  const [a] = sanitizeTimers([seq({ id: 'a', name: 'Sarja 1' })]);
  const edited = buildTimer({ ...draftFrom(a), name: '' }, [a]).timer;
  assert.equal(edited.id, 'a');
  assert.equal(edited.name, 'Sarja 1');
});

test('buildTimer validates durations, repeats and interval count', () => {
  assert.match(buildTimer(draft({ intervals: [{ id: 'x', label: '', min: '', sec: '' }] }), []).error, /Intervallin 1 kesto on 0 sekuntia/);
  assert.match(buildTimer(draft({ intervals: [{ id: 'x', label: '', min: '0', sec: '75' }] }), []).error, /ei kelpaa/);
  assert.match(buildTimer(draft({ intervals: [{ id: 'x', label: '', min: '1.5', sec: '0' }] }), []).error, /ei kelpaa/);
  assert.match(buildTimer(draft({ intervals: [] }), []).error, /vähintään yksi/);
  for (const repeats of ['0', '100', '', 'x', '1.5']) assert.match(buildTimer(draft({ repeats }), []).error, /Toistojen määrä/, repeats);
  const ok = buildTimer(draft({ intervals: [{ id: 'x', label: '  Hölkkä  ', min: '', sec: '45' }, { id: 'y', label: '', min: '2', sec: '5' }] }), []).timer;
  assert.deepEqual(ok.intervals.map((i) => [i.label, i.seconds]), [['Hölkkä', 45], ['', 125]]);
  assert.equal(totalSeconds(ok), 2 * 170);
});

test('Työ and Lepo presets: label matching, durations, and defaults that ignore unusable values', () => {
  assert.deepEqual([presetKind('Työ'), presetKind('  lepo '), presetKind('TYÖ'), presetKind('Juoksu'), presetKind(''), presetKind(undefined)], ['work', 'rest', 'work', null, null, null]);
  assert.equal(presetSeconds(undefined, 'work'), TIMER_PRESETS.work.seconds);
  assert.equal(presetSeconds({ work: 45 }, 'work'), 45);
  assert.equal(presetSeconds({ work: 45 }, 'rest'), TIMER_PRESETS.rest.seconds);
  assert.deepEqual(sanitizeDefaults({ work: 0, rest: 10801 }), {});
  assert.deepEqual(sanitizeDefaults({ work: '45', rest: 1.5 }), {}, 'strings and fractions are not coerced');
  assert.deepEqual(sanitizeDefaults({ work: 45, rest: 90, extra: 1 }), { work: 45, rest: 90 });
  assert.deepEqual(sanitizeDefaults(null), {});
  const work = newInterval('Työ', 90), rest = newInterval(TIMER_PRESETS.rest.label, 15);
  assert.deepEqual([work.label, work.min, work.sec, rest.min, rest.sec], ['Työ', '1', '30', '', '15']);
  assert.deepEqual(intervalSeconds(work, 0), { seconds: 90 });
  assert.match(intervalSeconds(newInterval('Työ'), 2).error, /Intervallin 3 kesto on 0 sekuntia/);
});

test('a duration above the stored maximum is refused instead of being silently dropped on reload', () => {
  const long = { id: 'x', label: '', min: '180', sec: '59' };
  assert.match(buildTimer(draft({ intervals: [long] }), []).error, /liian pitkä/);
  assert.equal(buildTimer(draft({ intervals: [{ ...long, sec: '0' }] }), []).timer.intervals[0].seconds, 10800);
});

test('timerDefaults persist additively, travel in backups and fill gaps when merging', () => {
  const old = core.sanitizeState(JSON.parse(JSON.stringify(core.defaultState())));
  assert.equal('timerDefaults' in old, false, 'old data gains no field');
  const local = { ...core.defaultState(), timerDefaults: { work: 45 } };
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(core.saveStateResult(storage, local).ok, true);
  assert.deepEqual(core.loadState(storage).timerDefaults, { work: 45 });
  const parsed = core.parseBackup(JSON.stringify(core.buildBackup(local)));
  assert.deepEqual(parsed.state.timerDefaults, { work: 45 });
  assert.deepEqual(core.mergeState(core.defaultState(), parsed.state).state.timerDefaults, { work: 45 });
  assert.deepEqual(core.mergeState({ ...core.defaultState(), timerDefaults: { work: 20 } }, parsed.state).state.timerDefaults, { work: 20 }, 'local defaults win');
  assert.deepEqual(core.replaceState(core.defaultState(), parsed.state).state.timerDefaults, { work: 45 });
  assert.equal('timerDefaults' in core.sanitizeState({ ...core.defaultState(), timerDefaults: { work: 'x' } }), false, 'unusable defaults are dropped');
});

test('draftFrom and newInterval round-trip through buildTimer', () => {
  const t = sanitizeTimers([seq()])[0];
  assert.deepEqual(buildTimer(draftFrom(t), []).timer, t);
  const blank = newInterval();
  assert.deepEqual({ ...blank, id: '' }, { id: '', label: '', min: '', sec: '' });
});

test('phaseAt walks intervals and rounds and reports completion', () => {
  const t = seq();
  const at = (s) => phaseAt(t, s * 1000);
  assert.deepEqual(at(0), { done: false, round: 1, index: 0, remainingMs: 60000 });
  assert.deepEqual(at(59.5), { done: false, round: 1, index: 0, remainingMs: 500 });
  assert.deepEqual(at(60), { done: false, round: 1, index: 1, remainingMs: 30000 });
  assert.deepEqual(at(90), { done: false, round: 2, index: 0, remainingMs: 60000 });
  assert.deepEqual(at(200), { done: false, round: 3, index: 0, remainingMs: 40000 });
  assert.deepEqual(at(269), { done: false, round: 3, index: 1, remainingMs: 1000 });
  assert.deepEqual(at(270), { done: true, round: 3, index: 1, remainingMs: 0 });
  assert.equal(at(99999).done, true);
  assert.equal(phaseAt(t, -50).round, 1, 'negative elapsed clamps to the start');
});

test('pause time is excluded from elapsed time', () => {
  const run = { id: 'a', startedAt: 1000, pausedAt: null, pausedMs: 0 };
  assert.equal(runElapsed(run, 11000), 10000);
  assert.equal(runElapsed({ ...run, pausedAt: 6000 }, 999999), 5000, 'frozen while paused');
  assert.equal(runElapsed({ ...run, pausedMs: 4000 }, 11000), 6000);
});

test('sanitizeTimers drops unusable data without throwing and never coerces', () => {
  assert.deepEqual(sanitizeTimers(undefined), []);
  assert.deepEqual(sanitizeTimers('x'), []);
  const out = sanitizeTimers([
    null, 5, { intervals: [] }, { intervals: [{ seconds: 0 }, { seconds: -3 }, { seconds: 'abc' }, { seconds: 99999 }] },
    { id: 'k', name: '', repeats: 500, intervals: [{ id: 'd', label: 'A', seconds: 10.9 }, { id: 'd', label: 'B', seconds: 5 }] },
    { id: 'k', name: 'Sarja 1', repeats: 'x', intervals: [{ seconds: 20 }] },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].repeats, 99);
  assert.equal(out[0].name, 'Sarja 2', 'blank names are filled with the lowest unused number');
  assert.equal(out[1].repeats, 1);
  assert.notEqual(out[0].id, out[1].id, 'duplicate ids are replaced');
  assert.notEqual(out[0].intervals[0].id, out[0].intervals[1].id);
  assert.equal(out[0].intervals[0].seconds, 10);
  assert.equal(sanitizeTimers(Array.from({ length: 80 }, () => seq())).length, 50);
});

test('sanitizeRun only accepts a run of an existing sequence', () => {
  const timers = [seq()];
  assert.deepEqual(sanitizeRun({ id: 'a', startedAt: 5, pausedAt: null, pausedMs: 0, extra: 1 }, timers), { id: 'a', startedAt: 5, pausedAt: null, pausedMs: 0 });
  assert.equal(sanitizeRun({ id: 'gone', startedAt: 5, pausedAt: null, pausedMs: 0 }, timers), null);
  assert.equal(sanitizeRun({ id: 'a', startedAt: 'x', pausedAt: null, pausedMs: 0 }, timers), null);
  assert.equal(sanitizeRun({ id: 'a', startedAt: 5, pausedAt: null, pausedMs: -1 }, timers), null);
  assert.equal(sanitizeRun(null, timers), null);
});

test('clock and length formatting', () => {
  assert.equal(formatClock(30000), '0:30');
  assert.equal(formatClock(29001), '0:30', 'rounds up so the display never shows 0:00 early');
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(61000), '1:01');
  assert.deepEqual([formatLength(45), formatLength(120), formatLength(125)], ['45 s', '2 min', '2 min 5 s']);
});

test('timers persist additively: old data loads unchanged, saved sequences survive a save and reload', () => {
  const old = core.defaultState();
  const oldRaw = JSON.stringify(old);
  const loaded = core.sanitizeState(JSON.parse(oldRaw));
  assert.equal('timers' in loaded, false, 'old data gains no timers field');
  assert.deepEqual(loaded.routines, old.routines);

  const state = { ...loaded, timers: sanitizeTimers([seq()]) };
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(core.saveStateResult(storage, state).ok, true);
  assert.deepEqual(core.loadState(storage).timers, state.timers);
});

test('timers travel in backups, merge by id and survive an old backup being restored', () => {
  const timers = sanitizeTimers([seq()]);
  const local = { ...core.defaultState(), timers };
  const parsed = core.parseBackup(JSON.stringify(core.buildBackup(local)));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.state.timers, timers);

  const other = { ...core.defaultState(), timers: sanitizeTimers([seq({ id: 'b', name: 'Toinen' })]) };
  const merged = core.mergeState(local, core.parseBackup(JSON.stringify(core.buildBackup(other))).state);
  assert.deepEqual(merged.state.timers.map((t) => t.id).sort(), ['a', 'b']);
  assert.deepEqual(core.mergeState(merged.state, parsed.state).state.timers.map((t) => t.id).sort(), ['a', 'b'], 're-import changes nothing');

  const oldBackup = core.parseBackup(JSON.stringify({ format: core.BACKUP_FORMAT, formatVersion: 1, data: { v: 1, routines: core.defaultState().routines, history: [] } }));
  assert.equal(oldBackup.ok, true);
  assert.deepEqual(core.replaceState(local, oldBackup.state).state.timers, timers, 'a backup without timers does not erase them');
});
