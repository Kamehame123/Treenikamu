import * as core from '../core.js';
import { buildStatistics, configureIndex } from '../statistics.js';

export const DAY = 86400000;
export const NOW = Date.UTC(2026, 9, 20, 12);
export function statisticsRoutine() {
  return core.sanitizeRoutine({
    id: 'r', name: 'Vertailutreeni', exercises: ['Penkkipunnerrus', 'Kulmasoutu tangolla'].map((name, i) => ({
      id: `e${i}`, name, sets: 2, reps: '6', weight: '100',
      tracking: { sourceId: `lib-${i}`, category: i ? 'Selkä' : 'Rinta', equipment: 'Levytanko', loadType: 'external', variant: '' },
    })),
  });
}
export function workout(id = 'w', at = NOW, loads = [100, 100]) {
  const routine = statisticsRoutine();
  routine.exercises.forEach((e, i) => { e.weight = String(loads[i]); });
  const session = core.startSession(routine, at - 3600000);
  session.id = id;
  session.exercises.forEach((e) => e.sets.forEach((s) => Object.assign(s, { done: true, actualReps: '6', setRir: '2', kind: 'working' })));
  return core.summarize(session, at);
}
export function baselineHistory(at = NOW) {
  return [0, 1, 2].map((i) => workout(`baseline-${i}`, at - (2 - i) * DAY));
}
export function configuredState(at = NOW) {
  const state = core.defaultState();
  state.routines = [statisticsRoutine()];
  state.history = baselineHistory(at);
  const data = buildStatistics(state.history, { now: at });
  const result = configureIndex(data, data.allGroups.map((g) => g.key), at);
  if (!result.ok) throw new Error(result.error);
  state.statistics = result.index;
  return state;
}
