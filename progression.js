// Evidence and deliberately conservative product thresholds are documented in README.md.
import { EXERCISES, normalizeSearch } from './exercises.js';

const DAY = 86400000;
const MAX_AUTOMATIC_SETS = 5;
const PRACTICAL_STEPS = [5, 2.5, 2, 1.25, 1, 0.5, 0.25, 0.1];
const CATALOGUE = new Map(EXERCISES.map((e) => [normalizeSearch(e.name), e]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const bounded = (value, min, max, fallback) => {
  const n = Number(value);
  return value !== '' && Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

export function classifyExercise(exercise) {
  const name = normalizeSearch(exercise?.name);
  const entry = CATALOGUE.get(name);
  const category = exercise?.category || entry?.category || '';
  const equipment = exercise?.equipment || entry?.equipment || '';
  const mobility = category === 'Liikkuvuus' || /venytys|stretch|liikkuvuus|mobility|kissa lehma|cat cow|90 90|open book|syvakyykyn pito|deep squat hold/.test(name);
  const endurance = category === 'Kestävyys' || /juoksu|kavely|pyora|uinti|hiihto|soutulaite|crosstrainer|porraskone|hyppynaru|varjonyrkkeily|burpee|yleisliike/.test(name);
  const core = category === 'Keskivartalo' || /lankku|plank|rutistus|crunch|dead bug|lintukoira|bird dog|vatsapyora|ab wheel|pallof|wood chop|vartalon kierto|jalkojen nosto|leg raise|polvien nosto|knee raise|sivutaivutus|side bend|ontto pito|hollow|v istunta|vuorikiipeilija/.test(name);
  const compoundException = /dippi|dip|kapea penkki|close grip|leuanveto|pull up|chin up/.test(name);
  const isolation = !compoundException && (
    ['Hauis', 'Ojentajat', 'Pohkeet'].includes(category) ||
    /vipunosto|hauiskaanto|ojentaja|ristikkaistalja|pec deck|butterfly|pohje|calf|tibialis|curl|fly|pushdown|kickback|lateral raise|front raise|rear delt|reiden ?ojenn|polven ?ojenn|reiden ?kouk|leg extension|leg curl|loitonnus|lahennys|abduction|adduction|olankohotus|shrug|rannekaanto|wrist|kasvoveto|face pull|levitys|pull apart|suorin kasin|straight arm|sammakkopumppaus|frog pump|donkey kick|palopostiliike|fire hydrant|simpukkaliike|clamshell/.test(name)
  );
  const lowerCompound = !isolation && !mobility && !endurance && !core && (
    ['Etureidet', 'Takareidet', 'Pakarat', 'Koko keho'].includes(category) ||
    /kyykky|squat|maastaveto|deadlift|rdl|hyvaa huomenta|good morning|jalkaprassi|leg press|lantionnosto|hip thrust|lantiosilta|glute bridge|askelkyykky|lunge|step up|korokkeelle nousu|rinnalleveto|clean|tempaus|snatch|tyonto|jerk|thruster|kelkan|sled|trap bar|hex bar|heilautus|swing/.test(name)
  );
  const kind = mobility ? 'mobility' : endurance ? 'endurance' : core ? 'core' : isolation ? 'isolation' : lowerCompound ? 'lowerCompound' : 'upperCompound';
  return { kind, category, equipment, isolation, lowerCompound, compound: kind === 'lowerCompound' || kind === 'upperCompound' };
}

export function automaticWeightStep() {
  return 1;
}

export function recommendedRestSeconds(exercise, setIndex = null) {
  const profile = classifyExercise(exercise);
  if (profile.kind === 'mobility') return 45;
  if (profile.kind === 'endurance' || profile.kind === 'core') return 60;
  const set = Number.isInteger(setIndex) && Array.isArray(exercise?.sets) ? exercise.sets[setIndex] : null;
  const planned = set?.reps ?? (Array.isArray(exercise?.setReps) ? exercise.setReps[setIndex ?? 0] : null) ?? exercise?.reps;
  const target = targetReps(planned);
  if (!target) return 60;
  const actual = set?.actualReps !== undefined && /^\d+$/.test(String(set.actualReps)) ? Number(set.actualReps) : null;
  const reps = actual ?? target.high;
  const loaded = (parseWeight(set?.actualWeight || exercise?.weight) ?? 0) > 0;
  const rirText = String(exercise?.rir ?? '').trim();
  const rir = /^[0-5]$/.test(rirText) ? Number(rirText) : null;
  let base;
  if (!loaded) base = reps > 20 ? 75 : 90;
  else if (reps <= 6) base = profile.isolation ? 120 : 180;
  else if (reps <= 12) base = profile.lowerCompound ? 150 : profile.isolation ? 90 : 120;
  else base = profile.compound ? 120 : reps > 20 ? 75 : 90;
  const demanding = (rir !== null && rir <= 1) || (actual !== null && actual > target.high) || (Number.isInteger(setIndex) && setIndex >= 3);
  if (demanding) base = Math.min(profile.isolation || !loaded ? 120 : 180, base + 30);
  return base;
}

export function progressionConfig(exercise) {
  const raw = exercise?.progression;
  const range = progressionRange(exercise);
  const minReps = Math.floor(bounded(raw?.minReps, 1, 30, range.minReps));
  return {
    minReps,
    maxReps: Math.max(minReps, Math.floor(bounded(raw?.maxReps, 1, 30, range.maxReps))),
    weightStep: round(bounded(raw?.weightStep, 0.01, 100, automaticWeightStep(exercise))),
    autoLoad: raw?.autoLoad !== false,
  };
}

export function progressionRange(exercise) {
  const base = exercise?.recoveryBase ?? exercise;
  const targets = (base?.setReps ?? [base?.reps]).map(targetReps).filter(Boolean);
  const low = targets.length ? Math.min(...targets.map((t) => t.low)) : 6;
  const high = targets.length ? Math.max(...targets.map((t) => t.high)) : 12;
  const { isolation } = classifyExercise(exercise);
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

export const MAX_REPS = 9999;

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
  return low > 0 && high >= low && high <= MAX_REPS ? { low, high } : null;
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
    Array.isArray(logged.sets) && logged.sets.length >= exercise.sets &&
    logged.sets.slice(0, exercise.sets).every((set, i) => (set.reps ?? logged.reps) === (exercise.setReps?.[i] ?? exercise.reps));
}

function performance(exercise, logged) {
  if (!matchesPlan(exercise, logged) || !logged.sets.every((set) => set.done)) return null;
  const targets = logged.sets.map((set, i) => targetReps(set.reps ?? exercise.setReps?.[Math.min(i, exercise.sets - 1)] ?? logged.reps));
  if (targets.some((target) => !target)) return null;
  const reps = logged.sets.map((set, i) => {
    if (set.actualReps === undefined) return targets[i].high;
    return /^\d+$/.test(String(set.actualReps)) ? Number(set.actualReps) : NaN;
  });
  if (reps.some((n) => !Number.isInteger(n) || n < 0 || n > MAX_REPS)) return null;
  const rawRir = logged.rir === undefined ? '' : String(logged.rir).trim();
  if ('rir' in logged && !/^[0-5]$/.test(rawRir)) return null;
  const plannedWeight = parseWeight(exercise.weight);
  const setWeights = [];
  for (const set of logged.sets) {
    const actual = String(set.actualWeight ?? '').trim();
    if (!actual) { setWeights.push(plannedWeight); continue; }
    if (plannedWeight === null) {
      if (actual !== exercise.weight) return null;
      setWeights.push(null);
    } else {
      const parsed = parseWeight(actual);
      if (parsed === null || parsed <= 0) return null;
      setWeights.push(parsed);
    }
  }
  const allNumericWeights = plannedWeight !== null && setWeights.every((w) => w !== null && w > 0);
  const provenWeight = allNumericWeights ? round(Math.min(...setWeights)) : plannedWeight;
  const refWeight = provenWeight > 0 ? provenWeight : plannedWeight;
  const effectiveReps = reps.map((n, i) => {
    const w = setWeights[i];
    if (!allNumericWeights || !refWeight || w === refWeight || n === 0) return n;
    return Math.max(0, Math.min(100, Math.floor((30 + n) * (w / refWeight) - 30)));
  });
  const plannedTargets = targets.slice(0, exercise.sets);
  const plannedReps = effectiveReps.slice(0, exercise.sets);
  const achieved = plannedReps.every((n, i) => n >= plannedTargets[i].high);
  const totalPlanned = plannedReps.reduce((a, b) => a + b, 0);
  const totalTarget = plannedTargets.reduce((sum, target) => sum + target.high, 0);
  const rir = rawRir !== '' ? Number(rawRir) : achieved ? 2 : 1;
  const extraSets = logged.sets.length - exercise.sets;
  const extraGoodSets = effectiveReps.slice(exercise.sets).filter((n, i) => n >= targets[exercise.sets + i].high).length;
  const extraReps = plannedReps.map((n, i) => Math.max(0, n - plannedTargets[i].high));
  const totalExtraReps = extraReps.reduce((a, b) => a + b, 0) +
    effectiveReps.slice(exercise.sets).reduce((sum, n, i) => sum + Math.max(0, n - targets[exercise.sets + i].high), 0);
  const capacities = plannedReps.map((n, i) => {
    const high = plannedTargets[i].high;
    if (rir >= 2 && n >= high) return n + 1 + (rir >= 4 && n > high ? 1 : 0);
    if (rir < 2 && n > high) return Math.max(high, n - (2 - rir));
    if (rir === 1 && n >= high && extraGoodSets > 0) return n + 1;
    return n;
  });
  return {
    reps, effectiveReps, plannedReps, rir, targets, plannedTargets,
    provenWeight, extraSets, extraGoodSets, totalExtraReps, capacities,
    achieved,
    struggling: rir <= 1 && totalPlanned < totalTarget * 0.9,
    severeFailure: rir === 0 && totalPlanned < totalTarget * 0.7,
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

function resolveLoadStep(exercise, weight, config, referenceReps, surplusReps) {
  const explicitStep = exercise?.progression?.weightStep !== undefined;
  const baseStep = config.weightStep;
  const candidates = [];
  if (!explicitStep && surplusReps >= 3 && round(baseStep * 2) / weight <= 0.1 + 1e-9) {
    candidates.push(round(baseStep * 2));
  }
  candidates.push(baseStep);
  if (!explicitStep) {
    for (const step of PRACTICAL_STEPS) if (step < baseStep) candidates.push(step);
  }
  for (const step of candidates) {
    if (step / weight > 0.1 + 1e-9) continue;
    const newWeight = round(weight + step);
    const newTargets = referenceReps.map((rep) =>
      Math.min(Math.max(config.minReps, config.maxReps - 1), rep - Math.max(1, Math.ceil((30 + rep) * step / newWeight))));
    const rawTargets = referenceReps.map((rep) => rep - Math.max(1, Math.ceil((30 + rep) * step / newWeight)));
    if (rawTargets.every((reps) => reps >= config.minReps)) {
      return { step, newWeight, newTargets };
    }
  }
  return null;
}

// Kevennetty start: 15% fewer reps and 15% less load (both rounded down), same sets; the saved plan is never touched.
export function lightenRoutine(routine) {
  const ease = (value) => {
    const target = targetReps(value);
    if (!target) return value;
    const low = Math.max(1, Math.floor(target.low * 85 / 100)), high = Math.max(1, Math.floor(target.high * 85 / 100));
    return low === high ? String(high) : `${low}-${high}`;
  };
  const light = structuredClone(routine);
  light.exercises = light.exercises.map((exercise) => {
    if (exercise.recoveryBase) return exercise;
    const next = { ...exercise, reps: ease(exercise.reps), setReps: exercise.setReps?.map(ease) ?? null };
    const weight = parseWeight(exercise.weight);
    const config = progressionConfig(exercise);
    if (config.autoLoad && weight > 0 && !/avust|assist|kuminauh/i.test(exercise.name)) {
      const lighter = round(Math.floor(round(weight * 0.85) / config.weightStep) * config.weightStep);
      // A coarse equipment step must not turn the 15% reduction into a much larger one.
      if (lighter > 0 && lighter >= weight * 0.7) next.weight = `${lighter} kg`;
    }
    return next;
  });
  return light;
}

function recommendExercise(exercise, latest, previous, fatigued, now) {
  const next = structuredClone(exercise);
  const hold = (reason) => ({ exercise: structuredClone(exercise), kind: 'hold', reason });
  const logged = latest.exercises.find((e) => e.id === exercise.id);
  if (logged?.pain) return hold('Kirjasit kipua. Älä harjoittele kivun läpi. Selvitä oireen syy tarvittaessa terveydenhuollossa; ohjelmaa ei nosteta eikä kipua hoideta kevennyksellä.');
  if (logged?.deload && !exercise.recoveryBase) return hold('Tämä harjoitus tehtiin kevennettynä heikon palautumisen vuoksi. Kevennetty tulos ei kerro normaalista suorituskyvystä, joten ohjelma säilyy ennallaan.');
  if (!matchesPlan(exercise, logged)) return hold('Ohjelma, liike tai sarjamäärä poikkeaa kirjauksesta. Nykyinen suunnitelma säilyy.');
  if (!logged.sets.every((set) => set.done)) return hold('Liike jäi kesken. Tekemättömiä sarjoja ei tulkita epäonnistumisiksi tai syyksi nostaa kuormaa.');
  if (now - latest.endedAt > 14 * DAY || latest.endedAt > now) return hold('Kirjaus ei ole viimeisen 14 päivän ajalta. Tee ensin uusi harjoitus nykyisillä tavoitteilla.');
  const config = progressionConfig(exercise);
  const targets = logged.sets.slice(0, exercise.sets).map((set, i) => targetReps(set.reps ?? exercise.setReps?.[i] ?? logged.reps));
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
  if (fatigued || (result.struggling && prior?.struggling) || result.severeFailure) {
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
    const trigger = fatigued ? 'Ilmoitit heikosta palautumisesta'
      : result.severeFailure ? 'Toistot jäivät alle 70 % tavoitteesta RIR-arvolla 0'
      : 'Kaksi vertailukelpoista harjoitusta jäi yli 10 % toistotavoitteesta RIR-arvolla 0–1';
    return { exercise: next, kind: 'deload', reason: `${trigger}. Kevennetään seuraavaa harjoituskertaa: noin puolet sarjoista ja pienemmät toisto-/painotavoitteet. Jätä 3–4 toistoa varastoon.` };
  }
  if (!result.achieved) return hold('Kaikki toistotavoitteet eivät vielä täyttyneet. Toista sama kuorma, lepää riittävästi ja säilytä hyvä tekniikka.');
  if (result.capacities.every((cap, i) => cap <= targets[i].high)) {
    return hold('Tavoitteet täyttyivät, mutta varastoon jäi alle 2 toistoa. Vahvista nykyinen kuorma ennen lisäystä.');
  }
  const weight = result.provenWeight ?? parseWeight(exercise.weight);
  const canAutoLoad = config.autoLoad && weight > 0 && !/avust|assist|kuminauh/i.test(exercise.name);
  const surplusOverCeiling = result.capacities.every((cap) => cap >= config.maxReps + 2) ||
    (result.plannedReps.every((r) => r >= config.maxReps) && result.extraGoodSets >= 1 && result.rir >= 2);
  const atCeiling = targets.every((target) => target.high >= config.maxReps);
  if (!atCeiling && !(canAutoLoad && surplusOverCeiling)) {
    const nextTargets = result.capacities.map((cap) => Math.min(config.maxReps, cap));
    if (result.extraGoodSets > 0 && result.rir >= 2 && exercise.sets < MAX_AUTOMATIC_SETS) {
      next.sets = Math.min(MAX_AUTOMATIC_SETS, exercise.sets + Math.min(result.extraGoodSets, 2));
      while (nextTargets.length < next.sets) nextTargets.push(nextTargets.at(-1));
    }
    if (canAutoLoad && result.provenWeight > parseWeight(exercise.weight)) next.weight = `${result.provenWeight} kg`;
    withTargets(next, nextTargets);
    const extraNote = result.totalExtraReps > 0 && result.extraGoodSets > 0
      ? `Teit ${result.totalExtraReps} ylimääräistä toistoa ja ${result.extraGoodSets} lisäsarjaa hyvällä varalla: seuraava tavoite ja sarjamäärä nostetaan suoraan osoitetulle tasolle (enintään ${MAX_AUTOMATIC_SETS} työsarjaa roskavolyymin välttämiseksi).`
      : result.totalExtraReps > 0
      ? `Teit ${result.totalExtraReps} ylimääräistä toistoa tavoitteen yli: toistotavoite nostetaan suoraan osoitetun suorituskyvyn mukaisesti.`
      : result.extraGoodSets > 0
      ? `Teit ${result.extraGoodSets} ylimääräistä sarjaa tavoitteeseen: sarjamäärää ja toistotavoitetta kasvatetaan hallitusti (enintään ${MAX_AUTOMATIC_SETS} sarjaa).`
      : 'Kaikki sarjat onnistuivat ja vähintään 2 toistoa jäi varastoon. Lisätään enintään yksi toisto sarjaa kohti; paino ja sarjamäärä säilyvät.';
    return { exercise: next, kind: 'reps', reason: `${extraNote} Kehitysalue ${config.minReps}–${config.maxReps}. ${explicitRange ? 'Käytetään tallennettua aluetta.' : progressionRange(exercise).reason}` };
  }
  if (!canAutoLoad) {
    if (result.extraGoodSets > 0 && result.rir >= 2 && exercise.sets < MAX_AUTOMATIC_SETS) {
      next.sets = Math.min(MAX_AUTOMATIC_SETS, exercise.sets + Math.min(result.extraGoodSets, 2));
      const nextTargets = Array.from({ length: next.sets }, (_, i) => Math.min(config.maxReps, result.capacities[Math.min(i, result.capacities.length - 1)]));
      withTargets(next, nextTargets);
      return { exercise: next, kind: 'reps', reason: `Toistoalueen yläraja ja ${result.extraGoodSets} lisäsarjaa onnistuivat. Koska liikkeessä ei ole automaattista kg-kuormaa, kasvatetaan työsarjojen määrää (${exercise.sets} → ${next.sets}).` };
    }
    return hold('Toistoalueen yläraja saavutettu. Kehonpaino, avustus tai tulkinnanvarainen kuorma vaatii vastuksen muutoksen käsin; painoa ei arvata.');
  }
  const priorConfirmed = prior?.achieved && prior.rir >= 2 && prior.plannedTargets.every((target) => target.high === config.maxReps);
  if (!priorConfirmed && !surplusOverCeiling) {
    return hold('Yläraja onnistui. Vahvista sama tulos toisessa peräkkäisessä vertailukelpoisessa harjoituksessa tai ylitä tavoite lisätoistoilla/-sarjoilla ennen painon nostoa.');
  }
  const referenceReps = result.capacities.map((cap, i) => Math.max(targets[i].high, cap - 1));
  const minSurplus = Math.min(...referenceReps) - config.maxReps + result.extraGoodSets;
  const resolved = resolveLoadStep(exercise, weight, config, referenceReps, minSurplus);
  if (!resolved) {
    if (config.weightStep / weight > 0.1 + 1e-9) return hold('Valittu painoaskel ylittää 10 % nykykuormasta. Valitse pienempi käytettävissä oleva askel; suurta hyppyä ei tehdä.');
    return hold('Painoaskel vaatisi varovaisen aloitusarvion mukaan kehitysalueen alittamisen. Valitse pienempi painoaskel; uutta kuormaa ei pakoteta alueelle.');
  }
  next.weight = `${resolved.newWeight} kg`;
  withTargets(next, resolved.newTargets);
  const surplusReason = surplusOverCeiling && !priorConfirmed
    ? 'Ylitit toistoalueen ylärajan ylimääräisillä toistoilla tai sarjoilla hyvällä varalla, mikä vahvistaa voimareservin jo yhden harjoituksen perusteella.'
    : 'Toistoalueen yläraja onnistui kahdesti vähintään RIR 2:lla.';
  return { exercise: next, kind: 'load', reason: `${surplusReason} Nostetaan kuormaa (+${resolved.step} kg, enintään 10 %) ja sovitetaan toistot kuorman muutokseen sekä tehtyihin toistoihin. Tämä on varovainen aloitusarvio, ei mitattu voimataso.` };
}

// Mutates only the supplied transaction copy; history and active workouts are never edited.
export function reviseRoutine(state, routineId, now = Date.now()) {
  const routine = state.routines.find((r) => r.id === routineId);
  if (!routine) return { ok: false, message: 'Harjoitusohjelmaa ei löytynyt.' };
  if (state.session?.routineId === routineId) return { ok: false, message: 'Tallenna tai lopeta tämän ohjelman keskeneräinen harjoitus ennen tarkistusta.' };
  const history = state.history.filter((h) => h.routineId === routineId).sort((a, b) => b.endedAt - a.endedAt);
  const latest = history[0];
  if (!latest?.exercises?.length) return { ok: false, message: 'Tarvitaan uusi harjoitus, jossa on liikkeiden toteutuneet toistot ja RIR. Vanhoista sarjamääristä ei arvata kehitystä.' };
  const corrected = routine.revision?.sourceId === latest.id && latest.editedAt > routine.revision.createdAt;
  if (routine.revision?.sourceId === latest.id && !corrected) return { ok: false, message: 'Tämä harjoituskerta on jo tarkistettu. Myös peruttu tarkistus odottaa uutta harjoituskertaa, jotta sama lisäys ei toistu.' };
  // The earlier result was corrected afterwards: recompute from the targets that existed before it, not on top of it.
  if (corrected && canUndoRevision(routine)) routine.exercises = structuredClone(routine.revision.before);
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
