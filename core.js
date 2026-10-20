// Pure logic: no DOM access. Shared by the app and the tests.
//
// DATA COMPATIBILITY RULES (read before changing the saved shape)
// - Additive change (new optional field/setting): add it to normalizeState with a default.
//   Old data and old backups lack it and simply receive the default. No version bump.
// - Breaking change (rename, move, change meaning/type): bump SCHEMA by 1 and add
//   MIGRATIONS[oldVersion] = (data) => newData. Migrations are pure, run in order from the
//   data's own version, and are NEVER edited or removed once released. Old backups of any
//   version therefore keep importing.
// - Backups are wrapped in an envelope (format/formatVersion/exportedAt/data). Only bump
//   BACKUP_VERSION if the envelope itself changes; then keep reading the older envelopes.
// - Files from a newer app version are refused, never guessed at.
import { CATEGORIES, EQUIPMENT, normalizeSearch } from './exercises.js';

export const STORAGE_KEY = 'gym-tracker-v1';
export const SCHEMA = 1;
export const MAX_SETS = 20;
export const MAX_CUSTOM_EXERCISES = 500;
export const BACKUP_FORMAT = 'gym-tracker-backup';
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
const MAX_ROUTINES = 100;
const MAX_HISTORY = 100;

// MIGRATIONS[n] upgrades schema n data to schema n + 1. Empty until the first breaking change.
export const MIGRATIONS = {};

export const uid = () =>
  (globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);

export const clampInt = (v, min, max, fallback) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const cleanText = (v, max = 60) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').replace(/\s+/g, ' ').trim().slice(0, max);
const timestamp = (v, fallback) => Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= 8.64e15 ? Number(v) : fallback;
const uniqueIds = (items) => {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) item.id = uid();
    seen.add(item.id);
  }
  return items;
};

export function defaultState() {
  const ex = (name, sets, reps, weight = '') => ({ id: uid(), name, sets, reps, weight });
  return {
    v: SCHEMA,
    routines: [
      {
        id: uid(),
        name: 'Koko keho A',
        exercises: [
          ex('Takakyykky', 3, '5'),
          ex('Penkkipunnerrus', 3, '5'),
          ex('Kulmasoutu tangolla', 3, '8'),
          ex('Pystypunnerrus tangolla', 3, '8'),
          ex('Lankku', 3, '45 s'),
        ],
      },
    ],
    session: null,
    history: [],
    customExercises: [],
    settings: { restSeconds: 90, autoRest: true },
    restEnd: null,
  };
}

// Defensive normalisation: corrupt or older data must never crash the app.
export function sanitizeRoutine(r) {
  const exercises = (Array.isArray(r?.exercises) ? r.exercises : [])
    .slice(0, 60)
    .map((e) => ({
      id: cleanText(e?.id, 80) || uid(),
      name: cleanText(e?.name),
      sets: clampInt(e?.sets, 1, MAX_SETS, 3),
      reps: cleanText(e?.reps, 20) || '10',
      weight: cleanText(e?.weight, 20),
    }))
    .filter((e) => e.name);
  return { id: cleanText(r?.id, 80) || uid(), name: cleanText(r?.name) || 'Harjoitus', exercises: uniqueIds(exercises) };
}

export function sanitizeSession(s) {
  if (!s || !Array.isArray(s.exercises) || !s.exercises.length) return null;
  return {
    id: cleanText(s.id, 80) || uid(),
    routineId: cleanText(s.routineId, 80),
    name: cleanText(s.name) || 'Harjoitus',
    startedAt: timestamp(s.startedAt, Date.now()),
    exercises: uniqueIds(s.exercises.slice(0, 60).map((e) => ({
      id: cleanText(e?.id, 80) || uid(),
      name: cleanText(e?.name) || 'Liike',
      reps: cleanText(e?.reps, 20) || '10',
      weight: cleanText(e?.weight, 20),
      sets: (Array.isArray(e?.sets) && e.sets.length ? e.sets : [{}]).slice(0, MAX_SETS).map((x) => ({ done: x?.done === true })),
    }))),
  };
}

export function sanitizeCustomExercises(raw) {
  const seen = new Set();
  return uniqueIds((Array.isArray(raw) ? raw : []).slice(0, MAX_CUSTOM_EXERCISES).map((e) => ({
    id: cleanText(e?.id, 80) || `own-${uid()}`,
    name: cleanText(e?.name),
    category: CATEGORIES.includes(e?.category) ? e.category : 'Koko keho',
    equipment: EQUIPMENT.includes(e?.equipment) ? e.equipment : 'Muu väline',
    reps: cleanText(e?.reps, 20) || '10',
  })).filter((e) => {
    const key = `${normalizeSearch(e.name)}|${e.equipment}`;
    if (!e.name || seen.has(key)) return false;
    seen.add(key); return true;
  }));
}

// Brings data of any older schema up to `target`. Data without `v` is schema 1 (the first
// export format had no envelope and no guaranteed version). Newer data is returned untouched.
export function migrateData(raw, migrations = MIGRATIONS, target = SCHEMA) {
  let data = structuredClone(raw);
  let v = Number.isInteger(data?.v) && data.v >= 1 ? data.v : 1;
  while (v < target) {
    const step = migrations[v];
    if (typeof step !== 'function') throw new Error(`Tietoversion ${v} päivitys puuttuu.`);
    data = step(data);
    v += 1;
    data.v = v;
  }
  return data;
}

// Normalises without injecting the starter plan, so imports never add a phantom workout.
function normalizeState(raw) {
  const routines = uniqueIds((Array.isArray(raw.routines) ? raw.routines : []).slice(0, MAX_ROUTINES).map(sanitizeRoutine));
  const session = sanitizeSession(raw.session);
  return {
    v: SCHEMA,
    routines,
    session,
    customExercises: sanitizeCustomExercises(raw.customExercises),
    history: (Array.isArray(raw.history) ? raw.history : [])
      .filter((h) => h && typeof h === 'object')
      .slice(0, MAX_HISTORY)
      .map((h) => ({
        id: cleanText(h.id, 80) || uid(),
        name: cleanText(h.name) || 'Harjoitus',
        startedAt: timestamp(h.startedAt, 0),
        endedAt: timestamp(h.endedAt, 0),
        setsDone: clampInt(h.setsDone, 0, 9999, 0),
        setsTotal: clampInt(h.setsTotal, 0, 9999, 0),
      })),
    settings: {
      restSeconds: clampInt(raw.settings?.restSeconds, 10, 600, 90),
      autoRest: raw.settings?.autoRest !== false,
    },
    restEnd: session ? timestamp(raw.restEnd, null) : null,
  };
}

export function sanitizeState(raw) {
  const d = defaultState();
  if (!raw || typeof raw !== 'object') return d;
  const state = normalizeState(migrateData(raw));
  if (!state.routines.length) state.routines = d.routines;
  return state;
}

// ---- Backup: export / import ----

export function buildBackup(state, now = Date.now()) {
  const { restEnd, ...data } = state;
  return { format: BACKUP_FORMAT, formatVersion: BACKUP_VERSION, exportedAt: new Date(now).toISOString(), data };
}

export const backupFileName = (now = Date.now()) => `gym-tracker-${new Date(now).toISOString().slice(0, 10)}.json`;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Accepts the current envelope and the legacy raw-state export. Never throws.
export function parseBackup(text) {
  const fail = (error) => ({ ok: false, error });
  if (typeof text !== 'string' || text.length > MAX_BACKUP_BYTES) return fail('Varmuuskopiotiedosto on liian suuri (enintään 5 Mt).');
  let raw;
  try { raw = JSON.parse(text); } catch { return fail('Tiedosto ei ole kelvollista JSON-muotoa.'); }
  if (!isObject(raw)) return fail('Tiedosto ei ole sovelluksen varmuuskopio.');
  let data, exportedAt = null, legacy = false;
  if (raw.format !== undefined) {
    if (raw.format !== BACKUP_FORMAT || !isObject(raw.data)) return fail('Tiedosto ei ole sovelluksen varmuuskopio.');
    if (!Number.isInteger(raw.formatVersion) || raw.formatVersion < 1) return fail('Varmuuskopion tiedostoversio on virheellinen.');
    if (raw.formatVersion > BACKUP_VERSION) return fail('Varmuuskopio on tehty uudemmalla sovelluksella. Päivitä sovellus ja yritä uudelleen.');
    data = raw.data;
    exportedAt = typeof raw.exportedAt === 'string' && Number.isFinite(Date.parse(raw.exportedAt)) ? raw.exportedAt : null;
  } else if (Array.isArray(raw.routines) || Array.isArray(raw.history)) {
    data = raw; legacy = true;
  } else return fail('Tiedosto ei ole sovelluksen varmuuskopio.');
  const fromVersion = data.v === undefined ? 1 : data.v;
  if (!Number.isInteger(fromVersion) || fromVersion < 1) return fail('Varmuuskopion tietoversio on virheellinen.');
  if (fromVersion > SCHEMA) return fail('Varmuuskopion tiedot ovat uudemmasta sovelluksesta. Päivitä sovellus ja yritä uudelleen.');
  try {
    const state = normalizeState(migrateData(data));
    return { ok: true, state, meta: { exportedAt, legacy, fromVersion } };
  } catch {
    return fail('Varmuuskopiota ei voitu päivittää nykyiseen versioon.');
  }
}

const CORE_KEYS = ['v', 'routines', 'history', 'settings', 'session', 'restEnd', 'customExercises'];
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Adds what the backup has and this device lacks. Safe to repeat: re-importing the same
// file changes nothing. A workout that exists on both sides under one id but differs is
// kept as an extra copy rather than overwriting either version.
export function mergeState(local, incoming) {
  const next = structuredClone(local);
  const result = { routines: 0, history: 0, skipped: 0, session: false };
  const byId = new Map(next.routines.map((r) => [r.id, r]));
  for (const r of incoming.routines) {
    const existing = byId.get(r.id);
    if (existing && sameJson(existing, r)) continue;
    if (next.routines.length >= MAX_ROUTINES) { result.skipped++; continue; }
    const copy = existing ? { ...r, id: uid(), name: cleanText(`${r.name} (tuotu)`) } : r;
    next.routines.push(copy); byId.set(copy.id, copy); result.routines++;
  }
  const seen = new Set(next.history.map((h) => h.id));
  const added = incoming.history.filter((h) => !seen.has(h.id));
  next.history = [...next.history, ...added].sort((a, b) => b.endedAt - a.endedAt).slice(0, MAX_HISTORY);
  const kept = new Set(next.history.map((h) => h.id));
  result.history = added.filter((h) => kept.has(h.id)).length;
  const ownIds = new Set((next.customExercises ?? []).map((e) => e.id));
  next.customExercises = sanitizeCustomExercises([
    ...(next.customExercises ?? []),
    ...(incoming.customExercises ?? []).filter((e) => !ownIds.has(e.id)),
  ]);
  // Any other saved list of records (added by future features) is merged by id; local wins.
  for (const key of Object.keys(incoming).filter((k) => !CORE_KEYS.includes(k) && Array.isArray(incoming[k]))) {
    const have = new Set((next[key] ?? []).map((x) => x?.id));
    next[key] = [...(next[key] ?? []), ...incoming[key].filter((x) => !have.has(x?.id))];
  }
  if (!next.session && incoming.session) { next.session = incoming.session; next.restEnd = null; result.session = true; }
  return { state: next, result };
}

// Makes everything except a running workout match the backup. Keeps this device's plans if
// the backup has none, so the app never ends up with zero workouts.
export function replaceState(local, incoming) {
  const next = structuredClone(local);
  for (const key of Object.keys(incoming).filter((k) => !['v', 'session', 'restEnd'].includes(k))) next[key] = incoming[key];
  if (!next.routines.length) next.routines = structuredClone(local.routines);
  const result = { routines: next.routines.length, history: next.history.length, skipped: 0, session: false };
  if (!next.session && incoming.session) { next.session = incoming.session; next.restEnd = null; result.session = true; }
  return { state: next, result };
}

export function loadState(storage) {
  try {
    const txt = storage.getItem(STORAGE_KEY);
    return txt ? sanitizeState(JSON.parse(txt)) : defaultState();
  } catch {
    return defaultState();
  }
}

export function hasNewerSchema(text) {
  try { return Number(JSON.parse(text)?.v) > SCHEMA; }
  catch { return false; }
}

// Returns false when persistence fails (quota / private mode) so the UI can warn.
export function saveState(storage, state) {
  try {
    if (hasNewerSchema(storage.getItem?.(STORAGE_KEY))) return false;
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function startSession(routine, now = Date.now()) {
  const r = sanitizeRoutine(routine);
  if (!r.exercises.length) return null;
  return {
    id: uid(),
    routineId: r.id,
    name: r.name,
    startedAt: now,
    exercises: r.exercises.map((e) => ({
      id: e.id,
      name: e.name,
      reps: e.reps,
      weight: e.weight,
      sets: Array.from({ length: e.sets }, () => ({ done: false })),
    })),
  };
}

export function toggleSet(session, ei, si) {
  const set = session?.exercises[ei]?.sets[si];
  if (!set) return false;
  set.done = !set.done;
  return set.done;
}

export function addSet(session, ei) {
  const e = session?.exercises[ei];
  if (e && e.sets.length < MAX_SETS) e.sets.push({ done: false });
}

// Removes the last set; only allowed if more than one remains.
export function removeSet(session, ei) {
  const e = session?.exercises[ei];
  if (e && e.sets.length > 1) e.sets.pop();
}

export function progress(session) {
  let done = 0, total = 0;
  for (const e of session?.exercises ?? []) {
    total += e.sets.length;
    done += e.sets.filter((s) => s.done).length;
  }
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

export const exerciseDone = (e) => e.sets.length > 0 && e.sets.every((s) => s.done);

// Index of the first exercise that still has unchecked sets, or -1.
export const currentExercise = (session) => session.exercises.findIndex((e) => !exerciseDone(e));

export function summarize(session, now = Date.now()) {
  const { done, total } = progress(session);
  return { id: session.id, name: session.name, startedAt: session.startedAt, endedAt: now, setsDone: done, setsTotal: total };
}

export function formatDuration(ms) {
  const s = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`;
}

export function validateRoutine(r) {
  const errors = [];
  if (!cleanText(r?.name)) errors.push('Anna harjoitukselle nimi.');
  const exercises = Array.isArray(r?.exercises) ? r.exercises : [];
  if (!exercises.length) errors.push('Lisää vähintään yksi nimetty liike.');
  for (const [i, e] of exercises.entries()) {
    if (!cleanText(e?.name)) errors.push(`Liike ${i + 1}: lisää nimi.`);
    if (!Number.isInteger(Number(e?.sets)) || Number(e?.sets) < 1 || Number(e?.sets) > MAX_SETS) errors.push(`Liike ${i + 1}: sarjojen määrän on oltava kokonaisluku 1–${MAX_SETS}.`);
    if (!cleanText(e?.reps, 20)) errors.push(`Liike ${i + 1}: lisää toistotavoite tai kesto.`);
  }
  return errors;
}

export const targetLabel = (target) => /\b(?:s|sec|secs|seconds?|sek\w*|min\w*)\b/i.test(target) ? String(target) : `${target} toistoa`;
