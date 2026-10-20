// Evidence and deliberately conservative product thresholds are documented in README.md.
import { normalizeSearch } from './exercises.js';

const DAY = 86400000;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const bounded = (value, min, max, fallback) => {
  const n = Number(value);
  return value !== '' && Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

export function progressionConfig(exercise) {
  const raw = exercise?.progression;
  const range = progressionRange(exercise);
  const minReps = Math.floor(bounded(raw?.minReps, 1, 30, range.minReps));
  return {
    minReps,
    maxReps: Math.max(minReps, Math.floor(bounded(raw?.maxReps, 1, 30, range.maxReps))),
    weightStep: round(bounded(raw?.weightStep, 0.01, 100, 2.5)),
    autoLoad: raw?.autoLoad !== false,
  };
}

export function progressionRange(exercise) {
  const base = exercise?.recoveryBase ?? exercise;
  const targets = (base?.setReps ?? [base?.reps]).map(targetReps).filter(Boolean);
  const low = targets.length ? Math.min(...targets.map((t) => t.low)) : 6;
  const high = targets.length ? Math.max(...targets.map((t) => t.high)) : 12;
  const name = normalizeSearch(exercise?.name);
  const isolation = /vipunosto|hauiskaanto|ojentaja|ristikkaistalja|pec deck|pohje|calf|curl|fly|lateral raise|front raise|rear delt|reiden ?ojenn|polven ?ojenn|reiden ?kouk|leg extension/.test(name);
  let minReps, maxReps, reason;
  if (high <= 6) {
    minReps = 3; maxReps = 6;
    reason = 'Nykyinen matala toistotavoite painottaa voimaa. Raskaampi harjoittelu tukee maksimivoimaa; aluetta ei pakoteta hypertrofiapainotteiseksi.';
  } else if (high > 20) {
    minReps = 15; maxReps = 30;
    reason = 'Nykyinen korkea toistotavoite säilyttää kevyemmän kuorman painotuksen. Lihaskasvua voi saada myös pitkillä, riittävän kuormittavilla sarjoilla.';
  } else if (isolation || high > 12) {
    minReps = 10; maxReps = 20;
    reason = isolation ? 'Eristävään liikkeeseen valitaan käytännöllinen, maltillisen kuorman lihasmassapainotus; raskaita pienitoistoisia sarjoja ei oleteta parhaiksi.' : 'Nykyinen pidempi sarja tukee lihasmassapainotusta; sitä ei rajata 15 toistoon.';
  } else {
    minReps = 6; maxReps = 12;
    reason = 'Nykyiseen maltilliseen sarjaan valitaan voimaa ja lihasmassaa yhdistävä käytännön alue. Tuntemattoman liikkeen rakennetta ei arvata.';
  }
  return { minReps: Math.max(1, Math.min(minReps, low)), maxReps, reason };
}

export function parseWeight(value) {
  const text = String(value ?? '').trim().replace(',', '.');
  if (!/^\d+(?:\.\d+)?(?:\s*kg)?$/i.test(text)) return null;
  const n = Number(text.replace(/\s*kg$/i, ''));
  return Number.isFinite(n) && n >= 0 && n <= 10000 ? n : null;
}

export function targetReps(value) {
  const match = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(String(value).trim());
  if (!match) return null;
  const low = Number(match[1]), high = Number(match[2] ?? match[1]);
  return low > 0 && high >= low && high <= 100 ? { low, high } : null;
}

export function prescription(exercise) {
  return {
    sets: exercise.sets,
    reps: exercise.reps,
    weight: exercise.weight,
    setReps: exercise.setReps,
  };
}

function matchesPlan(exercise, logged) {
  return logged?.id === exercise.id && logged.name === exercise.name &&
    logged.reps === exercise.reps && logged.weight === exercise.weight &&
    logged.sets.length === exercise.sets &&
    logged.sets.every((set, i) => (set.reps ?? logged.reps) === (exercise.setReps?.[i] ?? exercise.reps));
}

function performance(exercise, logged) {
  if (!matchesPlan(exercise, logged) || !logged.sets.every((set) => set.done)) return null;
  const reps = logged.sets.map((set) => /^\d+$/.test(String(set.actualReps ?? '')) ? Number(set.actualReps) : NaN);
  const rir = String(logged.rir ?? '').trim();
  if (reps.some((n) => !Number.isInteger(n) || n < 0 || n > 100) || !/^[0-5]$/.test(rir)) return null;
  const weight = parseWeight(exercise.weight);
  if (!logged.sets.every((set) => {
    const actual = String(set.actualWeight ?? '').trim();
    return !actual || (weight !== null ? parseWeight(actual) === weight : actual === exercise.weight);
  })) return null;
  const targets = logged.sets.map((set) => targetReps(set.reps ?? logged.reps));
  if (targets.some((target) => !target)) return null;
  return {
    reps, rir: Number(rir), targets,
    achieved: reps.every((n, i) => n >= targets[i].high),
    struggling: Number(rir) <= 1 && reps.reduce((a, b) => a + b, 0) < targets.reduce((sum, target) => sum + target.high, 0) * 0.9,
  };
}

export function prescriptionLabel(exercise) {
  const reps = exercise.setReps ? exercise.setReps.join(' / ') : `${exercise.sets} x ${exercise.reps}`;
  return `${reps}${exercise.weight ? ` @ ${exercise.weight}` : ''}`;
}

function withTargets(exercise, targets) {
  const shared = targets.every((n) => n === targets[0]);
  exercise.reps = String(targets[0]);
  exercise.setReps = shared ? null : targets.map(String);
}

function recommendExercise(exercise, latest, previous, fatigued, now) {
  const next = structuredClone(exercise);
  const hold = (reason) => ({ exercise: structuredClone(exercise), kind: 'hold', reason });
  const logged = latest.exercises.find((e) => e.id === exercise.id);
  if (logged?.pain) return hold('Kirjasit kipua. Älä harjoittele kivun läpi. Selvitä oireen syy tarvittaessa terveydenhuollossa; ohjelmaa ei nosteta eikä kipua hoideta kevennyksellä.');
  if (!matchesPlan(exercise, logged)) return hold('Ohjelma, liike tai sarjamäärä poikkeaa kirjauksesta. Nykyinen suunnitelma säilyy.');
  if (!logged.sets.every((set) => set.done)) return hold('Liike jäi kesken. Tekemättömiä sarjoja ei tulkita epäonnistumisiksi tai syyksi nostaa kuormaa.');
  if (now - latest.endedAt > 14 * DAY || latest.endedAt > now) return hold('Kirjaus ei ole viimeisen 14 päivän ajalta. Tee ensin uusi harjoitus nykyisillä tavoitteilla.');
  const config = progressionConfig(exercise);
  const targets = logged.sets.map((set) => targetReps(set.reps ?? logged.reps));
  const explicitRange = exercise.progression?.minReps !== undefined && exercise.progression?.maxReps !== undefined;
  if (!explicitRange && targets.some((target) => target?.low < 3)) return hold('1–2 toiston työ vaatii tarkoituksellisen voimasuunnitelman. Valitse sen kehitysalue itse; näin raskasta työskentelyä ei ohjelmoida automaattisesti.');
  if (targets.some((target) => !target || target.low < config.minReps || target.high > config.maxReps)) {
    return hold('Aika-, vapaa teksti- tai kehitysalueen ulkopuolinen tavoite säilyy. Tarkista liikkeelle sopiva alue; yleistä 8–15 toiston rajaa ei käytetä.');
  }
  const result = performance(exercise, logged);
  if (!result) return hold('Kirjaa kaikkien tehtyjen sarjojen toteutuneet toistot ja liikkeen RIR (0–5). Poikkeavat sarjapainot vaativat tavoitepainon tarkistuksen käsin.');
  // Freeze the selected band for this progression cycle so its ceiling cannot move
  // after each added rep or after resetting reps with a new load.
  if (!explicitRange) next.progression = config;
  const priorLog = previous?.exercises?.find((e) => e.id === exercise.id);
  const prior = previous && previous.endedAt < latest.startedAt && latest.endedAt - previous.endedAt <= 21 * DAY &&
    !previous.fatigued && !priorLog?.pain ? performance(exercise, priorLog) : null;
  if (exercise.recoveryBase) {
    if (fatigued || !result.achieved || result.rir < 2) return hold('Kevennys jatkuu ilman uusia vähennyksiä. Palaa normaalikuormaan vasta palautuneena, tavoitteet täyttäen ja vähintään 2 toistoa varastossa.');
    Object.assign(next, exercise.recoveryBase);
    delete next.recoveryBase;
    return { exercise: next, kind: 'restore', reason: 'Kevennys onnistui palautuneena ja vähintään 2 toistoa jäi varastoon. Palataan kevennystä edeltävään suunnitelmaan, ei sitä raskaampaan.' };
  }
  if (fatigued || (result.struggling && prior?.struggling)) {
    next.recoveryBase = prescription(exercise);
    next.sets = Math.max(1, Math.ceil(exercise.sets / 2));
    const reduced = targets.slice(0, next.sets).map((target) => Math.min(target.high, config.minReps));
    withTargets(next, reduced);
    const weight = parseWeight(exercise.weight);
    if (config.autoLoad && weight > 0 && !/avust|assist|kuminauh/i.test(exercise.name)) {
      const lighter = round(Math.floor(round(weight * 0.9) / config.weightStep) * config.weightStep);
      // A coarse equipment step must not turn a modest deload into a large load change.
      if (lighter > 0 && lighter >= weight * 0.8 && lighter < weight) next.weight = `${lighter} kg`;
    }
    if (same(prescription(next), prescription(exercise))) return hold('Palautuminen on heikkoa, mutta ohjelmaa ei voi keventää näillä asetuksilla. Lepää ja arvioi sopiva kuorma ennen seuraavaa harjoitusta.');
    return { exercise: next, kind: 'deload', reason: `${fatigued ? 'Ilmoitit heikosta palautumisesta' : 'Kaksi vertailukelpoista harjoitusta jäi yli 10 % toistotavoitteesta RIR-arvolla 0–1'}. Kevennetään seuraavaa harjoituskertaa: noin puolet sarjoista ja pienemmät toisto-/painotavoitteet. Jätä 3–4 toistoa varastoon.` };
  }
  if (!result.achieved) return hold('Kaikki toistotavoitteet eivät vielä täyttyneet. Toista sama kuorma, lepää riittävästi ja säilytä hyvä tekniikka.');
  if (result.rir < 2) return hold('Tavoitteet täyttyivät, mutta varastoon jäi alle 2 toistoa. Vahvista nykyinen kuorma ennen lisäystä.');
  if (targets.some((target) => target.high < config.maxReps)) {
    withTargets(next, targets.map((target) => Math.min(config.maxReps, target.high + 1)));
    return { exercise: next, kind: 'reps', reason: `Kaikki sarjat onnistuivat ja vähintään 2 toistoa jäi varastoon. Lisätään enintään yksi toisto sarjaa kohti; paino ja sarjamäärä säilyvät. Kehitysalue ${config.minReps}–${config.maxReps}. ${explicitRange ? 'Käytetään tallennettua aluetta.' : progressionRange(exercise).reason}` };
  }
  const weight = parseWeight(exercise.weight);
  if (!config.autoLoad || !weight || /avust|assist|kuminauh/i.test(exercise.name)) return hold('Toistoalueen yläraja saavutettu. Kehonpaino, avustus tai tulkinnanvarainen kuorma vaatii vastuksen muutoksen käsin; painoa ei arvata.');
  if (!prior?.achieved || prior.rir < 2 || prior.targets.some((target) => target.high !== config.maxReps)) {
    return hold('Yläraja onnistui. Vahvista sama tulos toisessa peräkkäisessä vertailukelpoisessa harjoituksessa ennen painon nostoa.');
  }
  if (config.weightStep / weight > 0.1 + 1e-9) return hold('Valittu painoaskel ylittää 10 % nykykuormasta. Valitse pienempi käytettävissä oleva askel; suurta hyppyä ei tehdä.');
  const newWeight = round(weight + config.weightStep);
  // Pace the rep reduction with the size of the load change instead of dropping
  // every successful set to the bottom of a potentially wide band.
  const newTargets = targets.map((target) =>
    target.high - Math.max(1, Math.ceil((30 + target.high) * config.weightStep / newWeight)));
  if (newTargets.some((reps) => reps < config.minReps)) return hold('Painoaskel vaatisi varovaisen aloitusarvion mukaan kehitysalueen alittamisen. Valitse pienempi painoaskel; uutta kuormaa ei pakoteta alueelle.');
  next.weight = `${newWeight} kg`;
  withTargets(next, newTargets);
  return { exercise: next, kind: 'load', reason: 'Toistoalueen yläraja onnistui kahdesti vähintään RIR 2:lla. Nostetaan yksi painoaskel (enintään 10 %) ja vähennetään toistoja suhteessa kuorman muutokseen, ei automaattisesti alueen alarajaan. Tämä on varovainen aloitusarvio, ei mitattu voimataso. Kirjaa uuden painon todelliset toistot ja RIR; tavoitetta ei pidä pakottaa.' };
}

// Mutates only the supplied transaction copy; history and active workouts are never edited.
export function reviseRoutine(state, routineId, now = Date.now()) {
  const routine = state.routines.find((r) => r.id === routineId);
  if (!routine) return { ok: false, message: 'Harjoitusohjelmaa ei löytynyt.' };
  if (state.session?.routineId === routineId) return { ok: false, message: 'Tallenna tai lopeta tämän ohjelman keskeneräinen harjoitus ennen tarkistusta.' };
  const history = state.history.filter((h) => h.routineId === routineId).sort((a, b) => b.endedAt - a.endedAt);
  const latest = history[0];
  if (!latest?.exercises?.length) return { ok: false, message: 'Tarvitaan uusi harjoitus, jossa on liikkeiden toteutuneet toistot ja RIR. Vanhoista sarjamääristä ei arvata kehitystä.' };
  if (routine.revision?.sourceId === latest.id) return { ok: false, message: 'Tämä harjoituskerta on jo tarkistettu. Myös peruttu tarkistus odottaa uutta harjoituskertaa, jotta sama lisäys ei toistu.' };
  const before = structuredClone(routine.exercises);
  const decisions = before.map((exercise) => recommendExercise(exercise, latest, history[1], latest.fatigued === true, now));
  routine.exercises = decisions.map((d) => d.exercise);
  routine.revision = {
    sourceId: latest.id,
    createdAt: now,
    before,
    after: structuredClone(routine.exercises),
    undone: false,
    changes: decisions.map((d, i) => ({
      exerciseId: before[i].id, name: before[i].name, kind: d.kind,
      before: prescriptionLabel(before[i]), after: prescriptionLabel(d.exercise), reason: d.reason,
    })),
  };
  return { ok: true, message: canUndoRevision(routine) ? 'Seuraavan harjoituksen tavoitteet tarkistettu. Voit perua muutoksen heti.' : 'Tavoitteet säilyvät. Katso liikkeiden perustelut.' };
}

export function canUndoRevision(routine) {
  const revision = routine.revision;
  return !!revision && !revision.undone && !same(revision.before, revision.after) && same(routine.exercises, revision.after);
}

export function undoRevision(state, routineId) {
  const routine = state.routines.find((r) => r.id === routineId);
  if (!routine || !canUndoRevision(routine)) return { ok: false, message: 'Tarkistusta ei voi perua: se on jo peruttu, tavoitteet eivät muuttuneet tai ohjelmaa on muokattu sen jälkeen.' };
  if (state.session?.routineId === routineId) return { ok: false, message: 'Lopeta keskeneräinen harjoitus ennen tarkistuksen perumista. Sen kirjauksia ei muuteta.' };
  routine.exercises = structuredClone(routine.revision.before);
  routine.revision.undone = true;
  return { ok: true, message: 'Tarkistus peruttu. Edelliset tavoitteet palautettu; harjoitushistoria säilyy.' };
}
