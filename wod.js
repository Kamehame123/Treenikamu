// Functional training ("WOD") engine. Pure helpers, no DOM; shared by the app and the tests.
//
// A WOD is one scored part of a functional program:
//   { id, name, template?, format, <format parameters>, score, movements, stimulus?, notes? }
// Only the parameters its format uses are kept, so equal workouts always have equal data.
// A session copy adds { key, division, clock?, result? }; a history entry keeps a compact
// snapshot { id, key, name, format, score, board, result? }.
//
// COMPATIBILITY: wodKey() groups saved results into one result series (previous result and
// records). Never change how it is computed, or old results stop matching new ones.
import { EXERCISES, normalizeSearch } from './exercises.js';
import { formatClock, formatLength } from './timer.js';

export const MAX_WODS = 3;
export const MAX_MOVEMENTS = 20;
export const MAX_LAPS = 300;
export const PREROLL_MS = 10000;
const MAX_SECONDS = 86400;
const MAX_COUNT = 100000;

export const WOD_FORMATS = Object.freeze(['fortime', 'amrap', 'emom', 'intervals', 'maxload']);
export const FORMAT_LABELS = Object.freeze({
  fortime: 'Aikaa vastaan', amrap: 'AMRAP', emom: 'EMOM', intervals: 'Intervallit', maxload: 'Maksimikuorma',
});
export const FORMAT_HELP = Object.freeze({
  fortime: 'Kaikki työ mahdollisimman nopeasti. Tulos on aika.',
  amrap: 'Mahdollisimman monta kierrosta annetussa ajassa. Tulos on kierrokset + toistot.',
  emom: 'Työ alkaa joka minuutin (tai valitun jakson) alussa, loppuaika levätään.',
  intervals: 'Työ- ja lepojaksot vuorottelevat, esim. 8 × 20 s työ / 10 s lepo.',
  maxload: 'Raskain onnistunut suoritus annetussa ajassa. Tulos on kilot.',
});
export const SCORE_LABELS = Object.freeze({
  time: 'Aika', roundsReps: 'Kierrokset + toistot', reps: 'Toistot', cal: 'Kalorit', m: 'Metrit',
  rounds: 'Kierrokset', kg: 'Kuorma (kg)', none: 'Ei tulosta, vain tehty',
});
export const SCORE_KINDS = Object.freeze(Object.keys(SCORE_LABELS));
export const FORMAT_SCORES = Object.freeze({
  fortime: Object.freeze(['time']),
  amrap: Object.freeze(['roundsReps', 'reps', 'cal', 'm']),
  emom: Object.freeze(['none', 'rounds', 'reps', 'kg']),
  intervals: Object.freeze(['reps', 'cal', 'm', 'none']),
  maxload: Object.freeze(['kg']),
});
export const FORMAT_DEFAULTS = Object.freeze({
  fortime: Object.freeze({ rounds: 1, minutes: 0, score: 'time' }),
  amrap: Object.freeze({ minutes: 12, score: 'roundsReps' }),
  emom: Object.freeze({ every: 60, rounds: 10, score: 'none' }),
  intervals: Object.freeze({ work: 20, rest: 10, rounds: 8, score: 'reps' }),
  maxload: Object.freeze({ minutes: 15, score: 'kg' }),
});
export const DIVISIONS = Object.freeze({ rx: 'Rx', scaled: 'Skaalattu' });
export const SCHEME_CHIPS = Object.freeze(['21-15-9', '15-12-9', '50-40-30-20-10', '10-9-8-7-6-5-4-3-2-1']);
export const MODALITY_LABELS = Object.freeze({ G: 'Voimistelu', W: 'Painot', M: 'Kestävyys' });

const newId = () => globalThis.crypto?.randomUUID?.() ?? `w-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const text = (v, max) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').replace(/\s+/g, ' ').trim().slice(0, max);
// Instructions keep their line breaks; each line is tidied separately.
const longText = (v, max) => (typeof v === 'string' ? v : '').replace(/\r\n?/g, '\n').split('\n')
  .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const int = (v, min, max, fallback) => {
  const n = Math.floor(Number(v));
  return String(v ?? '').trim() !== '' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
// Strict whole number in range, or null. Never coerces a bad value into a different result.
const whole = (v, min, max) => {
  const s = String(v ?? '').trim();
  return /^\d+$/.test(s) && Number(s) >= min && Number(s) <= max ? Number(s) : null;
};
const stamp = (v) => Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= 8.64e15 ? Number(v) : null;
const uniqueIds = (items) => {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) item.id = newId();
    seen.add(item.id);
  }
  return items;
};

// '21-15-9' -> [21, 15, 9]; '' -> []; null when it is not a ladder of 2–20 whole numbers 1–999.
export function parseScheme(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return [];
  const parts = raw.split(/\s*[-–—/,]\s*|\s+/);
  if (parts.length < 2 || parts.length > 20 || !parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 1)) return null;
  return parts.map(Number);
}

export function sanitizeMovement(raw) {
  const name = text(raw?.name, 60);
  if (!name) return null;
  const scaled = { name: text(raw?.scaled?.name, 60), amount: text(raw?.scaled?.amount, 20), load: text(raw?.scaled?.load, 20) };
  const sourceId = text(raw?.sourceId, 100);
  return {
    id: text(raw?.id, 80) || newId(),
    name,
    amount: text(raw?.amount, 20),
    load: text(raw?.load, 20),
    ...(scaled.name || scaled.amount || scaled.load ? { scaled } : {}),
    ...(sourceId ? { sourceId } : {}),
  };
}

export function sanitizeWod(raw) {
  const format = WOD_FORMATS.includes(raw?.format) ? raw.format : 'fortime';
  const d = FORMAT_DEFAULTS[format];
  const params = {};
  if (format === 'fortime') {
    const steps = parseScheme(raw?.scheme);
    if (steps?.length) { params.rounds = steps.length; params.scheme = steps.join('-'); }
    else params.rounds = int(raw?.rounds, 1, 100, d.rounds);
    params.minutes = int(raw?.minutes, 0, 180, d.minutes);
  } else if (format === 'amrap' || format === 'maxload') {
    params.minutes = int(raw?.minutes, 1, 180, d.minutes);
  } else if (format === 'emom') {
    params.every = int(raw?.every, 10, 600, d.every);
    params.rounds = int(raw?.rounds, 1, 100, d.rounds);
    if (raw?.alternate === true) params.alternate = true;
    if (raw?.ascending === true) params.ascending = true;
  } else {
    params.work = int(raw?.work, 5, 600, d.work);
    params.rest = int(raw?.rest, 0, 600, d.rest);
    params.rounds = int(raw?.rounds, 1, 100, d.rounds);
  }
  const template = text(raw?.template, 40), stimulus = text(raw?.stimulus, 200), notes = longText(raw?.notes, 500);
  return {
    id: text(raw?.id, 80) || newId(),
    name: text(raw?.name, 60),
    ...(template ? { template } : {}),
    format,
    ...params,
    score: FORMAT_SCORES[format].includes(raw?.score) ? raw.score : d.score,
    movements: uniqueIds((Array.isArray(raw?.movements) ? raw.movements : []).slice(0, MAX_MOVEMENTS).map(sanitizeMovement).filter(Boolean)),
    ...(stimulus ? { stimulus } : {}),
    ...(notes ? { notes } : {}),
  };
}

export const sanitizeWods = (raw) => uniqueIds((Array.isArray(raw) ? raw : [])
  .filter((w) => w && typeof w === 'object').slice(0, MAX_WODS).map(sanitizeWod));

// Warm-up and cool-down: free instructions and planned minutes. Null when both are empty.
export function sanitizeBlock(raw, { session = false } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const body = longText(raw.text, 1000), minutes = int(raw.minutes, 0, 60, 0);
  if (!body && !minutes) return null;
  return { text: body, minutes, ...(session ? { done: raw.done === true } : {}) };
}

export function sanitizeResult(raw) {
  if (!raw || typeof raw !== 'object' || !SCORE_KINDS.includes(raw.kind)) return null;
  const notes = longText(raw.notes, 300), rpe = whole(raw.rpe, 1, 10);
  const extra = { division: raw.division === 'scaled' ? 'scaled' : 'rx', ...(notes ? { notes } : {}), ...(rpe !== null ? { rpe } : {}) };
  const { kind } = raw;
  if (kind === 'time') {
    const seconds = whole(raw.seconds, 1, MAX_SECONDS);
    if (raw.capped !== true) return seconds === null ? null : { kind, seconds, ...extra };
    const reps = whole(raw.reps, 0, MAX_COUNT);
    return reps === null ? null : { kind, capped: true, reps, ...(seconds !== null ? { seconds } : {}), ...extra };
  }
  if (kind === 'roundsReps') {
    const rounds = whole(raw.rounds, 0, 10000), reps = whole(raw.reps, 0, MAX_COUNT);
    return rounds === null || reps === null ? null : { kind, rounds, reps, ...extra };
  }
  if (kind === 'none') return { kind, ...extra };
  if (kind === 'kg') {
    const value = Number(raw.value);
    return Number.isFinite(value) && value > 0 && value <= 10000 ? { kind, value: Math.round(value * 100) / 100, ...extra } : null;
  }
  const value = whole(raw.value, 0, MAX_COUNT);
  return value === null ? null : { kind, value, ...extra };
}

export function sanitizeClock(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const startedAt = stamp(raw.startedAt), pausedMs = Number(raw.pausedMs ?? 0);
  if (startedAt === null || !Number.isFinite(pausedMs) || pausedMs < 0) return null;
  const endedAt = stamp(raw.endedAt);
  const laps = (Array.isArray(raw.laps) ? raw.laps : []).slice(0, MAX_LAPS).map(Number)
    .filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  return { startedAt, pausedAt: stamp(raw.pausedAt), pausedMs, laps, ...(endedAt !== null ? { endedAt } : {}) };
}

// The copy inside an active workout: the planned WOD plus how it is being done.
export function sanitizeSessionWod(raw) {
  const wod = sanitizeWod(raw), clock = sanitizeClock(raw?.clock), result = sanitizeResult(raw?.result);
  return {
    ...wod,
    key: text(raw?.key, 40) || wodKey(wod),
    division: raw?.division === 'scaled' ? 'scaled' : 'rx',
    ...(clock ? { clock } : {}),
    ...(result ? { result } : {}),
  };
}

export const sanitizeSessionWods = (raw) => uniqueIds((Array.isArray(raw) ? raw : [])
  .filter((w) => w && typeof w === 'object').slice(0, MAX_WODS).map(sanitizeSessionWod));

// Compact record kept in history: what was on the whiteboard and the logged score.
export function sanitizeHistoryWod(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const key = text(raw.key, 40);
  if (!key) return null;
  const format = WOD_FORMATS.includes(raw.format) ? raw.format : 'fortime';
  const result = sanitizeResult(raw.result);
  return {
    id: text(raw.id, 80) || newId(),
    key,
    name: text(raw.name, 60) || FORMAT_LABELS[format],
    format,
    score: FORMAT_SCORES[format].includes(raw.score) ? raw.score : (result?.kind ?? FORMAT_DEFAULTS[format].score),
    board: longText(raw.board, 1000),
    ...(result ? { result } : {}),
  };
}

export const sanitizeHistoryWods = (raw) => uniqueIds((Array.isArray(raw) ? raw : [])
  .slice(0, MAX_WODS).map(sanitizeHistoryWod).filter(Boolean));

// ---- Whiteboard text ----

// Reps for one movement in one round (1-based): a ladder fills empty amounts, Death By climbs each interval.
export function repsForRound(wod, movement, round) {
  const amount = text(movement?.amount, 20);
  if (wod.format === 'fortime' && wod.scheme && !amount) return String(parseScheme(wod.scheme)?.[round - 1] ?? '');
  if (wod.format === 'emom' && wod.ascending) {
    const step = /^\d+$/.test(amount) && Number(amount) > 0 ? Number(amount) : 1;
    return String(step * Math.max(1, round));
  }
  return amount;
}

// The version done in a division: a scaled substitution replaces the movement, otherwise only the given fields change.
export function movementVersion(movement, division = 'rx') {
  const s = division === 'scaled' ? movement?.scaled : null;
  if (!s) return { name: movement.name ?? '', amount: movement.amount ?? '', load: movement.load ?? '' };
  const swapped = !!s.name && normalizeSearch(s.name) !== normalizeSearch(movement.name);
  return { name: s.name || movement.name || '', amount: s.amount || movement.amount || '', load: (swapped ? s.load : s.load || movement.load) || '' };
}

export function movementLine(movement, division = 'rx', amountOverride = null) {
  const v = movementVersion(movement, division);
  const amount = amountOverride ?? v.amount;
  return `${[amount, v.name].filter(Boolean).join(' ')}${v.load ? ` (${v.load})` : ''}`;
}

export function wodHeadline(wod) {
  if (wod.format === 'fortime') {
    const base = wod.scheme ? `${wod.scheme} aikaa vastaan` : wod.rounds > 1 ? `${wod.rounds} kierrosta aikaa vastaan` : 'Aikaa vastaan';
    return wod.minutes ? `${base} · aikaraja ${wod.minutes} min` : base;
  }
  if (wod.format === 'amrap') return `AMRAP ${wod.minutes} min`;
  if (wod.format === 'maxload') return `Maksimikuorma · ${wod.minutes} min`;
  if (wod.format === 'intervals') return `${wod.rounds} × ${formatLength(wod.work)} työ${wod.rest ? ` / ${formatLength(wod.rest)} lepo` : ''}`;
  const base = wod.every === 60 ? `EMOM ${wod.rounds} min` : `Joka ${formatLength(wod.every)} × ${wod.rounds}`;
  return `${base}${wod.alternate ? ' · vuorotellen' : ''}${wod.ascending ? ' · nousevat toistot' : ''}`;
}

export const wodTitle = (wod) => wod.name || wodHeadline(wod);

export function boardLines(wod, division = 'rx') {
  return [wodHeadline(wod), ...wod.movements.map((m) => movementLine(m, division))];
}

export const boardText = (wod, division = 'rx') => boardLines(wod, division).join('\n').slice(0, 1000);

// Planned length in minutes, or null when it depends on the athlete (For Time without a cap).
export function wodMinutes(wod) {
  if (wod.format === 'fortime') return wod.minutes || null;
  if (wod.format === 'emom') return Math.round(wod.every * wod.rounds / 6) / 10;
  if (wod.format === 'intervals') return Math.round((wod.rounds * (wod.work + wod.rest) - wod.rest) / 6) / 10;
  return wod.minutes;
}

const LIBRARY_BY_ID = new Map(EXERCISES.map((e) => [e.id, e]));
const LIBRARY_BY_NAME = new Map(EXERCISES.map((e) => [normalizeSearch(e.name), e]));

// G = gymnastics (own body), W = weightlifting and objects, M = monostructural cardio. Unknown movements are skipped.
// Library groups follow muscles and equipment; a box jump still counts as gymnastics in a WOD.
const MODALITY_OVERRIDES = { 'lib-laatikkohyppy': 'G' };
export function modalities(wod) {
  const found = new Set();
  for (const m of wod.movements ?? []) {
    const entry = LIBRARY_BY_ID.get(m.sourceId) ?? LIBRARY_BY_NAME.get(normalizeSearch(m.name));
    if (!entry || entry.category === 'Liikkuvuus') continue;
    found.add(MODALITY_OVERRIDES[entry.id] ?? (entry.category === 'Kestävyys' ? 'M' : entry.equipment === 'Kehonpaino' ? 'G' : 'W'));
  }
  return ['G', 'W', 'M'].filter((k) => found.has(k));
}

// ---- Identity of a workout ----

// 53-bit string hash (cyrb53 construction); short keys keep history small.
function hash(value) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// Same work = same key, wherever the workout is saved. The name, notes, stimulus, time cap,
// max-load window and scaled versions do not change it; the format, its parameters, the score
// type and each movement's name, amount and Rx load do. NEVER change this computation.
export function wodKey(raw) {
  const w = sanitizeWod(raw);
  const compact = (v) => normalizeSearch(v).replace(/ /g, '');
  const params = {
    fortime: [w.rounds, w.scheme ?? ''],
    amrap: [w.minutes],
    emom: [w.every, w.rounds, w.alternate === true, w.ascending === true],
    intervals: [w.work, w.rest, w.rounds],
    maxload: [],
  }[w.format];
  const movements = w.movements.map((m) => [normalizeSearch(m.name), compact(m.amount), compact(m.load)]);
  return `w${hash(JSON.stringify([w.format, ...params, w.score, movements]))}`;
}

// ---- Validation of an edited WOD (raw editor values, before sanitizing) ----

export function validateWod(raw, label = 'WOD') {
  const errors = [];
  const format = raw?.format;
  if (!WOD_FORMATS.includes(format)) return [`${label}: valitse muoto.`];
  const ok = (v, min, max) => whole(v, min, max) !== null;
  if (format === 'fortime') {
    if (String(raw.scheme ?? '').trim()) {
      if (!parseScheme(raw.scheme)) errors.push(`${label}: kirjoita toistokaava muodossa 21-15-9 (2–20 lukua, kukin 1–999).`);
    } else if (!ok(raw.rounds, 1, 100)) errors.push(`${label}: kierroksia on oltava 1–100.`);
    if (String(raw.minutes ?? '').trim() !== '' && !ok(raw.minutes, 0, 180)) errors.push(`${label}: aikaraja on 0–180 minuuttia (0 = ei aikarajaa).`);
  } else if (format === 'amrap' || format === 'maxload') {
    if (!ok(raw.minutes, 1, 180)) errors.push(`${label}: keston on oltava 1–180 minuuttia.`);
  } else if (format === 'emom') {
    if (!ok(raw.every, 10, 600)) errors.push(`${label}: jakson pituuden on oltava 10–600 sekuntia.`);
    if (!ok(raw.rounds, 1, 100)) errors.push(`${label}: jaksoja on oltava 1–100.`);
  } else {
    if (!ok(raw.work, 5, 600)) errors.push(`${label}: työjakson on oltava 5–600 sekuntia.`);
    if (!ok(raw.rest, 0, 600)) errors.push(`${label}: lepojakson on oltava 0–600 sekuntia.`);
    if (!ok(raw.rounds, 1, 100)) errors.push(`${label}: kierroksia on oltava 1–100.`);
  }
  if (raw.score !== undefined && !FORMAT_SCORES[format].includes(raw.score)) errors.push(`${label}: valitse tuloksen tyyppi.`);
  const movements = Array.isArray(raw.movements) ? raw.movements : [];
  if (!movements.length) errors.push(`${label}: lisää vähintään yksi liike.`);
  if (movements.length > MAX_MOVEMENTS) errors.push(`${label}: liikkeitä voi olla enintään ${MAX_MOVEMENTS}.`);
  movements.forEach((m, i) => { if (!text(m?.name, 60)) errors.push(`${label}, liike ${i + 1}: lisää nimi.`); });
  return errors;
}

export function validateBlock(raw, label) {
  if (!raw) return [];
  const minutes = String(raw.minutes ?? '').trim();
  return minutes === '' || whole(minutes, 0, 60) !== null ? [] : [`${label}: keston on oltava 0–60 minuuttia.`];
}

// ---- Clock ----
// A clock is { startedAt, pausedAt (or null), pausedMs, laps: [work ms at each completed round], endedAt? }.
// Its time includes a 10 s pre-roll; everything is computed from timestamps, so reloads and
// throttled background tabs never make it drift.

// Lengths in ms. totalMs is null when the clock runs until the athlete is done (For Time without a cap).
export function clockPlan(wod) {
  if (wod.format === 'emom') {
    const intervalMs = wod.every * 1000;
    return { direction: 'down', rounds: wod.rounds, intervalMs, totalMs: intervalMs * wod.rounds };
  }
  if (wod.format === 'intervals') {
    const workMs = wod.work * 1000, restMs = wod.rest * 1000;
    return { direction: 'down', rounds: wod.rounds, workMs, restMs, totalMs: wod.rounds * (workMs + restMs) - restMs };
  }
  if (wod.format === 'fortime') return { direction: 'up', rounds: wod.rounds, totalMs: wod.minutes ? wod.minutes * 60000 : null };
  return { direction: 'down', rounds: 0, totalMs: wod.minutes * 60000 };
}

// Time since the start tap: pre-roll included, pauses excluded, frozen once the clock has ended.
export const clockElapsed = (clock, now = Date.now()) => clock
  ? Math.max(0, (clock.endedAt ?? clock.pausedAt ?? now) - clock.startedAt - clock.pausedMs) : 0;

// Where the workout is after `elapsedMs` of clock time.
export function clockAt(wod, elapsedMs) {
  const plan = clockPlan(wod), elapsed = Math.max(0, Number(elapsedMs) || 0);
  if (elapsed < PREROLL_MS) return { phase: 'preroll', workMs: 0, round: 0, remainingMs: PREROLL_MS - elapsed, plan };
  const t = elapsed - PREROLL_MS;
  if (plan.totalMs !== null && t >= plan.totalMs) return { phase: 'done', workMs: plan.totalMs, round: plan.rounds, remainingMs: 0, plan };
  if (wod.format === 'emom') {
    const i = Math.floor(t / plan.intervalMs);
    return { phase: 'run', workMs: t, round: i + 1, remainingMs: (i + 1) * plan.intervalMs - t, totalRemainingMs: plan.totalMs - t, plan };
  }
  if (wod.format === 'intervals') {
    const cycle = plan.workMs + plan.restMs, i = Math.floor(t / cycle), into = t - i * cycle, work = into < plan.workMs;
    return { phase: 'run', workMs: t, round: i + 1, segment: work ? 'work' : 'rest',
      remainingMs: work ? plan.workMs - into : cycle - into, totalRemainingMs: plan.totalMs - t, plan };
  }
  return { phase: 'run', workMs: t, round: 0, remainingMs: plan.totalMs === null ? null : plan.totalMs - t, plan };
}

function emomTarget(wod, round) {
  const division = wod.division === 'scaled' ? 'scaled' : 'rx';
  const line = (m) => movementLine(m, division, wod.ascending ? repsForRound(wod, m, round) : null);
  if (wod.alternate && wod.movements.length) return line(wod.movements[(round - 1) % wod.movements.length]);
  return wod.ascending ? wod.movements.map(line).join(' + ') : '';
}

// Everything the clock screen shows at `now`. `cue` changes exactly when a sound is due:
// 'tick' for the last three seconds, 'go' when work starts, 'rest' when rest starts, 'done' at the end.
export function clockFace(wod, clock, now = Date.now()) {
  const at = clockAt(wod, clockElapsed(clock, now));
  const plan = at.plan, laps = clock?.laps ?? [];
  const face = { phase: at.phase, workMs: at.workMs, paused: !!clock && clock.pausedAt !== null && !clock.endedAt,
    time: '', label: '', detail: '', target: '', round: 0, rounds: plan.rounds, cue: '', sound: null, say: '' };
  const tick = (slot, ms) => {
    const s = Math.ceil(ms / 1000);
    return s <= 3 ? { cue: `${slot}:${s}`, sound: 'tick' } : null;
  };
  if (at.phase === 'done' || clock?.endedAt) {
    const natural = at.phase === 'done';
    Object.assign(face, { phase: 'done', time: formatTime(at.workMs / 1000), cue: 'done', sound: 'done' });
    if (wod.format === 'fortime') {
      face.label = natural ? 'Aikaraja' : 'Valmis';
      face.say = natural ? 'Aikaraja täynnä.' : `Valmis. Aika ${face.time}.`;
    } else {
      face.label = natural ? 'Aika loppui' : 'Lopetettu';
      face.say = natural ? 'Aika loppui.' : 'Kello pysäytetty.';
    }
    if (wod.format === 'amrap') face.detail = `${laps.length} kierrosta`;
    return face;
  }
  if (at.phase === 'preroll') {
    const s = Math.ceil(at.remainingMs / 1000);
    return Object.assign(face, { time: String(s), label: 'Valmistaudu', detail: wodHeadline(wod), ...(tick('pre', at.remainingMs) ?? { cue: 'pre' }) });
  }
  if (wod.format === 'emom') {
    Object.assign(face, { round: at.round, time: formatClock(at.remainingMs), label: `${wod.every === 60 ? 'Minuutti' : 'Jakso'} ${at.round}/${plan.rounds}`,
      detail: `Kokonaisaikaa jäljellä ${formatClock(at.totalRemainingMs)}`, target: emomTarget(wod, at.round) });
    return Object.assign(face, tick(`int:${at.round}`, at.remainingMs) ?? { cue: `int:${at.round}`, sound: 'go',
      say: `${at.round === 1 ? 'Nyt! ' : ''}${face.label}${face.target ? `: ${face.target}` : ''}.` });
  }
  if (wod.format === 'intervals') {
    const work = at.segment === 'work', slot = `seg:${at.round}:${at.segment}`;
    Object.assign(face, { round: at.round, time: formatClock(at.remainingMs), label: work ? 'TYÖ' : 'LEPO', detail: `Kierros ${at.round}/${plan.rounds}` });
    return Object.assign(face, tick(slot, at.remainingMs) ?? { cue: slot, sound: work ? 'go' : 'rest',
      say: `${at.round === 1 && work ? 'Nyt! ' : ''}${work ? 'Työ' : 'Lepo'}, kierros ${at.round}/${plan.rounds}.` });
  }
  const fresh = at.workMs < 2000;
  if (wod.format === 'fortime') {
    face.round = Math.min(laps.length + 1, wod.rounds);
    const cap = plan.totalMs ? formatTime(plan.totalMs / 1000) : '';
    Object.assign(face, { time: formatTime(at.workMs / 1000), label: fresh ? 'Nyt!' : 'Aikaa vastaan',
      detail: wod.rounds > 1 ? `Kierros ${face.round}/${wod.rounds}${cap ? ` · aikaraja ${cap}` : ''}` : cap ? `Aikaraja ${cap}` : '',
      target: wod.scheme ? `Nyt: ${parseScheme(wod.scheme)[face.round - 1]}` : '' });
  } else {
    face.round = wod.format === 'amrap' ? laps.length + 1 : 0;
    Object.assign(face, { time: formatClock(at.remainingMs), label: fresh ? 'Nyt!' : FORMAT_LABELS[wod.format],
      detail: wod.format === 'amrap' ? `Kierros ${face.round}` : '' });
  }
  return Object.assign(face, (plan.totalMs !== null && tick('run', at.remainingMs)) || { cue: 'run', sound: 'go', say: 'Nyt!' });
}

export function startClock(wod, now = Date.now()) {
  wod.clock = { startedAt: now, pausedAt: null, pausedMs: 0, laps: [] };
}

export function pauseClock(wod, now = Date.now()) {
  const c = wod.clock;
  if (!c || c.endedAt || c.pausedAt !== null) return false;
  c.pausedAt = now;
  return true;
}

export function resumeClock(wod, now = Date.now()) {
  const c = wod.clock;
  if (!c || c.endedAt || c.pausedAt === null) return false;
  c.pausedMs += Math.max(0, now - c.pausedAt);
  c.pausedAt = null;
  return true;
}

// Time up or cap reached: ends at the planned moment, even when the app notices it late.
export function settleClock(wod, now = Date.now()) {
  const c = wod.clock, plan = clockPlan(wod);
  if (!c || c.endedAt || plan.totalMs === null || clockElapsed(c, now) < PREROLL_MS + plan.totalMs) return false;
  c.endedAt = c.startedAt + c.pausedMs + PREROLL_MS + plan.totalMs;
  c.pausedAt = null;
  return true;
}

// The athlete's finish or stop. During the pre-roll nothing has happened yet, so the clock is removed.
export function stopClock(wod, now = Date.now()) {
  const c = wod.clock;
  if (!c || c.endedAt) return 'none';
  if (settleClock(wod, now)) return 'ended';
  const elapsed = clockElapsed(c, now);
  if (elapsed < PREROLL_MS) { delete wod.clock; return 'cancelled'; }
  c.endedAt = c.startedAt + c.pausedMs + elapsed;
  c.pausedAt = null;
  return 'ended';
}

export function addLap(wod, now = Date.now()) {
  const c = wod.clock;
  if (!c || c.endedAt || c.pausedAt !== null || c.laps.length >= MAX_LAPS) return false;
  const at = clockAt(wod, clockElapsed(c, now));
  if (at.phase !== 'run') return false;
  c.laps.push(at.workMs);
  return true;
}

export function undoLap(wod) {
  if (!wod.clock?.laps.length) return false;
  wod.clock.laps.pop();
  return true;
}

// ---- Scores ----

export function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

const kilos = (n) => String(Math.round(n * 100) / 100).replace('.', ',');

export function formatScore(result, { long = false } = {}) {
  if (!result) return '';
  switch (result.kind) {
    case 'time': return result.capped ? `Aikaraja${long && result.seconds ? ` ${formatTime(result.seconds)}` : ''} + ${result.reps} toistoa` : formatTime(result.seconds);
    case 'roundsReps': return long ? `${result.rounds} kierrosta + ${result.reps} toistoa` : `${result.rounds} + ${result.reps}`;
    case 'reps': return `${result.value} toistoa`;
    case 'cal': return `${result.value} cal`;
    case 'm': return `${result.value} m`;
    case 'rounds': return `${result.value} kierrosta`;
    case 'kg': return `${kilos(result.value)} kg`;
    default: return 'Tehty';
  }
}

export const resultLabel = (result, options) => result ? `${formatScore(result, options)} · ${DIVISIONS[result.division] ?? DIVISIONS.rx}` : '';

// Positive when a is better than b, 0 when equal or not comparable. For Time: any finish beats
// a capped result, and between capped results more reps wins.
export function compareScores(a, b) {
  if (!a || !b || a.kind !== b.kind || a.kind === 'none') return 0;
  if (a.kind === 'time') {
    if (!a.capped && !b.capped) return b.seconds - a.seconds;
    if (!a.capped !== !b.capped) return a.capped ? -1 : 1;
    return a.reps - b.reps;
  }
  if (a.kind === 'roundsReps') return (a.rounds - b.rounds) || (a.reps - b.reps);
  return a.value - b.value;
}

// Values for the result form: the saved result when correcting it, otherwise what the clock measured.
export function resultFields(wod) {
  const fields = { min: '', sec: '', capped: false, reps: '', rounds: '', value: '', division: wod.division === 'scaled' ? 'scaled' : 'rx', notes: '', rpe: '' };
  const r = wod.result;
  if (r) {
    Object.assign(fields, { division: r.division, notes: r.notes ?? '', rpe: r.rpe === undefined ? '' : String(r.rpe) });
    if (r.kind === 'time' && r.capped) Object.assign(fields, { capped: true, reps: String(r.reps) });
    else if (r.kind === 'time') Object.assign(fields, { min: String(Math.floor(r.seconds / 60)), sec: String(r.seconds % 60) });
    else if (r.kind === 'roundsReps') Object.assign(fields, { rounds: String(r.rounds), reps: String(r.reps) });
    else if (r.kind !== 'none') fields.value = r.kind === 'kg' ? kilos(r.value) : String(r.value);
    return fields;
  }
  const c = wod.clock;
  if (!c?.endedAt) return fields;
  const at = clockAt(wod, clockElapsed(c));
  if (wod.score === 'time') {
    if (at.phase === 'done' && at.plan.totalMs !== null) fields.capped = true;
    else if (at.workMs >= 1000) {
      const s = Math.floor(at.workMs / 1000);
      Object.assign(fields, { min: String(Math.floor(s / 60)), sec: String(s % 60) });
    }
  } else if (wod.score === 'roundsReps') fields.rounds = String(c.laps.length);
  else if (wod.score === 'rounds' && wod.format === 'emom') fields.value = String(Math.min(wod.rounds, Math.floor(at.workMs / at.plan.intervalMs)));
  return fields;
}

const VALUE_WORDS = { reps: 'toistot', cal: 'kalorit', m: 'metrit', rounds: 'kierrokset' };

// Result form -> { ok, result } or { ok: false, error } naming what to fix.
export function buildResult(wod, fields) {
  const kind = wod.score, blank = (v) => String(v ?? '').trim() === '';
  const rpe = blank(fields.rpe) ? null : whole(fields.rpe, 1, 10);
  if (!blank(fields.rpe) && rpe === null) return { ok: false, error: 'Rasittavuuden (RPE) on oltava kokonaisluku 1–10.' };
  const notes = longText(fields.notes, 300);
  const extra = { division: fields.division === 'scaled' ? 'scaled' : 'rx', ...(notes ? { notes } : {}), ...(rpe !== null ? { rpe } : {}) };
  if (kind === 'time' && fields.capped) {
    const reps = whole(fields.reps, 0, MAX_COUNT);
    if (reps === null) return { ok: false, error: 'Anna aikarajaan mennessä tehdyt toistot kokonaislukuna.' };
    return { ok: true, result: { kind, capped: true, reps, ...(wod.minutes ? { seconds: wod.minutes * 60 } : {}), ...extra } };
  }
  if (kind === 'time') {
    const min = blank(fields.min) ? 0 : whole(fields.min, 0, 1440), sec = blank(fields.sec) ? 0 : whole(fields.sec, 0, 59);
    const seconds = min === null || sec === null ? 0 : min * 60 + sec;
    if (seconds < 1 || seconds > MAX_SECONDS) return { ok: false, error: 'Anna aika minuutteina ja sekunteina (sekunnit 0–59), esim. 4 min 32 s.' };
    return { ok: true, result: { kind, seconds, ...extra } };
  }
  if (kind === 'roundsReps') {
    const rounds = whole(fields.rounds, 0, 10000), reps = blank(fields.reps) ? 0 : whole(fields.reps, 0, MAX_COUNT);
    if (rounds === null || reps === null) return { ok: false, error: 'Anna kokonaiset kierrokset ja lisätoistot kokonaislukuina.' };
    return { ok: true, result: { kind, rounds, reps, ...extra } };
  }
  if (kind === 'none') return { ok: true, result: { kind, ...extra } };
  if (kind === 'kg') {
    const raw = String(fields.value ?? '').trim().replace(',', '.');
    const value = /^\d+(?:\.\d{1,2})?$/.test(raw) ? Number(raw) : 0;
    if (!(value > 0 && value <= 10000)) return { ok: false, error: 'Anna kuorma kilogrammoina väliltä 0,01–10 000, esim. 102,5.' };
    return { ok: true, result: { kind, value, ...extra } };
  }
  const value = whole(fields.value, 0, MAX_COUNT);
  if (value === null) return { ok: false, error: `Anna ${VALUE_WORDS[kind]} kokonaislukuna.` };
  return { ok: true, result: { kind, value, ...extra } };
}

// ---- Results over time (computed from history on demand, never stored) ----

// Snapshot of a finished WOD for history: the version on the whiteboard and the score.
export function historyWod(wod) {
  return sanitizeHistoryWod({ id: wod.id, key: wod.key || wodKey(wod), name: wodTitle(wod), format: wod.format, score: wod.score,
    board: boardText(wod, wod.result?.division ?? wod.division), result: wod.result });
}

// Logged results of one workout, newest first. A history entry is counted once.
export function wodAttempts(history, key) {
  const seen = new Set(), attempts = [];
  for (const h of history ?? []) {
    if (!h || seen.has(h.id) || !Number.isFinite(h.endedAt)) continue;
    seen.add(h.id);
    for (const w of h.wods ?? []) {
      if (w?.key === key && w.result) attempts.push({ at: h.endedAt, sessionId: h.id, name: w.name, board: w.board, result: w.result });
    }
  }
  return attempts.sort((a, b) => b.at - a.at);
}

export const previousResult = (history, key) => wodAttempts(history, key)[0] ?? null;

// Best result per division; the first time a best was reached wins a tie.
function bestOf(attempts) {
  const best = { rx: null, scaled: null };
  for (const a of attempts) {
    if (a.result.kind === 'none') continue;
    const division = a.result.division === 'scaled' ? 'scaled' : 'rx', current = best[division];
    if (current && current.result.kind !== a.result.kind) continue;
    const diff = current ? compareScores(a.result, current.result) : 1;
    if (diff > 0 || (diff === 0 && a.at < current.at)) best[division] = a;
  }
  return best;
}

export const bestResults = (history, key) => bestOf(wodAttempts(history, key));

// A record needs an earlier comparable result in the same division to beat; the first try is a baseline.
export function isPersonalRecord(history, key, result) {
  if (!result || result.kind === 'none') return false;
  const best = bestResults(history, key)[result.division === 'scaled' ? 'scaled' : 'rx'];
  return !!best && best.result.kind === result.kind && compareScores(result, best.result) > 0;
}

// One row per workout that has results: latest name and board, attempt count and the best per division.
export function wodRecords(history) {
  const groups = new Map(), seen = new Set();
  for (const h of history ?? []) {
    if (!h || seen.has(h.id) || !Number.isFinite(h.endedAt)) continue;
    seen.add(h.id);
    for (const w of h.wods ?? []) {
      if (!w?.key || !w.result) continue;
      if (!groups.has(w.key)) groups.set(w.key, { key: w.key, name: w.name, format: w.format, board: w.board, latestAt: h.endedAt, attempts: [] });
      const group = groups.get(w.key);
      if (h.endedAt > group.latestAt) Object.assign(group, { name: w.name, format: w.format, board: w.board, latestAt: h.endedAt });
      group.attempts.push({ at: h.endedAt, sessionId: h.id, name: w.name, board: w.board, result: w.result });
    }
  }
  return [...groups.values()].map((g) => {
    const attempts = g.attempts.sort((a, b) => b.at - a.at);
    return { ...g, attempts, best: bestOf(attempts) };
  }).sort((a, b) => a.name.localeCompare(b.name, 'fi-FI') || b.latestAt - a.latestAt);
}