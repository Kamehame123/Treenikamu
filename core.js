// Pure logic: no DOM access. Shared by the app and the tests.
//
// DATA COMPATIBILITY RULES (read before changing the saved shape)
// - Additive change (new optional field/setting): add it to normalizeState with a default.
//   Old data and old backups lack it and simply receive the default. No version bump.
// - Per-set targets are additive: routine.setReps defaults to null (shared reps), and
//   session sets may have their own reps. Existing records and storage keys are unchanged.
// - Breaking change (rename, move, change meaning/type): bump SCHEMA by 1 and add
//   MIGRATIONS[oldVersion] = (data) => newData. Migrations are pure, run in order from the
//   data's own version, and are NEVER edited or removed once released. Old backups of any
//   version therefore keep importing.
// - Backups are wrapped in an envelope (format/formatVersion/exportedAt/data). Only bump
//   BACKUP_VERSION if the envelope itself changes; then keep reading the older envelopes.
// - Files from a newer app version are refused, never guessed at.
import { CATEGORIES, EQUIPMENT, normalizeSearch } from './exercises.js';
import { progressionConfig, targetReps, recommendedRestSeconds, classifyExercise, automaticWeightStep, parseWeight } from './progression.js';
import { sanitizeTracking, sanitizeIndex, exerciseKey } from './statistics.js';
export { recommendedRestSeconds, classifyExercise, automaticWeightStep };

export const STORAGE_KEY = 'gym-tracker-v1';
export const SCHEMA = 1;
export const MAX_SETS = 20;
export const MAX_CUSTOM_EXERCISES = 500;
export const BACKUP_FORMAT = 'gym-tracker-backup';
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
const MAX_ROUTINES = 100;
export const MAX_HISTORY = 10000;

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
  const ex = (name, sets, reps, weight = '') => ({ id: uid(), name, sets, reps, weight, setReps: null });
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
        autoProgress: false,
      },
    ],
    session: null,
    history: [],
    customExercises: [],
    settings: { restSeconds: 90, autoRest: true, advancedLogging: false },
    restEnd: null,
  };
}

// Defensive normalisation: corrupt or older data must never crash the app.
function sanitizeTargets(e) {
  const sets = clampInt(e?.sets, 1, MAX_SETS, 3);
  const reps = cleanText(e?.reps, 20) || '10';
  return {
    sets, reps,
    weight: cleanText(e?.weight, 20),
    setReps: Array.isArray(e?.setReps) ? Array.from({ length: sets }, (_, i) => cleanText(e.setReps[i], 20) || reps) : null,
  };
}

function sanitizeProgression(e) {
  const config = progressionConfig(e);
  if (e.progression.minReps === undefined) delete config.minReps;
  if (e.progression.maxReps === undefined) delete config.maxReps;
  return config;
}

function sanitizeExercises(raw) {
  const exercises = (Array.isArray(raw) ? raw : [])
    .slice(0, 60)
    .map((e) => {
      return {
        id: cleanText(e?.id, 80) || uid(),
        name: cleanText(e?.name),
        ...sanitizeTargets(e),
        ...(sanitizeTracking(e?.tracking) ? { tracking: sanitizeTracking(e.tracking) } : {}),
        ...(e?.progression ? { progression: sanitizeProgression(e) } : {}),
        ...(e?.recoveryBase ? { recoveryBase: sanitizeTargets(e.recoveryBase) } : {}),
      };
    })
    .filter((e) => e.name);
  return uniqueIds(exercises);
}

export function sanitizeRoutine(r) {
  const revision = r?.revision;
  return {
    id: cleanText(r?.id, 80) || uid(), name: cleanText(r?.name) || 'Harjoitus',
    exercises: sanitizeExercises(r?.exercises),
    autoProgress: r?.autoProgress === true,
    ...(revision && Array.isArray(revision.before) && Array.isArray(revision.after) ? {
      revision: {
        sourceId: cleanText(revision.sourceId, 80),
        createdAt: timestamp(revision.createdAt, 0),
        before: sanitizeExercises(revision.before),
        after: sanitizeExercises(revision.after),
        undone: revision.undone === true,
        changes: (Array.isArray(revision.changes) ? revision.changes : []).slice(0, 60).map((change) => ({
          exerciseId: cleanText(change?.exerciseId, 80), name: cleanText(change?.name),
          kind: cleanText(change?.kind, 20), before: cleanText(change?.before, 500),
          after: cleanText(change?.after, 500), reason: cleanText(change?.reason, 1000),
        })),
      },
    } : {}),
  };
}

export function sanitizeSession(s) {
  if (!s || !Array.isArray(s.exercises) || !s.exercises.length) return null;
  return {
    id: cleanText(s.id, 80) || uid(),
    routineId: cleanText(s.routineId, 80),
    name: cleanText(s.name) || 'Harjoitus',
    startedAt: timestamp(s.startedAt, Date.now()),
    ...(s.fatigued === true ? { fatigued: true } : {}),
    exercises: uniqueIds(s.exercises.slice(0, 60).map((e) => ({
      id: cleanText(e?.id, 80) || uid(),
      name: cleanText(e?.name) || 'Liike',
      reps: cleanText(e?.reps, 20) || '10',
      weight: cleanText(e?.weight, 20),
      ...(sanitizeTracking(e?.tracking) ? { tracking: sanitizeTracking(e.tracking) } : {}),
      ...(Number(e?.weightStep) >= 0.01 && Number(e.weightStep) <= 100 ? { weightStep: Number(e.weightStep) } : {}),
      ...(cleanText(e?.rir, 20) ? { rir: cleanText(e.rir, 20) } : {}),
      ...(e?.pain === true ? { pain: true } : {}),
      ...(e?.deload === true ? { deload: true } : {}),
      sets: (Array.isArray(e?.sets) && e.sets.length ? e.sets : [{}]).slice(0, MAX_SETS).map((x) => ({
        done: x?.done === true,
        ...(cleanText(x?.reps, 20) ? { reps: cleanText(x.reps, 20) } : {}),
        ...(cleanText(x?.actualReps, 20) ? { actualReps: cleanText(x.actualReps, 20) } : {}),
        ...(cleanText(x?.actualWeight, 20) ? { actualWeight: cleanText(x.actualWeight, 20) } : {}),
        ...(['working', 'warmup'].includes(x?.kind) ? { kind: x.kind } : {}),
        ...(cleanText(x?.setRir, 20) ? { setRir: cleanText(x.setRir, 20) } : {}),
        ...(cleanText(x?.actualSeconds, 20) ? { actualSeconds: cleanText(x.actualSeconds, 20) } : {}),
      })),
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
    ...(sanitizeIndex(raw.statistics) ? { statistics: sanitizeIndex(raw.statistics) } : {}),
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
        ...(typeof h.routineId === 'string' ? { routineId: cleanText(h.routineId, 80) } : {}),
        ...(h.fatigued === true ? { fatigued: true } : {}),
        ...(timestamp(h.editedAt, 0) ? { editedAt: timestamp(h.editedAt, 0) } : {}),
        ...(Array.isArray(h.exercises) && h.exercises.length ? { exercises: sanitizeSession({ ...h, exercises: h.exercises }).exercises } : {}),
      })),
    settings: {
      restSeconds: clampInt(raw.settings?.restSeconds, 10, 600, 90),
      autoRest: raw.settings?.autoRest !== false,
      advancedLogging: raw.settings?.advancedLogging === true,
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
  if (typeof text !== 'string' || text.length > MAX_BACKUP_BYTES) return fail('Varmuuskopiotiedosto on liian suuri (enintään 50 Mt).');
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

const CORE_KEYS = ['v', 'routines', 'history', 'settings', 'session', 'restEnd', 'customExercises', 'statistics'];
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Adds what the backup has and this device lacks. Safe to repeat: re-importing the same
// file changes nothing. A workout that exists on both sides under one id but differs is
// kept as an extra copy rather than overwriting either version.
export function mergeState(local, incoming) {
  const next = structuredClone(local);
  const result = { routines: 0, history: 0, skipped: 0, session: false };
  const byId = new Map(next.routines.map((r) => [r.id, r]));
  const routineLinks = new Map();
  for (const r of incoming.routines) {
    const existing = byId.get(r.id);
    if (existing && sameJson(existing, r)) continue;
    const importedName = cleanText(`${r.name} (tuotu)`);
    const priorCopy = existing && next.routines.find((candidate) => candidate.name === importedName && sameJson({ ...candidate, id: r.id, name: r.name }, r));
    if (priorCopy) { routineLinks.set(r.id, priorCopy.id); continue; }
    if (next.routines.length >= MAX_ROUTINES) { result.skipped++; continue; }
    const copy = existing ? { ...r, id: uid(), name: importedName } : r;
    routineLinks.set(r.id, copy.id);
    next.routines.push(copy); byId.set(copy.id, copy); result.routines++;
  }
  const seen = new Set(next.history.map((h) => h.id));
  const added = incoming.history.filter((h) => !seen.has(h.id)).map((h) =>
    routineLinks.has(h.routineId) ? { ...h, routineId: routineLinks.get(h.routineId) } : h);
  next.history = [...next.history, ...added].sort((a, b) => b.endedAt - a.endedAt).slice(0, MAX_HISTORY);
  if (!next.statistics && incoming.statistics) {
    const keys = new Map();
    for (const h of incoming.history) {
      for (const e of h.exercises ?? []) keys.set(exerciseKey(e, h.routineId), exerciseKey(e, routineLinks.get(h.routineId) ?? h.routineId));
    }
    next.statistics = { ...structuredClone(incoming.statistics),
      benchmarks: incoming.statistics.benchmarks.map((b) => ({ ...b, key: keys.get(b.key) ?? b.key })) };
  }
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
  if (!next.session && incoming.session) {
    next.session = structuredClone(incoming.session);
    if (routineLinks.has(next.session.routineId)) next.session.routineId = routineLinks.get(next.session.routineId);
    next.restEnd = null; result.session = true;
  }
  return { state: next, result };
}

// Makes everything except a running workout match the backup. Keeps this device's plans if
// the backup has none, so the app never ends up with zero workouts.
export function replaceState(local, incoming) {
  const next = structuredClone(local);
  if (!incoming.statistics) delete next.statistics;
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

// 'newer': written by a newer app version. 'unreadable': stored text that cannot be parsed
// into a record. Either way the saved bytes must never be overwritten by this app.
export function storageProblem(text) {
  if (typeof text !== 'string' || !text) return null;
  let raw;
  try { raw = JSON.parse(text); } catch { return 'unreadable'; }
  if (raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return 'unreadable';
  return Number(raw.v) > SCHEMA ? 'newer' : null;
}

// Returns false when persistence fails (quota / private mode) so the UI can warn.
export function saveState(storage, state) {
  try {
    if (storageProblem(storage.getItem?.(STORAGE_KEY))) return false;
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
      ...(e.tracking ? { tracking: structuredClone(e.tracking) } : {}),
      ...(e.progression?.weightStep !== undefined ? { weightStep: progressionConfig(e).weightStep } : {}),
      ...(e.recoveryBase ? { deload: true } : {}),
      sets: Array.from({ length: e.sets }, (_, i) => ({
        done: false,
        ...(e.tracking ? { kind: 'working' } : {}),
        ...(e.setReps ? { reps: e.setReps[i] } : {}),
      })),
    })),
  };
}

export function toggleSet(session, ei, si) {
  const set = session?.exercises[ei]?.sets[si];
  if (!set) return false;
  set.done = !set.done;
  return set.done;
}

export function setRepCount(exercise, set) {
  const target = targetReps(set?.reps ?? exercise?.reps);
  if (!target) return null;
  if (set?.actualReps === undefined) return target.high;
  const value = String(set.actualReps);
  return /^\d+$/.test(value) && Number(value) <= 100 ? Number(value) : null;
}

export function adjustSetReps(session, ei, si, delta) {
  const exercise = session?.exercises[ei], set = exercise?.sets[si];
  if (!set) return { ok: false, error: 'Kirjattavaa sarjaa ei enää löytynyt. Tarkista harjoitus.' };
  const count = setRepCount(exercise, set);
  if (count === null || (delta !== -1 && delta !== 1)) {
    return { ok: false, error: 'Pikamuutos vaatii numeerisen toistotavoitteen ja kelvolliset toteutuneet toistot. Tarkista tulokset.' };
  }
  const reps = count + delta;
  if (reps < 0 || reps > 100) return { ok: false, error: 'Toteutuneiden toistojen on oltava välillä 0–100.' };
  set.actualReps = String(reps);
  return { ok: true, reps };
}

// Weight a set is logged at, in kg; an empty plan means 0 and null means not numeric.
export function setWeightValue(exercise, set) {
  const text = String(set?.actualWeight || exercise?.weight || '').trim();
  return text === '' ? 0 : parseWeight(text);
}

// Step of the +/- weight buttons: the routine's saved step, else one derived from the planned weight.
// It never depends on the logged weight, so the button size stays the same while tapping.
export function weightStepFor(exercise) {
  const saved = Number(exercise?.weightStep);
  return saved >= 0.01 && saved <= 100 ? saved : automaticWeightStep(exercise);
}

function writeSetWeight(exercise, set, weight) {
  if (weight === (String(exercise.weight ?? '').trim() === '' ? 0 : parseWeight(exercise.weight))) delete set.actualWeight;
  else set.actualWeight = String(weight).replace('.', ',');
}

// Moves the logged weight one step up or down (direction -1 or 1); landing on the planned weight clears the override.
export function adjustSetWeight(session, ei, si, direction) {
  const exercise = session?.exercises[ei], set = exercise?.sets[si];
  if (!set) return { ok: false, error: 'Kirjattavaa sarjaa ei enää löytynyt. Tarkista harjoitus.' };
  const current = setWeightValue(exercise, set);
  if (current === null || (direction !== -1 && direction !== 1)) {
    return { ok: false, error: 'Pikamuutos vaatii painon kilogrammoina (esim. 22,5). Tarkista paino.' };
  }
  const raw = Math.round((current + direction * weightStepFor(exercise) + Number.EPSILON) * 100) / 100;
  const weight = direction < 0 && current > 0 ? Math.max(0, raw) : raw;
  if (weight < 0 || weight > 10000) return { ok: false, error: 'Painon on oltava välillä 0–10 000 kg.' };
  writeSetWeight(exercise, set, weight);
  return { ok: true, weight };
}

// Typed weight (e.g. 97,5 or 105 kg) for one set; an empty field returns to the planned weight.
export function setSetWeight(session, ei, si, text) {
  const exercise = session?.exercises[ei], set = exercise?.sets[si];
  if (!set) return { ok: false, error: 'Kirjattavaa sarjaa ei enää löytynyt. Tarkista harjoitus.' };
  const raw = String(text ?? '').trim();
  if (raw === '') { delete set.actualWeight; return { ok: true, weight: setWeightValue(exercise, set) }; }
  const parsed = /^\d+(?:[.,]\d+)?$/.test(raw) ? parseWeight(raw) : null;
  if (parsed === null) return { ok: false, error: 'Anna paino kilogrammoina väliltä 0–10 000, esim. 22,5.' };
  const weight = Math.round((parsed + Number.EPSILON) * 100) / 100;
  writeSetWeight(exercise, set, weight);
  return { ok: true, weight };
}

// Typed rep count (0–100) for one set.
export function setSetReps(session, ei, si, text) {
  const exercise = session?.exercises[ei], set = exercise?.sets[si];
  if (!set) return { ok: false, error: 'Kirjattavaa sarjaa ei enää löytynyt. Tarkista harjoitus.' };
  const raw = String(text ?? '').trim();
  if (!/^\d+$/.test(raw) || Number(raw) > 100) return { ok: false, error: 'Anna toistot kokonaislukuna väliltä 0–100.' };
  set.actualReps = String(Number(raw));
  return { ok: true, reps: Number(raw) };
}

export function addSet(session, ei) {
  const e = session?.exercises[ei];
  if (e && e.sets.length < MAX_SETS) {
    const reps = e.sets.at(-1)?.reps;
    e.sets.push({ done: false, ...(e.tracking ? { kind: 'working' } : {}), ...(reps ? { reps } : {}) });
  }
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
  const snapshot = sanitizeSession(session);
  return {
    id: session.id, name: session.name, startedAt: session.startedAt, endedAt: now,
    setsDone: done, setsTotal: total, routineId: session.routineId,
    exercises: snapshot.exercises,
    ...(snapshot.fatigued ? { fatigued: true } : {}),
  };
}

// ---- Completed workouts: delete and correct (always on a transaction copy of the state) ----

const NOT_FOUND = { ok: false, error: 'Harjoitusta ei löytynyt. Näkymä on päivitetty.' };

export function deleteHistoryEntry(state, id) {
  const index = state.history.findIndex((h) => h.id === id);
  if (index < 0) return NOT_FOUND;
  const [entry] = state.history.splice(index, 1);
  return { ok: true, entry, index };
}

// Puts a just-deleted workout back where it was; never overwrites an existing record.
export function restoreHistoryEntry(state, entry, index) {
  if (!entry || state.history.some((h) => h.id === entry.id)) return { ok: false, error: 'Harjoitus on jo palautettu.' };
  if (state.history.length >= MAX_HISTORY) return { ok: false, error: 'Historia on täynnä. Poista vanhoja harjoituksia ensin.' };
  state.history.splice(Math.min(Math.max(0, index), state.history.length), 0, entry);
  return { ok: true };
}

// Corrects one logged set of a completed workout. An empty reps or weight means unknown/planned.
export function editHistorySet(state, id, ei, si, field, value, now = Date.now()) {
  const entry = state.history.find((h) => h.id === id);
  if (!entry) return NOT_FOUND;
  const exercise = entry.exercises?.[ei], set = exercise?.sets[si];
  if (!set) return { ok: false, error: 'Sarjaa ei löytynyt.' };
  const raw = typeof value === 'string' ? value.trim() : value;
  if (field === 'done') set.done = raw === true;
  else if (field === 'actualReps') {
    if (raw === '') delete set.actualReps;
    else if (!/^\d+$/.test(raw) || Number(raw) > 100) return { ok: false, error: 'Anna toistot kokonaislukuna väliltä 0–100.' };
    else set.actualReps = String(Number(raw));
  } else if (field === 'actualWeight') {
    if (raw === '') delete set.actualWeight;
    else if (!/^\d+(?:[.,]\d+)?$/.test(raw) || parseWeight(raw) === null) return { ok: false, error: 'Anna paino kilogrammoina väliltä 0–10 000, esim. 22,5.' };
    else writeSetWeight(exercise, set, Math.round((parseWeight(raw) + Number.EPSILON) * 100) / 100);
  } else return { ok: false, error: 'Tätä kenttää ei voi muokata.' };
  entry.setsDone = entry.exercises.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0);
  entry.editedAt = now;
  return { ok: true };
}

// A forgotten finish makes a workout look hours long; the end can only be moved earlier.
export function shortenHistoryDuration(state, id, minutes, now = Date.now()) {
  const entry = state.history.find((h) => h.id === id);
  if (!entry) return NOT_FOUND;
  const text = String(minutes ?? '').trim();
  const length = Number(text) * 60000;
  if (!entry.startedAt || !/^\d+$/.test(text) || length < 60000 || length >= entry.endedAt - entry.startedAt) {
    return { ok: false, error: 'Kestoa voi vain lyhentää: anna kokonaisia minuutteja, vähintään 1 ja alle nykyisen keston.' };
  }
  entry.endedAt = entry.startedAt + length;
  entry.editedAt = now;
  return { ok: true };
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
    if (e?.progression) {
      const config = progressionConfig(e);
      const minReps = e.progression.minReps ?? config.minReps;
      const maxReps = e.progression.maxReps ?? config.maxReps;
      const weightStep = e.progression.weightStep ?? config.weightStep;
      if (!Number.isInteger(Number(minReps)) || !Number.isInteger(Number(maxReps)) || Number(minReps) < 1 || Number(maxReps) > 30 || Number(minReps) > Number(maxReps)) errors.push(`Liike ${i + 1}: kehitysalueen on oltava 1–30 toistoa, alaraja enintään yläraja.`);
      if (!Number.isFinite(Number(weightStep)) || Number(weightStep) < 0.01 || Number(weightStep) > 100) errors.push(`Liike ${i + 1}: painoaskeleen on oltava 0,01–100 kg.`);
    }
    if (Array.isArray(e?.setReps)) {
      for (let si = 0; si < clampInt(e.sets, 1, MAX_SETS, 3); si++) {
        if (!cleanText(e.setReps[si], 20)) errors.push(`Liike ${i + 1}, sarja ${si + 1}: lisää toistotavoite tai kesto.`);
      }
    }
  }
  return errors;
}

export const targetLabel = (target) => /\b(?:s|sec|secs|seconds?|sek\w*|min\w*)\b/i.test(target) ? String(target) : `${target} toistoa`;

export function setTargetLabel(target, weight = '') {
  const value = cleanText(weight, 20);
  if (!value) return targetLabel(target);
  const label = /^\d+(?:[.,]\d+)?$/.test(value) ? `${value}kg` : value.replace(/\s+kg\b/gi, 'kg');
  return `${target} x ${label}`;
}
