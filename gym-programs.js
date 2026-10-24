// Generic gym programs ("Valmiit kuntosaliohjelmat"). Each one is a single workout built from
// well-known beginner structures: alternating full-body A/B (StrongLifts 5x5 / Starting Strength
// style) and the push / pull / legs split. Loads are left empty; the user enters their own.

const ex = (name, sets, reps) => ({ name, sets, reps });

export const GYM_PROGRAMS = Object.freeze([
  {
    id: 'fullbody-a', name: 'Koko keho A',
    note: 'Aloittelijan perusohjelma 3 kertaa viikossa vuorotellen B-treenin kanssa (A–B–A, seuraavalla viikolla B–A–B). Lepopäivä treenien välissä.',
    exercises: [ex('Takakyykky', 3, '5'), ex('Penkkipunnerrus', 3, '5'), ex('Kulmasoutu', 3, '5'), ex('Pystypunnerrus', 2, '8'), ex('Lankku', 3, '30 s')],
  },
  {
    id: 'fullbody-b', name: 'Koko keho B',
    note: 'Vuorottele A-treenin kanssa. Nosta painoa vähän, kun kaikki toistot onnistuvat hyvällä tekniikalla.',
    exercises: [ex('Maastaveto', 1, '5'), ex('Pystypunnerrus', 3, '5'), ex('Ylätalja', 3, '8'), ex('Askelkyykky', 2, '10'), ex('Vatsarutistus', 3, '12')],
  },
  {
    id: 'push', name: 'Työntävät lihakset',
    note: 'Rinta, olkapäät ja ojentajat. Työntö–veto–jalat-jaon ensimmäinen päivä: tee kolme treeniä kiertäen tai kuusi kahdesti viikossa.',
    exercises: [ex('Penkkipunnerrus', 4, '6–8'), ex('Pystypunnerrus', 3, '8–10'), ex('Vinopenkkipunnerrus käsipainoilla', 3, '8–12'), ex('Sivunosto', 3, '12–15'), ex('Ojentajapunnerrus taljassa', 3, '10–12')],
  },
  {
    id: 'pull', name: 'Vetävät lihakset',
    note: 'Selkä, takaolkapäät ja hauikset. Pidä lapaluut vakaina ja liike hallittuna.',
    exercises: [ex('Leuanveto tai ylätalja', 4, '6–10'), ex('Kulmasoutu', 3, '8–10'), ex('Istuen alatalja', 3, '10–12'), ex('Takaolkapäänosto', 3, '12–15'), ex('Hauiskääntö', 3, '10–12')],
  },
  {
    id: 'legs', name: 'Jalat',
    note: 'Reidet, pakarat ja pohkeet. Aloita kevyellä lämmittelyllä ja pidä tekniikka puhtaana.',
    exercises: [ex('Takakyykky', 4, '6–8'), ex('Romanialainen maastaveto', 3, '8–10'), ex('Jalkaprässi', 3, '10–12'), ex('Reiden ojennus', 3, '10–12'), ex('Pohkeennosto', 4, '12–15')],
  },
  {
    id: 'upper', name: 'Yläkroppa',
    note: 'Rinta, selkä, olkapäät ja kädet samassa treenissä. Sopii esimerkiksi ylä- ja alakropan jakoon 4 kertaa viikossa yhdessä Jalat-treenin kanssa.',
    exercises: [ex('Penkkipunnerrus', 4, '6–8'), ex('Kulmasoutu', 4, '8–10'), ex('Pystypunnerrus', 3, '8–10'), ex('Ylätalja', 3, '10–12'), ex('Hauiskääntö', 2, '10–12'), ex('Ojentajapunnerrus taljassa', 2, '10–12')],
  },
  {
    id: 'core', name: 'Core',
    note: 'Keskivartalon perustreeni. Sopii omaksi lyhyeksi treeniksi tai voimatreenin lisäksi 2 kertaa viikossa. Pidä selkä neutraalina.',
    exercises: [ex('Lankku', 3, '30–45 s'), ex('Sivulankku', 3, '20–30 s'), ex('Vatsarutistus', 3, '12–15'), ex('Roikkuva polvennosto', 3, '8–12'), ex('Selän ojennus', 3, '12'), ex('Vatsapyörä', 2, '8–10')],
  },
]);

export const gymProgramById = (id) => GYM_PROGRAMS.find((p) => p.id === id) ?? null;

// A fresh routine with new exercise ids; core.sanitizeRoutine fills in the rest.
export function gymProgramRoutine(program, uid) {
  return {
    id: uid(), name: program.name, autoProgress: false,
    exercises: program.exercises.map((e) => ({ id: uid(), name: e.name, sets: e.sets, reps: e.reps, weight: '', setReps: null })),
  };
}
