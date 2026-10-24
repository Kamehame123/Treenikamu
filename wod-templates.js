// Ready-made functional training ("Toiminnallinen treeni") programs for "Aloita mallista":
// common WOD formats, one whole class and well-known benchmark workouts (vertailutreenit).
// Benchmark loads are the usual published standards converted to kilograms and rounded to
// plates found in gyms; each has a women's and a men's version. A template only builds a
// draft program for the editor; templates themselves are never saved.
import { EXERCISES } from './exercises.js';
import { libraryTracking } from './statistics.js';

export const SEXES = Object.freeze({ women: 'Naiset', men: 'Miehet' });
export const TEMPLATE_GROUPS = Object.freeze({ format: 'Formaatit', benchmark: 'Vertailutreenit' });

const LIBRARY = new Map(EXERCISES.map((e) => [e.id, e]));
const kg = (women, men) => ({ women: `${women} kg`, men: `${men} kg` });
const both = (women, men) => ({ women, men });
const box = both('50 cm', '60 cm');
const wallBall = both('6 kg, 2,7 m', '9 kg, 3 m');
const knees = { name: 'Etunojapunnerrus polvilta' };
const mv = (sourceId, amount = '', load = '', scaled = null) => ({ sourceId, amount, load, ...(scaled ? { scaled } : {}) });

const WARMUP = Object.freeze({
  text: '5 min kevyttä sykkeen nostoa (soutu, pyörä tai juoksu)\nLiikkuvuus ja aktivointi\nWODin liikkeet kevyesti, kuormat nousten',
  minutes: 10,
});
const COOLDOWN = Object.freeze({ text: 'Kävely tai kevyt pyöräily 2–3 min\nVenyttely ja rauhallinen hengitys', minutes: 5 });
// The editor's "Lisää lämmittely" / "Lisää loppuverryttely" start from the same text.
export { WARMUP as DEFAULT_WARMUP, COOLDOWN as DEFAULT_COOLDOWN };

// group 'format': a WOD structure to fill with your own movements; 'benchmark': a fixed workout to repeat and compare.
export const TEMPLATES = Object.freeze([
  {
    id: 'tunti', group: 'format', name: 'Kokonainen tunti',
    warmup: {
      text: '3 min kevyt soutu tai pyöräily\n2 kierrosta: 10 kehonpainokyykkyä, 10 käänteistä soutua, 10 kevyttä kahvakuulaheilautusta\nTakakyykky tyhjällä tangolla 2 × 8',
      minutes: 12,
    },
    exercises: [{ sourceId: 'lib-takakyykky', sets: 5, reps: '5' }],
    wod: {
      format: 'amrap', minutes: 12, score: 'roundsReps',
      movements: [
        mv('lib-soutulaite', '10 kal'),
        mv('lib-kahvakuulaheilautus', '10', kg(16, 24), { load: kg(12, 16) }),
        mv('lib-etunojapunnerrus', '10', '', knees),
      ],
      stimulus: 'Tasainen ja hengästyttävä, ei maksimaalinen: yksi kierros noin 2 minuutissa.',
    },
    cooldown: { text: '2–3 min kävely tai kevyt soutu\nLonkankoukistajien ja pakaroiden venytys\nRintarangan kierrot', minutes: 8 },
  },
  {
    id: 'amrap-12', group: 'format', name: 'AMRAP 12 min',
    wod: {
      format: 'amrap', minutes: 12, score: 'roundsReps',
      movements: [
        mv('lib-kahvakuulaheilautus', '10', kg(16, 24), { load: kg(12, 16) }),
        mv('lib-laatikkohyppy', '10', box, { name: LIBRARY.get('lib-korokkeelle-nousu')?.name }),
        mv('lib-soutulaite', '10 kal'),
      ],
      stimulus: 'Mahdollisimman monta kierrosta. Tasainen tahti alusta loppuun: kierros noin 1,5–2 minuutissa.',
    },
  },
  {
    id: 'emom-10', group: 'format', name: 'EMOM 10 min',
    wod: {
      format: 'emom', every: 60, rounds: 10, score: 'none',
      movements: [
        mv('lib-raaka-rinnalleveto', '3', kg(40, 60), { load: kg(25, 40) }),
        mv('lib-yleisliike', '6'),
      ],
      stimulus: 'Joka minuutti alkaa uusi kierros. Työtä noin 30–40 s, loppuminuutti on lepoa.',
    },
  },
  {
    id: 'emom-vuorotellen-12', group: 'format', name: 'Vuorotteleva EMOM 12 min',
    wod: {
      format: 'emom', every: 60, rounds: 12, alternate: true, score: 'none',
      movements: [
        mv('lib-soutulaite', '12 kal'),
        mv('lib-kuntopallon-heitto-seinaan', '15', wallBall, { load: both('4 kg, 2,7 m', '6 kg, 3 m') }),
        mv('lib-varpaat-tankoon', '10', '', { name: LIBRARY.get('lib-polvien-nosto-roikkuen')?.name }),
      ],
      stimulus: 'Minuutit kiertävät liikkeestä toiseen. Jokaisen minuutin työ kestää noin 35–45 s.',
    },
  },
  {
    id: '21-15-9', group: 'format', name: '21-15-9 aikaa vastaan',
    wod: {
      format: 'fortime', scheme: '21-15-9', minutes: 10, score: 'time',
      movements: [
        mv('lib-kahvakuulaheilautus', '', kg(16, 24), { load: kg(12, 16) }),
        mv('lib-yleisliike'),
      ],
      stimulus: 'Lyhyt ja kova: tavoite alle 8 minuuttia.',
    },
  },
  {
    id: '5-kierrosta', group: 'format', name: '5 kierrosta aikaa vastaan',
    wod: {
      format: 'fortime', rounds: 5, minutes: 20, score: 'time',
      movements: [
        mv('lib-soutulaite', '250 m'),
        mv('lib-laatikkohyppy', '12', box, { name: LIBRARY.get('lib-korokkeelle-nousu')?.name }),
        mv('lib-vauhtipunnerrus', '9', kg(25, 40), { load: kg(15, 25) }),
      ],
      stimulus: 'Kierros noin 3 minuutissa. Pidä kierrosajat tasaisina.',
    },
  },
  {
    id: 'chipper', group: 'format', name: 'Chipper', wodName: 'Chipper',
    wod: {
      format: 'fortime', rounds: 1, minutes: 20, score: 'time',
      movements: [
        mv('lib-tuplahyppy-narulla', '50', '', { name: LIBRARY.get('lib-hyppynaru')?.name, amount: '100' }),
        mv('lib-kahvakuulaheilautus', '40', kg(16, 24), { load: kg(12, 16) }),
        mv('lib-kuntopallon-heitto-seinaan', '30', wallBall, { load: both('4 kg, 2,7 m', '6 kg, 3 m') }),
        mv('lib-laatikkohyppy', '20', box, { name: LIBRARY.get('lib-korokkeelle-nousu')?.name }),
        mv('lib-yleisliike-tangon-yli', '10', '', { name: LIBRARY.get('lib-yleisliike')?.name }),
      ],
      stimulus: 'Pitkä lista liikkeitä kerran läpi. Etene tasaisesti; älä polta itseäsi loppuun ensimmäisissä liikkeissä.',
    },
  },
  {
    id: 'tabata', group: 'format', name: 'Tabata', wodName: 'Tabata',
    wod: {
      format: 'intervals', work: 20, rest: 10, rounds: 8, score: 'reps',
      movements: [mv('lib-kehonpainokyykky')],
      stimulus: 'Kahdeksan täysillä tehtyä 20 sekunnin jaksoa, 10 s lepo välissä. Kesto 4 minuuttia.',
      notes: 'Perinteinen tulos on heikoimman jakson toistot. Kirjaa joka kerta samalla tavalla, jotta tulokset ovat vertailukelpoisia.',
    },
  },
  {
    id: 'death-by', group: 'format', name: 'Death By', wodName: 'Death By',
    wod: {
      format: 'emom', every: 60, rounds: 20, ascending: true, score: 'rounds',
      movements: [mv('lib-yleisliike', '1')],
      stimulus: 'Minuutilla 1 yksi toisto, minuutilla 2 kaksi ja niin edelleen, kunnes et ehdi tehdä minuutin toistoja.',
      notes: 'Tulos on täysien minuuttien määrä.',
    },
  },
  {
    id: 'intervallit-5x3', group: 'format', name: 'Intervallit 5 × 3 min',
    wod: {
      format: 'intervals', work: 180, rest: 60, rounds: 5, score: 'cal',
      movements: [mv('lib-soutulaite')],
      stimulus: 'Kova mutta toistettava tahti: viimeisen jakson pitää onnistua yhtä hyvin kuin ensimmäisen.',
      notes: 'Tulos on kaikkien jaksojen kalorien summa.',
    },
  },
  {
    id: 'maksimikuorma-15', group: 'format', name: 'Maksimikuorma 15 min',
    wod: {
      format: 'maxload', minutes: 15, score: 'kg',
      movements: [mv('lib-raaka-rinnalleveto', '1')],
      stimulus: 'Etsi päivän raskas yhden toiston kuorma. Nosta tasaisin askelin ja lepää noin 2 min nostojen välillä.',
    },
  },
  {
    id: 'annie', group: 'benchmark', name: 'Annie',
    wod: {
      format: 'fortime', scheme: '50-40-30-20-10', minutes: 15, score: 'time',
      movements: [
        mv('lib-tuplahyppy-narulla', '', '', { name: 'Hyppynaru, kaksinkertainen määrä' }),
        mv('lib-istumaannousu'),
      ],
      stimulus: 'Nopea ja tasainen: tavoite alle 12 minuuttia.',
    },
  },
  {
    id: 'cindy', group: 'benchmark', name: 'Cindy',
    wod: {
      format: 'amrap', minutes: 20, score: 'roundsReps',
      movements: [
        mv('lib-leuanveto-myotaotteella', '5', '', { name: LIBRARY.get('lib-kaanteinen-soutu')?.name }),
        mv('lib-etunojapunnerrus', '10', '', knees),
        mv('lib-kehonpainokyykky', '15'),
      ],
      stimulus: 'Tasainen tahti koko 20 minuutin ajan. Skaalaa niin, että yksi kierros kestää noin minuutin.',
    },
  },
  {
    id: 'diane', group: 'benchmark', name: 'Diane',
    wod: {
      format: 'fortime', scheme: '21-15-9', minutes: 12, score: 'time',
      movements: [
        mv('lib-maastaveto', '', kg(70, 102), { load: kg(43, 61) }),
        mv('lib-kasillaseisontapunnerrus-seinaa-vasten', '', '', { name: LIBRARY.get('lib-haukipunnerrus')?.name }),
      ],
      stimulus: 'Raskas veto ja tekninen punnerrus: tavoite alle 10 minuuttia. Pidä selkä neutraalina väsyneenäkin.',
    },
  },
  {
    id: 'dt', group: 'benchmark', name: 'DT',
    wod: {
      format: 'fortime', rounds: 5, minutes: 15, score: 'time',
      movements: [
        mv('lib-maastaveto', '12', kg(47, 70), { load: kg(35, 50) }),
        mv('lib-rinnalleveto-riipusta', '9', kg(47, 70), { load: kg(35, 50) }),
        mv('lib-tyonto-ilman-saksausta', '6', kg(47, 70), { load: kg(35, 50) }),
      ],
      stimulus: 'Sama tanko kaikissa liikkeissä: tavoite noin 8–12 minuuttia. Valitse kuorma, jolla työnnöt onnistuvat väsyneenäkin.',
    },
  },
  {
    id: 'elizabeth', group: 'benchmark', name: 'Elizabeth',
    wod: {
      format: 'fortime', scheme: '21-15-9', minutes: 12, score: 'time',
      movements: [
        mv('lib-rinnalleveto', '', kg(43, 61), { load: kg(30, 43) }),
        mv('lib-rengasdippi', '', '', { name: LIBRARY.get('lib-penkkidippi')?.name }),
      ],
      stimulus: 'Nopea ja kova: tavoite alle 10 minuuttia.',
    },
  },
  {
    id: 'fran', group: 'benchmark', name: 'Fran',
    wod: {
      format: 'fortime', scheme: '21-15-9', minutes: 10, score: 'time',
      movements: [
        mv('lib-kyykkypunnerrus-tangolla', '', kg(29, 43), { load: kg(20, 30) }),
        mv('lib-leuanveto-myotaotteella', '', '', { name: LIBRARY.get('lib-avustettu-leuanveto')?.name }),
      ],
      stimulus: 'Lyhyt ja erittäin kova: tavoite alle 10 minuuttia. Valitse versio, jolla 21 toistoa onnistuu 2–3 osassa.',
    },
  },
  {
    id: 'grace', group: 'benchmark', name: 'Grace',
    wod: {
      format: 'fortime', rounds: 1, minutes: 10, score: 'time',
      movements: [mv('lib-rinnalleveto-ja-tyonto', '30', kg(43, 61), { load: kg(30, 43) })],
      stimulus: 'Nopea ja voimakas: noin 3–6 minuuttia yksittäisillä toistoilla.',
    },
  },
  {
    id: 'helen', group: 'benchmark', name: 'Helen',
    wod: {
      format: 'fortime', rounds: 3, minutes: 15, score: 'time',
      movements: [
        mv('lib-juoksu', '400 m'),
        mv('lib-kahvakuulaheilautus', '21', kg(16, 24), { load: kg(12, 16) }),
        mv('lib-leuanveto-myotaotteella', '12', '', { name: LIBRARY.get('lib-avustettu-leuanveto')?.name }),
      ],
      stimulus: 'Reipas juoksu ja mahdollisimman ehjät sarjat: tavoite noin 8–12 minuuttia.',
    },
  },
  {
    id: 'isabel', group: 'benchmark', name: 'Isabel',
    wod: {
      format: 'fortime', rounds: 1, minutes: 10, score: 'time',
      movements: [mv('lib-tempaus', '30', kg(43, 61), { load: kg(30, 43) })],
      stimulus: 'Nopea ja voimakas: noin 3–6 minuuttia yksittäisillä toistoilla.',
    },
  },
  {
    id: 'jackie', group: 'benchmark', name: 'Jackie',
    wod: {
      format: 'fortime', rounds: 1, minutes: 15, score: 'time',
      movements: [
        mv('lib-soutulaite', '1000 m'),
        mv('lib-kyykkypunnerrus-tangolla', '50', kg(15, 20), { load: kg(10, 15) }),
        mv('lib-leuanveto-myotaotteella', '30', '', { name: LIBRARY.get('lib-kaanteinen-soutu')?.name }),
      ],
      stimulus: 'Kova soutu ja paljon toistoja kevyellä tangolla: tavoite noin 8–12 minuuttia.',
    },
  },
  {
    id: 'karen', group: 'benchmark', name: 'Karen',
    wod: {
      format: 'fortime', rounds: 1, minutes: 15, score: 'time',
      movements: [mv('lib-kuntopallon-heitto-seinaan', '150', wallBall, { load: both('4 kg, 2,7 m', '6 kg, 3 m') })],
      stimulus: 'Pitkä yhden liikkeen urakka. Pilko toistot heti alusta lyhyisiin sarjoihin ja pidä tauot lyhyinä.',
    },
  },
  {
    id: 'murph', group: 'benchmark', name: 'Murph',
    wod: {
      format: 'fortime', rounds: 1, minutes: 0, score: 'time',
      movements: [
        mv('lib-juoksu', '1,6 km', '', { amount: '800 m' }),
        mv('lib-leuanveto-myotaotteella', '100', '', { name: LIBRARY.get('lib-kaanteinen-soutu')?.name, amount: '50' }),
        mv('lib-etunojapunnerrus', '200', '', { ...knees, amount: '100' }),
        mv('lib-kehonpainokyykky', '300', '', { amount: '150' }),
        mv('lib-juoksu', '1,6 km', '', { amount: '800 m' }),
      ],
      stimulus: 'Pitkä kestävyyssuoritus, usein 45–75 min. Keskiosan saa jakaa kierroksiin, esim. 20 × 5 leuanvetoa, 10 punnerrusta, 15 kyykkyä.',
      notes: both(
        'Rx tehdään 6 kg painoliivin kanssa. Suuri toistomäärä: jos et ole tehnyt vastaavaa, tee skaalattu puolikas ilman liiviä. Äkillisesti kasvanut toistomäärä lisää lihasvaurion (rabdomyolyysin) riskiä.',
        'Rx tehdään 9 kg painoliivin kanssa. Suuri toistomäärä: jos et ole tehnyt vastaavaa, tee skaalattu puolikas ilman liiviä. Äkillisesti kasvanut toistomäärä lisää lihasvaurion (rabdomyolyysin) riskiä.',
      ),
    },
  },
]);

export const templateById = (id) => TEMPLATES.find((t) => t.id === id) ?? null;

const pick = (value, sex) => value !== null && typeof value === 'object' ? value[sex] ?? '' : value ?? '';

function movement(m, sex) {
  const s = m.scaled;
  return {
    name: LIBRARY.get(m.sourceId)?.name ?? '',
    amount: m.amount,
    load: pick(m.load, sex),
    ...(s ? { scaled: { name: s.name ?? '', amount: s.amount ?? '', load: pick(s.load, sex) } } : {}),
    sourceId: m.sourceId,
  };
}

// The WOD part of a template with the women's or men's loads.
export function templateWod(template, sex = 'women') {
  const { movements, notes, ...wod } = template.wod;
  return {
    name: template.wodName ?? (template.group === 'benchmark' ? template.name : ''),
    template: template.id,
    ...wod,
    ...(notes ? { notes: pick(notes, sex) } : {}),
    movements: movements.map((m) => movement(m, sex)),
  };
}

// A complete draft program (not yet sanitized: ids are added when the editor opens it).
export function templateRoutine(template, sex = 'women') {
  return {
    name: template.name,
    type: 'functional',
    autoProgress: false,
    warmup: { ...(template.warmup ?? WARMUP) },
    exercises: (template.exercises ?? []).map((e) => {
      const entry = LIBRARY.get(e.sourceId);
      return { name: entry?.name ?? '', sets: e.sets, reps: e.reps, weight: '', ...(entry ? { tracking: libraryTracking(entry) } : {}) };
    }),
    wods: [templateWod(template, sex)],
    cooldown: { ...(template.cooldown ?? COOLDOWN) },
  };
}
