// Original general-purpose templates, not copies of named commercial programs.
// Updates affect new selections only; saved routines and history are never rewritten.

const ex = (name, sets, reps) => ({ name, sets, reps });

export const GYM_PROGRAMS = Object.freeze([
  {
    id: 'fullbody-a', name: 'Koko keho A',
    note: 'Ensisijainen aloitusohjelma: koko keho 2–3 kertaa viikossa vuorotellen B-treenin kanssa. Esimerkiksi ma A, ke B, pe A; seuraavalla viikolla B–A–B. Pidä lepopäivä välissä. Lankussa hengitä normaalisti ja lopeta pito ennen asennon pettämistä.',
    exercises: [ex('Takakyykky', 3, '8'), ex('Penkkipunnerrus tangolla', 3, '8'), ex('Alataljasoutu', 3, '10'), ex('Lankku', 2, '20 s')],
  },
  {
    id: 'fullbody-b', name: 'Koko keho B',
    note: 'Vuorottele A-treenin kanssa 2–3 kertaa viikossa, lepopäivä välissä. Mukana sekä rintapunnerrus että pystypunnerrus. Opettele romanialaisen maastavedon lonkkataitto kevyesti ja tarvittaessa ohjaajan kanssa.',
    exercises: [ex('Romanialainen maastaveto', 3, '8'), ex('Jalkaprässi', 3, '10'), ex('Vinopenkkipunnerrus käsipainoilla', 2, '10'), ex('Ylätalja leveällä otteella', 3, '10'), ex('Pystypunnerrus käsipainoilla', 2, '8')],
  },
  {
    id: 'push', name: 'Työntävät lihakset',
    note: 'Rinta, olkapäät ja ojentajat. Jaetun ohjelman päivä, ei koko viikon ohjelma. Kokeneemmalle esimerkkikierto: työntö, veto, jalat, lepo, toista. Kolmella salikerralla viikossa aloittelijalle ensisijaisesti Koko keho A/B.',
    exercises: [ex('Penkkipunnerrus tangolla', 3, '8'), ex('Pystypunnerrus käsipainoilla', 2, '10'), ex('Vinopenkkipunnerrus käsipainoilla', 2, '10'), ex('Vipunosto sivulle', 2, '12'), ex('Ojentajapunnerrus taljassa', 2, '12')],
  },
  {
    id: 'pull', name: 'Vetävät lihakset',
    note: 'Selkä, takaolkapäät ja hauikset. Yhdistä Työntävät- ja Jalat-päiviin, esimerkiksi työntö, veto, jalat, lepo, toista palautumisen mukaan. Kolmen päivän viikossa kukin ryhmä saa pääosin yhden harjoituskerran; aloittelijalle ensisijaisesti Koko keho A/B.',
    exercises: [ex('Ylätalja leveällä otteella', 3, '10'), ex('Alataljasoutu', 3, '10'), ex('Vipunosto taakse', 2, '12'), ex('Hauiskääntö käsipainoilla', 2, '12')],
  },
  {
    id: 'legs', name: 'Jalat',
    note: 'Reidet, pakarat ja pohkeet. Takareisille sekä lonkanojennus että polvenkoukistus. Sopii Yläkroppa-päivän pariksi: ma yläkroppa, ti jalat, to yläkroppa, pe jalat. Vaihtoehtoisesti Työntävät/Vetävät-jaon jalkapäiväksi, ei molempia jakoja päällekkäin.',
    exercises: [ex('Takakyykky', 3, '8'), ex('Romanialainen maastaveto', 2, '10'), ex('Jalkaprässi', 2, '10'), ex('Reidenkoukistus istuen', 2, '12'), ex('Pohjenousu seisten laitteessa', 2, '12')],
  },
  {
    id: 'upper', name: 'Yläkroppa',
    note: 'Rinta, selkä, olkapäät ja kädet. Neljän päivän vaihtoehto: ma yläkroppa, ti jalat, to yläkroppa, pe jalat. Älä lisää samaan viikkoon erillisiä Työntävät/Vetävät-päiviä. Aloittelija voi aloittaa yhdellä sarjalla vähemmän liikettä kohti.',
    exercises: [ex('Penkkipunnerrus tangolla', 3, '8'), ex('Alataljasoutu', 3, '10'), ex('Pystypunnerrus käsipainoilla', 2, '10'), ex('Ylätalja leveällä otteella', 2, '10'), ex('Hauiskääntö käsipainoilla', 2, '12'), ex('Ojentajapunnerrus taljassa', 2, '12')],
  },
  {
    id: 'core', name: 'Core',
    note: 'Lyhyt keskivartalon lisäharjoitus 1–2 kertaa viikossa muun treenin jälkeen. Sivulankun puolet kirjataan erikseen: 2 sarjaa kummallekin puolelle. Dead bug: 8 vuorottelevaa toistoa yhteensä eli 4/puoli. Hengitä normaalisti; helpota lankkuja polvet maassa ja lyhennä pitoa tarvittaessa.',
    exercises: [ex('Lankku', 2, '20 s'), ex('Sivulankku, vasen', 2, '20 s'), ex('Sivulankku, oikea', 2, '20 s'), ex('Dead bug', 2, '8')],
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
