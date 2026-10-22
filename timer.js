// Interval timer: saved sequences of timed intervals that repeat. Pure helpers, no DOM.
// A sequence is { id, name, repeats, intervals: [{ id, label, seconds }] }.

export const TIMER_MAX_SEQUENCES = 50;
export const TIMER_MAX_INTERVALS = 30;
export const TIMER_MAX_REPEATS = 99;
export const TIMER_MAX_SECONDS = 10800;

const newId = () => globalThis.crypto?.randomUUID?.() ?? `t-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const text = (v, max) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').replace(/\s+/g, ' ').trim().slice(0, max);
const int = (v, min, max, fallback) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

// Lowest unused "Sarja N", so deleting Sarja 2 lets the next unnamed sequence take its place.
export function defaultTimerName(timers) {
  const used = new Set((timers ?? []).map((t) => t.name));
  let n = 1;
  while (used.has(`Sarja ${n}`)) n++;
  return `Sarja ${n}`;
}

// Normalises stored or imported sequences; unusable intervals and sequences are dropped, never coerced.
export function sanitizeTimers(raw) {
  const seen = new Set();
  const timers = [];
  for (const t of (Array.isArray(raw) ? raw : []).slice(0, TIMER_MAX_SEQUENCES)) {
    if (!t || typeof t !== 'object') continue;
    const intervalIds = new Set();
    const intervals = (Array.isArray(t.intervals) ? t.intervals : []).slice(0, TIMER_MAX_INTERVALS).flatMap((i) => {
      const seconds = Math.floor(Number(i?.seconds));
      if (!Number.isFinite(seconds) || seconds < 1 || seconds > TIMER_MAX_SECONDS) return [];
      let id = text(i?.id, 80) || newId();
      if (intervalIds.has(id)) id = newId();
      intervalIds.add(id);
      return [{ id, label: text(i?.label, 60), seconds }];
    });
    if (!intervals.length) continue;
    let id = text(t.id, 80) || newId();
    if (seen.has(id)) id = newId();
    seen.add(id);
    timers.push({ id, name: text(t.name, 60), repeats: int(t.repeats, 1, TIMER_MAX_REPEATS, 1), intervals });
  }
  for (const t of timers) if (!t.name) t.name = defaultTimerName(timers);
  return timers;
}

// Työ / Lepo quick-add intervals. The factory durations can be replaced per device with "Tee oletus".
export const TIMER_PRESETS = { work: { label: 'Työ', seconds: 30 }, rest: { label: 'Lepo', seconds: 15 } };

// Which preset an interval label stands for (case-insensitive), or null.
export function presetKind(label) {
  const l = text(label, 60).toLowerCase();
  return l === TIMER_PRESETS.work.label.toLowerCase() ? 'work' : l === TIMER_PRESETS.rest.label.toLowerCase() ? 'rest' : null;
}

// Stored preset durations; anything unusable is dropped so the factory value applies.
export function sanitizeDefaults(raw) {
  const out = {};
  for (const kind of Object.keys(TIMER_PRESETS)) {
    const n = raw?.[kind];
    if (Number.isInteger(n) && n >= 1 && n <= TIMER_MAX_SECONDS) out[kind] = n;
  }
  return out;
}

export const presetSeconds = (defaults, kind) => sanitizeDefaults(defaults)[kind] ?? TIMER_PRESETS[kind].seconds;

export const intervalLabel = (timer, index) => timer.intervals[index].label || `Intervalli ${index + 1}`;
export const totalSeconds = (timer) => timer.repeats * timer.intervals.reduce((sum, i) => sum + i.seconds, 0);

// Where a run is after `elapsedMs` of running time (paused time excluded). Works from elapsed time, not
// from counting ticks, so throttled background timers cannot make it drift.
export function phaseAt(timer, elapsedMs) {
  const roundMs = timer.intervals.reduce((sum, i) => sum + i.seconds, 0) * 1000;
  const totalMs = roundMs * timer.repeats;
  const elapsed = Math.max(0, elapsedMs);
  if (elapsed >= totalMs) {
    return { done: true, round: timer.repeats, index: timer.intervals.length - 1, remainingMs: 0 };
  }
  const round = Math.floor(elapsed / roundMs);
  let inRound = elapsed - round * roundMs;
  for (let index = 0; index < timer.intervals.length; index++) {
    const length = timer.intervals[index].seconds * 1000;
    if (inRound < length) return { done: false, round: round + 1, index, remainingMs: length - inRound };
    inRound -= length;
  }
  return { done: true, round: timer.repeats, index: timer.intervals.length - 1, remainingMs: 0 };
}

// A run is { id, startedAt, pausedAt (or null), pausedMs }.
export const runElapsed = (run, now) => (run.pausedAt ?? now) - run.startedAt - run.pausedMs;

export function sanitizeRun(raw, timers) {
  if (!raw || typeof raw !== 'object' || !timers.some((t) => t.id === raw.id)) return null;
  const startedAt = Number(raw.startedAt), pausedMs = Number(raw.pausedMs);
  const pausedAt = raw.pausedAt === null ? null : Number(raw.pausedAt);
  if (![startedAt, pausedMs].every(Number.isFinite) || pausedMs < 0 || (pausedAt !== null && !Number.isFinite(pausedAt))) return null;
  return { id: raw.id, startedAt, pausedAt, pausedMs };
}

// One editor interval (min/sec strings) -> { seconds }, or { error, interval } explaining the first problem.
export function intervalSeconds(i, n) {
  const min = String(i.min).trim() === '' ? 0 : Number(i.min), sec = String(i.sec).trim() === '' ? 0 : Number(i.sec);
  if (!Number.isInteger(min) || !Number.isInteger(sec) || min < 0 || min > 180 || sec < 0 || sec > 59) return { error: `Intervallin ${n + 1} kesto ei kelpaa. Minuutit 0–180 ja sekunnit 0–59.`, interval: n };
  const seconds = min * 60 + sec;
  if (seconds < 1) return { error: `Intervallin ${n + 1} kesto on 0 sekuntia. Anna kesto, esimerkiksi 1 min tai 30 s.`, interval: n };
  if (seconds > TIMER_MAX_SECONDS) return { error: `Intervallin ${n + 1} kesto on liian pitkä. Enintään 3 tuntia (180 min).`, interval: n };
  return { seconds };
}

// Editor draft -> sequence. Returns { error } for the first problem so the form can explain it.
export function buildTimer(draft, timers) {
  const intervals = [];
  for (const [n, i] of draft.intervals.entries()) {
    const parsed = intervalSeconds(i, n);
    if (parsed.error) return parsed;
    intervals.push({ id: i.id, label: text(i.label, 60), seconds: parsed.seconds });
  }
  if (!intervals.length) return { error: 'Lisää vähintään yksi intervalli.' };
  const repeats = Number(String(draft.repeats).trim() || NaN);
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > TIMER_MAX_REPEATS) return { error: `Toistojen määrä on 1–${TIMER_MAX_REPEATS}.`, field: 'repeats' };
  const others = timers.filter((t) => t.id !== draft.id);
  return { timer: { id: draft.id || newId(), name: text(draft.name, 60) || defaultTimerName(others), repeats, intervals } };
}

export const newInterval = (label = '', seconds = 0) => ({ id: newId(), label, min: String(Math.floor(seconds / 60) || ''), sec: String(seconds % 60 || '') });

export function draftFrom(timer) {
  return {
    id: timer.id, name: timer.name, repeats: String(timer.repeats),
    intervals: timer.intervals.map((i) => ({ id: i.id, label: i.label, min: String(Math.floor(i.seconds / 60) || ''), sec: String(i.seconds % 60 || '') })),
  };
}

export const formatClock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const formatLength = (seconds) => {
  const m = Math.floor(seconds / 60), s = seconds % 60;
  return m && s ? `${m} min ${s} s` : m ? `${m} min` : `${s} s`;
};
