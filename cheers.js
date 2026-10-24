// Swedish cheers shown after some sets. Wording follows workout progress; odds rise towards the end.
export const CHEERS = {
  early: [
    'Bra start! Nu är du igång.',
    'Så ska det se ut – fortsätt i samma rytm.',
    'Första steget är taget, resten följer.',
    'Snyggt jobbat! Kroppen är redan varm.',
    'Bra gjort – en sats i taget.',
    'Du är på gång, känn flytet!',
    'Fint! Håll lugnet och fortsätt.',
    'Stark start – ta det i din takt.',
    'Det där såg bra ut!',
    'Bra fokus, fortsätt så här.',
    'Varje sats räknas, och den här satt.',
    'Skönt! Bygg vidare på det här.',
    'Bra teknik och bra tempo – kör på!',
    'Du gjorde det svåraste: du började.',
    'Rätt väg! Nästa sats blir lika bra.',
    'Bra jobbat, andas lugnt och ta nästa.',
  ],
  middle: [
    'Du är i full gång – imponerande!',
    'Starkt! Du har redan gjort en bra bit.',
    'Håll i nu, du är på god väg.',
    'Det här är precis den envishet som ger resultat.',
    'Fortsätt så, du blir starkare för varje sats.',
    'Snyggt! Låt inte tempot sjunka nu.',
    'Du har kommit långt – fortsätt tro på dig själv.',
    'Bra kämpat, det är nu det gör skillnad.',
    'Så där ja! Ännu en sats i boken.',
    'Du har koll på det här, kör vidare!',
    'I mitten byggs styrkan – fortsätt!',
    'Stark insats! Kroppen tackar dig senare.',
    'Du ger inte upp, och det syns.',
    'Fantastiskt jobbat – behåll samma driv!',
    'Din uthållighet imponerar.',
    'Varje sats tar dig närmare målet.',
    'Bra där! Du är starkare än du tror.',
  ],
  late: [
    'Nästan framme – du klarar det här!',
    'Bara lite kvar, ge det du har!',
    'Fantastiskt! Målet är precis runt hörnet.',
    'Du är grym – avsluta lika starkt som du började!',
    'Det är nu du visar vad du går för – kör!',
    'Sista sträckan – håll ut, det mesta är redan gjort!',
    'Vilken prestation! Ta de sista med stolthet.',
    'Du är på upploppet – ge allt du har kvar!',
    'Så nära nu! Du har förtjänat varenda sats.',
    'Ingen stoppar dig nu – kör till mål!',
    'En stark avslutning är på väg, fortsätt!',
    'Det här blir ett riktigt bra pass – bara en liten bit kvar.',
    'Du har gjort det mesta, avsluta med stil!',
    'Imponerande! Du ger verkligen allt idag.',
    'Håll ut, snart kan du vara stolt över hela passet.',
    'Grymt kämpat – du är redan en vinnare idag.',
    'Snart i mål, och det kommer att kännas fantastiskt!',
  ],
};

// Chance of a cheer after a set: 12 % at the start, 62 % at the last set before the end.
export const cheerChance = (done, total) => (total > 0 ? 0.12 + 0.5 * Math.min(1, done / total) : 0);

// Returns '' for no cheer. Never repeats `previous` and stays silent once the workout is complete.
export function pickCheer(done, total, previous = '', random = Math.random) {
  if (!(total > 0) || done >= total || random() >= cheerChance(done, total)) return '';
  const part = done / total;
  const pool = (part < 1 / 3 ? CHEERS.early : part < 2 / 3 ? CHEERS.middle : CHEERS.late).filter((c) => c !== previous);
  return pool[Math.floor(random() * pool.length)] ?? '';
}

// Shown every time a WOD result beats the earlier best of the same version.
export const RECORD_CHEERS = [
  'Nytt personbästa! Grymt jobbat.',
  'Det här var ditt bästa hittills!',
  'Nytt rekord – slitet lönar sig.',
  'Starkt! Du slog ditt eget rekord.',
  'Personbästa idag – var stolt över det!',
];

export function pickRecordCheer(previous = '', random = Math.random) {
  const pool = RECORD_CHEERS.filter((c) => c !== previous);
  return pool[Math.floor(random() * pool.length)] ?? RECORD_CHEERS[0];
}
