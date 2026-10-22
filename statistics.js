import { normalizeSearch, CATEGORIES, EQUIPMENT } from './exercises.js';
import { parseWeight } from './progression.js';

export const LOAD_TYPES = Object.freeze({
  unknown: 'Kuorman merkitys ei tiedossa',
  external: 'Ulkoinen kokonaiskuorma (kg)',
  'per-hand': 'Yhden käsipainon kuorma (kg)',
  bodyweight: 'Kehonpaino',
  assisted: 'Avustus (ei nostettu kuorma)',
  other: 'Muu yksikkö / vastuskuminauha',
});
export const INDEX_VERSION = 1;
export const INDEX_SAMPLES = 3;
export const INDEX_FRESH_DAYS = 28;
const text = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const number = (v, min, max) => String(v ?? '').trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max ? Number(v) : null;
const integer = (v, min, max) => {
  const n = number(v, min, max);
  return Number.isInteger(n) ? n : null;
};
const sum = (items, fn) => items.reduce((total, item) => total + fn(item), 0);
export const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
export const localDateKey = (value) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export function shiftDays(value, days) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return +date;
}
const midnight = (value) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return +date;
};
const monday = (value) => shiftDays(midnight(value), -((new Date(value).getDay() + 6) % 7));

export function sanitizeTracking(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    sourceId: text(raw.sourceId, 100),
    category: CATEGORIES.includes(raw.category) ? raw.category : '',
    equipment: EQUIPMENT.includes(raw.equipment) ? raw.equipment : '',
    loadType: Object.hasOwn(LOAD_TYPES, raw.loadType) ? raw.loadType : 'unknown',
    variant: text(raw.variant, 60),
  };
}

export function libraryTracking(exercise) {
  const equipment = exercise.equipment;
  const loadType = /avustettu/i.test(exercise.name) ? 'assisted' :
    equipment === 'Kehonpaino' ? 'bodyweight' : equipment === 'Käsipainot' ? 'per-hand' :
      ['Levytanko', 'Laite', 'Talja', 'Kahvakuula'].includes(equipment) ? 'external' : 'other';
  return sanitizeTracking({ ...exercise, sourceId: exercise.id, loadType });
}

export function sanitizeIndex(raw) {
  if (!raw || raw.version !== INDEX_VERSION || !Array.isArray(raw.benchmarks) ||
    raw.benchmarks.length < 2 || raw.benchmarks.length > 6 ||
    number(raw.createdAt, 1, 8.64e15) === null) return null;
  const seen = new Set();
  const valid = raw.benchmarks.every((b) => {
    if (!text(b?.key, 600) || seen.has(b.key) || number(b.baseline, 0.001, 1e9) === null ||
      integer(b.rir, 0, 3) === null) return false;
    seen.add(b.key); return true;
  });
  if (!valid) return null;
  const benchmarks = raw.benchmarks.map((b) => ({ key: text(b.key, 600), name: text(b.name, 100), baseline: Number(b.baseline), rir: Number(b.rir) }));
  return { version: INDEX_VERSION, createdAt: Number(raw.createdAt), benchmarks };
}

export function exerciseKey(exercise, routineId = '') {
  const t = exercise.tracking;
  // Keep routine identities: even identical library names can refer to different machines.
  return JSON.stringify([routineId, exercise.id, normalizeSearch(exercise.name),
    t?.sourceId ?? '', t?.equipment ?? '', t?.loadType ?? 'unknown', normalizeSearch(t?.variant ?? '')]);
}

export function estimateStrength(load, reps) {
  if (number(load, 0.001, 10000) === null || integer(reps, 1, 10) === null) return null;
  return reps === 1 ? load : load * (1 + reps / 30);
}

function dateInput(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return localDateKey(date) === value ? +date : null;
}

export function statisticsPeriod(range, now, first, fromInput = '', toInput = '') {
  const today = midnight(now);
  if (range === 'all') return { ok: true, from: first ? midnight(first) : today, to: now + 1, previous: null };
  let from, end, days;
  if (range === 'custom') {
    from = dateInput(fromInput); end = dateInput(toInput);
    if (from === null || end === null || end < from || end > today) {
      return { ok: false, error: 'Valitse kelvollinen alku- ja loppupäivä. Loppupäivä ei saa olla tulevaisuudessa eikä ennen alkua.' };
    }
    days = Math.round((Date.UTC(...fromInput.split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0))) -
      Date.UTC(...toInput.split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0)))) / -86400000) + 1;
  } else {
    days = ({ '4w': 28, '12w': 84, '1y': 365 })[range];
    if (!days) return { ok: false, error: 'Tuntematon tilastojakso.' };
    from = shiftDays(today, 1 - days); end = today;
  }
  const to = Math.min(shiftDays(end, 1), now + 1);
  return { ok: true, from, to, previous: { from: shiftDays(from, -days), to: shiftDays(to, -days) } };
}

// Heaviest kg ever logged per move name (all programs combined) and the latest day it was reached.
// The weight is the set's logged weight, otherwise the move's planned weight.
// Estimated records use actual reps only and compare like equipment/load conventions across programs.
export function buildRecords(history, now = Date.now()) {
  const records = new Map(), estimates = new Map(), fixes = new Map(), seen = new Set();
  for (const h of history ?? []) {
    if (!h || seen.has(h.id)) continue;
    seen.add(h.id);
    if (!Number.isFinite(h.endedAt) || h.endedAt <= 0 || h.endedAt > now) continue;
    for (const e of h.exercises ?? []) {
      const key = normalizeSearch(e.name ?? '');
      if (!key) continue;
      for (const set of e.sets ?? []) {
        if (!set.done) continue;
        const weight = parseWeight(set.actualWeight || e.weight);
        if (weight === null || weight <= 0) continue;
        const current = records.get(key);
        if (!current || weight > current.weight || (weight === current.weight && h.endedAt > current.at)) {
          records.set(key, { key, name: e.name, weight, at: h.endedAt, sessionId: h.id });
        }
        const tracking = e.tracking;
        // Sessions the user can still complete: unknown load meaning, or a fixed-rep target never confirmed.
        const loadType = tracking?.loadType, target = String(set.reps ?? e.reps ?? '').trim();
        const fixable = !['external', 'per-hand', 'bodyweight', 'assisted', 'other'].includes(loadType) ||
          (['external', 'per-hand'].includes(loadType) && set.actualReps === undefined && set.actualSeconds === undefined &&
            /^\d+$/.test(target) && Number(target) > 0);
        const fix = fixes.get(key);
        if (fixable && (!fix || weight > fix.weight || (weight === fix.weight && h.endedAt > fix.at))) {
          fixes.set(key, { weight, at: h.endedAt, sessionId: h.id });
        }
        if (!['external', 'per-hand'].includes(tracking?.loadType) || set.actualSeconds !== undefined ||
          /^\d+(?:[.,]\d+)?\s*(?:s\b|sek|min)/i.test(set.reps ?? e.reps ?? '')) continue;
        const reps = integer(set.actualReps, 1, 10), value = estimateStrength(weight, reps);
        if (value === null) continue;
        const equipment = tracking.equipment ?? '', variant = tracking.variant ?? '';
        const estimateKey = JSON.stringify([key, equipment, loadType, normalizeSearch(variant)]);
        if (!estimates.has(key)) estimates.set(key, new Map());
        const contexts = estimates.get(key), best = contexts.get(estimateKey);
        if (!best || value > best.value || (value === best.value && h.endedAt > best.at)) {
          contexts.set(estimateKey, { key: estimateKey, value, load: weight, reps, at: h.endedAt,
            loadType, equipment, variant, sessionId: h.id });
        }
      }
    }
  }
  return [...records.values()].sort((a, b) => a.name.localeCompare(b.name, 'fi-FI')).map((record) => ({
    ...record, fixSessionId: fixes.get(record.key)?.sessionId ?? '',
    estimates: [...(estimates.get(record.key)?.values() ?? [])].sort((a, b) => a.key.localeCompare(b.key, 'fi-FI')),
  }));
}

function emptyTotals() {
  return { workouts: 0, partial: 0, sets: 0, workingSets: 0, reps: 0, repSets: 0, volume: 0,
    volumeSets: 0, seconds: 0, timedSets: 0, duration: 0, durationSessions: 0, fatigue: 0, pain: 0,
    unclassifiedSets: 0, missingReps: 0, missingLoad: 0, legacy: 0, activeDays: 0 };
}

export function buildStatistics(history, options = {}) {
  const now = options.now ?? Date.now(), seen = new Set(), groups = new Map(), sessions = [];
  let excluded = 0;
  for (const h of history) {
    if (!h || seen.has(h.id)) continue;
    seen.add(h.id);
    if (!Number.isFinite(h.endedAt) || h.endedAt <= 0 || h.endedAt > now ||
      !Number.isFinite(h.startedAt) || h.startedAt <= 0 || h.startedAt > h.endedAt) { excluded++; continue; }
    const rows = [];
    for (const e of h.exercises ?? []) {
      const key = exerciseKey(e, h.routineId), tracking = e.tracking;
      if (!groups.has(key)) groups.set(key, { key, name: e.name, routineId: h.routineId ?? '', routineName: h.name,
        tracking, points: [], observations: [] });
      const row = { key, name: e.name, tracking, sets: 0, workingSets: 0, reps: 0, repSets: 0, volume: 0,
        volumeSets: 0, seconds: 0, timedSets: 0, unclassifiedSets: 0, missingReps: 0, missingLoad: 0,
        pain: e.pain === true, rir: integer(e.rir, 0, 5), maxLoad: null, bestReps: null, estimate: null, efforts: [] };
      const bestByEffort = new Map();
      // One RIR per movement describes its hardest (last) working set; per-set RIR from older records still wins.
      const exerciseRir = integer(e.rir, 0, 5);
      const hasSetRir = (e.sets ?? []).some((s) => integer(s.setRir, 0, 5) !== null);
      let hardestSet = -1;
      if (exerciseRir !== null && !hasSetRir) (e.sets ?? []).forEach((s, i) => { if (s.done && s.kind === 'working') hardestSet = i; });
      for (const [setIndex, set] of (e.sets ?? []).entries()) {
        if (!set.done) continue;
        row.sets++;
        if (set.kind === 'working') row.workingSets++;
        else if (set.kind !== 'warmup') row.unclassifiedSets++;
        const reps = integer(set.actualReps, 0, 100);
        const seconds = number(set.actualSeconds, 0, 86400);
        if (reps !== null) { row.reps += reps; row.repSets++; row.bestReps = Math.max(row.bestReps ?? 0, reps); }
        else if (seconds === null) row.missingReps++;
        if (seconds !== null) { row.seconds += seconds; row.timedSets++; }
        const external = ['external', 'per-hand'].includes(tracking?.loadType);
        const load = external ? parseWeight(set.actualWeight || e.weight) : null;
        if (reps !== null && load !== null) {
          row.volume += load * reps; row.volumeSets++;
          row.maxLoad = Math.max(row.maxLoad ?? 0, load);
        } else if (external) row.missingLoad++;
        const rir = integer(set.setRir, 0, 5) ?? (setIndex === hardestSet ? exerciseRir : null);
        if (rir !== null && set.kind === 'working') row.efforts.push(rir);
        const estimate = external && load !== null && reps !== null ? estimateStrength(load, reps) : null;
        if (estimate !== null && set.kind === 'working' && rir !== null && rir <= 3 && !e.pain && !e.deload && !h.fatigued) {
          bestByEffort.set(rir, Math.max(bestByEffort.get(rir) ?? 0, estimate));
          row.estimate = Math.max(row.estimate ?? 0, estimate);
        }
      }
      if (row.sets) {
        const group = groups.get(key);
        group.points.push({ ...row, sessionId: h.id, at: h.endedAt, fatigued: h.fatigued === true });
        for (const [rir, value] of bestByEffort) group.observations.push({ at: h.endedAt, sessionId: h.id, rir, value });
        rows.push(row);
      }
    }
    const legacy = !h.exercises?.length;
    if (rows.length || (legacy && h.setsDone > 0)) sessions.push({ ...h, rows, legacy });
  }
  sessions.sort((a, b) => a.endedAt - b.endedAt);
  for (const group of groups.values()) {
    group.points.sort((a, b) => a.at - b.at);
    group.observations.sort((a, b) => a.at - b.at || a.sessionId.localeCompare(b.sessionId));
  }
  const period = statisticsPeriod(options.range ?? '12w', now, sessions[0]?.endedAt, options.from, options.to);
  const allGroups = [...groups.values()].filter((g) => g.points.length).sort((a, b) => a.name.localeCompare(b.name, 'fi-FI'));
  const base = { now, groups, allGroups, excluded, period };
  if (!period.ok) return base;
  const matches = (h) => (!options.routineId || h.routineId === options.routineId) &&
    (!options.exerciseKey || h.rows.some((r) => r.key === options.exerciseKey));
  const inPeriod = (h, p) => h.endedAt >= p.from && h.endedAt < p.to && matches(h);
  const selected = sessions.filter((h) => inPeriod(h, period));
  const rowsFor = (h) => h.rows.filter((r) => !options.exerciseKey || r.key === options.exerciseKey);
  const totalsFor = (items) => {
    const totals = emptyTotals(), days = new Set();
    for (const h of items) {
      totals.workouts++; days.add(localDateKey(h.endedAt));
      const completed = h.legacy ? h.setsDone : sum(h.rows, (r) => r.sets);
      const prescribed = h.legacy ? h.setsTotal : sum(h.exercises, (e) => e.sets.length);
      totals.partial += completed < prescribed ? 1 : 0;
      totals.duration += h.endedAt - h.startedAt; totals.durationSessions++;
      totals.fatigue += h.fatigued ? 1 : 0;
      if (h.legacy) { totals.sets += h.setsDone; totals.legacy++; continue; }
      for (const row of rowsFor(h)) {
        for (const key of ['sets', 'workingSets', 'reps', 'repSets', 'volume', 'volumeSets', 'seconds',
          'timedSets', 'unclassifiedSets', 'missingReps', 'missingLoad']) totals[key] += row[key];
        totals.pain += row.pain ? 1 : 0;
      }
    }
    totals.activeDays = days.size;
    return totals;
  };
  const totals = totalsFor(selected);
  const previousTotals = period.previous ? totalsFor(sessions.filter((h) => inPeriod(h, period.previous))) : null;
  const weeks = [], days = [], weekly = new Map(), daily = new Map(), muscles = new Map(), efforts = Array(6).fill(0);
  for (const h of selected) {
    const day = localDateKey(h.endedAt), week = localDateKey(monday(h.endedAt));
    daily.set(day, (daily.get(day) ?? 0) + 1);
    if (!weekly.has(week)) weekly.set(week, { workouts: 0, sets: 0, workingSets: 0, volume: 0, volumeSets: 0 });
    const w = weekly.get(week); w.workouts++;
    if (h.legacy) w.sets += h.setsDone;
    for (const row of rowsFor(h)) {
      w.sets += row.sets; w.workingSets += row.workingSets; w.volume += row.volume; w.volumeSets += row.volumeSets;
      if (row.tracking?.category && row.workingSets) muscles.set(row.tracking.category, (muscles.get(row.tracking.category) ?? 0) + row.workingSets);
      row.efforts.forEach((rir) => efforts[rir]++);
    }
  }
  const end = Math.min(now, period.to - 1);
  for (let d = Math.max(midnight(period.from), shiftDays(midnight(end), -83)); d <= end; d = shiftDays(d, 1)) {
    const key = localDateKey(d); days.push({ date: key, workouts: daily.get(key) ?? 0 });
  }
  for (let d = Math.max(monday(period.from), shiftDays(monday(end), -103 * 7)); d <= end; d = shiftDays(d, 7)) {
    const key = localDateKey(d); weeks.push({ date: key, ...(weekly.get(key) ?? { workouts: 0, sets: 0, workingSets: 0, volume: 0, volumeSets: 0 }) });
  }
  const exercises = allGroups.filter((g) => (!options.routineId || g.routineId === options.routineId) &&
    (!options.exerciseKey || g.key === options.exerciseKey)).map((g) => {
    const points = g.points.filter((p) => p.at >= period.from && p.at < period.to);
    return { ...g, points, sets: sum(points, (p) => p.sets), reps: sum(points, (p) => p.reps),
      volume: sum(points, (p) => p.volume), bestLoad: points.some((p) => p.maxLoad !== null) ? Math.max(...points.map((p) => p.maxLoad ?? 0)) : null,
      bestEstimate: points.some((p) => p.estimate !== null) ? Math.max(...points.map((p) => p.estimate ?? 0)) : null };
  }).filter((g) => g.points.length);
  return { ...base, totals, previousTotals, weeks, days, exercises, muscles: [...muscles], efforts };
}

export function indexCandidate(group, now) {
  const observations = group.observations.filter((p) => p.at <= now);
  const efforts = [...new Set([...observations].reverse().map((p) => p.rir))];
  for (const rir of efforts) {
    const samples = observations.filter((p) => p.rir === rir).slice(-INDEX_SAMPLES);
    if (samples.length === INDEX_SAMPLES && samples.at(-1).at >= shiftDays(now, -INDEX_FRESH_DAYS)) {
      return { key: group.key, name: group.name, baseline: median(samples.map((p) => p.value)), rir };
    }
  }
  return null;
}

export function configureIndex(data, keys, now = data.now) {
  const chosen = [...new Set(keys)];
  if (chosen.length < 2 || chosen.length > 6) return { ok: false, error: 'Valitse 2–6 vertailuliikettä. Liikkeillä on indeksissä sama paino.' };
  const benchmarks = chosen.map((key) => data.groups.get(key)).map((g) => g && indexCandidate(g, now));
  if (benchmarks.some((b) => !b)) return { ok: false, error: 'Jokainen vertailuliike tarvitsee kolme kirjattua treeniä samalla sarja-RIR-arvolla (0–3), viimeisin 28 päivän ajalta.' };
  return { ok: true, index: { version: INDEX_VERSION, createdAt: now, benchmarks } };
}

export function calculateIndex(data, config, asOf = data.now) {
  if (!config || asOf < config.createdAt) return { value: null, covered: 0, total: config?.benchmarks.length ?? 0, components: [] };
  const components = config.benchmarks.map((b) => {
    const samples = (data.groups.get(b.key)?.observations ?? []).filter((p) => p.at <= asOf && p.rir === b.rir).slice(-INDEX_SAMPLES);
    const latest = samples.at(-1)?.at ?? null;
    const available = samples.length === INDEX_SAMPLES && latest >= shiftDays(asOf, -INDEX_FRESH_DAYS);
    const current = available ? median(samples.map((p) => p.value)) : null;
    return { ...b, current, latest, ratio: current === null ? null : current / b.baseline };
  });
  const covered = components.filter((b) => b.ratio !== null).length;
  const value = covered === components.length ? 100 * Math.exp(sum(components, (b) => Math.log(b.ratio)) / components.length) : null;
  return { value, covered, total: components.length, components };
}

export function indexTimeline(data, config) {
  if (!config) return [];
  const points = [{ at: config.createdAt, ...calculateIndex(data, config, config.createdAt) }];
  for (let at = Math.max(shiftDays(config.createdAt, 7), shiftDays(data.now, -51 * 7)); at < data.now; at = shiftDays(at, 7)) {
    points.push({ at, ...calculateIndex(data, config, at) });
  }
  if (data.now > config.createdAt) points.push({ at: data.now, ...calculateIndex(data, config) });
  return points;
}
