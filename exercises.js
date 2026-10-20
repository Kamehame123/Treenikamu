// Original, offline exercise index. Names and aliases, not prescribed programmes.
export const CATEGORIES = Object.freeze(['Rinta', 'Selkä', 'Hartiat', 'Hauis', 'Ojentajat', 'Etureidet', 'Takareidet', 'Pakarat', 'Pohkeet', 'Keskivartalo', 'Koko keho', 'Kestävyys', 'Liikkuvuus']);
export const EQUIPMENT = Object.freeze(['Levytanko', 'Käsipainot', 'Laite', 'Talja', 'Kehonpaino', 'Kahvakuula', 'Vastuskuminauha', 'Muu väline']);
export const normalizeSearch = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fi-FI').replace(/[^a-z0-9]+/g, ' ').trim();

// group, equipment, Finnish name | common search aliases. Each row is a real variation.
const groups = [
  ['Rinta', 'Levytanko', `Penkkipunnerrus|bench press
Vinopenkkipunnerrus tangolla|incline bench press
Alavinopenkkipunnerrus tangolla|decline bench press
Lattiapunnerrus tangolla|floor press
Pysäytyspenkki|paused bench
Spoto-penkkipunnerrus|spoto press
Larsen-penkkipunnerrus|larsen press
Kapea penkkipunnerrus|close grip bench`],
  ['Rinta', 'Käsipainot', `Penkkipunnerrus käsipainoilla|dumbbell bench press
Vinopenkkipunnerrus käsipainoilla|incline dumbbell press
Alavinopenkkipunnerrus käsipainoilla|decline dumbbell press
Lattiapunnerrus käsipainoilla|dumbbell floor press
Vipunosto rinnalle käsipainoilla|dumbbell fly
Vipunosto rinnalle vinopenkillä|incline fly
Puristuspenkkipunnerrus|squeeze press
Yhden käden penkkipunnerrus|single arm bench press`],
  ['Rinta', 'Talja', `Ristikkäistalja ylhäältä|high cable fly crossover
Ristikkäistalja alhaalta|low cable fly
Ristikkäistalja rinnan korkeudelta|cable chest fly
Rintapunnerrus taljassa|cable chest press
Yhden käden rintapunnerrus taljassa|single arm cable press`],
  ['Rinta', 'Laite', `Rintapunnerrus laitteessa|chest press machine
Vinopenkkipunnerrus laitteessa|incline chest press machine
Pec deck|butterfly rintalaite
Penkkipunnerrus Smith-laitteessa|smith bench press
Vinopenkki Smith-laitteessa|smith incline press`],
  ['Rinta', 'Kehonpaino', `Etunojapunnerrus|push up punnerrus
Leveä etunojapunnerrus|wide push up
Punnerrus polvet maassa|kneeling push up
Punnerrus kädet korokkeella|incline push up
Punnerrus jalat korokkeella|decline push up
Pysäytyspunnerrus|paused push up
Lapapunnerrus|scapular push up
Jousiampujapunnerrus|archer push up`],
  ['Selkä', 'Levytanko', `Kulmasoutu tangolla|barbell row
Kulmasoutu vastaotteella|underhand barbell row
Pendlay-soutu|pendlay row
T-tankosoutu|t bar row
Meadows-soutu|meadows row
Rintatuettu soutu tangolla|seal row
Maastaveto|deadlift
Sumomaastaveto|sumo deadlift
Maastaveto korokkeelta|deficit deadlift
Maastaveto pukeilta|rack pull`],
  ['Selkä', 'Käsipainot', `Yhden käden kulmasoutu|single arm dumbbell row
Kulmasoutu käsipainoilla|dumbbell row
Rintatuettu soutu käsipainoilla|chest supported row
Pullover käsipainolla|dumbbell pullover
Renegade-soutu|renegade row
Soutu vinopenkillä vastaotteella|incline underhand row`],
  ['Selkä', 'Talja', `Ylätalja leveällä otteella|wide grip lat pulldown
Ylätalja kapealla otteella|close grip lat pulldown
Ylätalja vastaotteella|underhand lat pulldown
Yhden käden ylätalja|single arm lat pulldown
Alataljasoutu|seated cable row
Alataljasoutu leveällä otteella|wide cable row
Yhden käden alataljasoutu|single arm cable row
Suorin käsin ylätaljaveto|straight arm pulldown
Kasvoveto taljassa|face pull
Polviseisonnassa ylätaljaveto|kneeling pulldown`],
  ['Selkä', 'Laite', `Rintatuettu soutulaite|chest supported machine row
Yläsoutu laitteessa|high row machine
Ylätalja laitteessa|lat pulldown machine
Avustettu leuanveto|assisted pull up
Selänojennus laitteessa|back extension machine`],
  ['Selkä', 'Kehonpaino', `Leuanveto myötäotteella|pull up
Leuanveto vastaotteella|chin up
Leuanveto neutraalilla otteella|neutral grip pull up
Negatiivinen leuanveto|eccentric pull up
Lapaleuanveto|scapular pull up
Käänteinen soutu|inverted row australian pull up
Selänojennus penkissä|back extension hyperextension
Supermiesliike|superman`],
  ['Selkä', 'Vastuskuminauha', `Soutu vastuskuminauhalla|band row
Ylätaljaveto vastuskuminauhalla|band lat pulldown
Kasvoveto vastuskuminauhalla|band face pull
Kuminauhan levitys|band pull apart`],
  ['Hartiat', 'Levytanko', `Pystypunnerrus tangolla|overhead press military press
Pystypunnerrus istuen tangolla|seated barbell press
Vauhtipunnerrus|push press
Z-punnerrus tangolla|z press
Landmine-punnerrus|landmine press
Pystysoutu tangolla|upright row
Kohautus tangolla|barbell shrug`],
  ['Hartiat', 'Käsipainot', `Pystypunnerrus käsipainoilla|dumbbell shoulder press
Pystypunnerrus istuen käsipainoilla|seated dumbbell press
Arnold-punnerrus|arnold press
Vipunosto sivulle|lateral raise
Vipunosto eteen|front raise
Vipunosto taakse|rear delt fly reverse fly
Vipunosto sivulle istuen|seated lateral raise
Vipunosto taakse vinopenkillä|incline rear delt fly
Kohautus käsipainoilla|dumbbell shrug
Kuubalainen kierto|cuban rotation`],
  ['Hartiat', 'Talja', `Vipunosto sivulle taljassa|cable lateral raise
Vipunosto eteen taljassa|cable front raise
Vipunosto taakse taljassa|cable rear delt fly
Olkapään ulkokierto taljassa|cable external rotation
Olkapään sisäkierto taljassa|cable internal rotation`],
  ['Hartiat', 'Laite', `Pystypunnerrus laitteessa|shoulder press machine
Vipunosto sivulle laitteessa|lateral raise machine
Käänteinen pec deck|reverse pec deck
Pystypunnerrus Smith-laitteessa|smith shoulder press`],
  ['Hartiat', 'Kehonpaino', `Haukipunnerrus|pike push up
Käsilläseisontapunnerrus seinää vasten|wall handstand push up
Olkapään kosketus lankussa|plank shoulder tap
Seinäliuku|wall slide`],
  ['Hauis', 'Levytanko', `Hauiskääntö tangolla|barbell curl
Hauiskääntö mutkatangolla|ez bar curl
Hauiskääntö vastaotteella tangolla|reverse barbell curl
Scott-hauiskääntö tangolla|preacher curl
Drag-hauiskääntö|drag curl`],
  ['Hauis', 'Käsipainot', `Hauiskääntö käsipainoilla|dumbbell curl
Vuorottainen hauiskääntö|alternating curl
Vasarahauiskääntö|hammer curl
Hauiskääntö vinopenkillä|incline dumbbell curl
Keskitetty hauiskääntö|concentration curl
Scott-hauiskääntö käsipainolla|dumbbell preacher curl
Zottman-hauiskääntö|zottman curl
Ristikkäinen vasarakääntö|cross body hammer curl
Spider-hauiskääntö|spider curl
Rannekoukistus käsipainoilla|wrist curl
Ranteen ojennus käsipainoilla|reverse wrist curl`],
  ['Hauis', 'Talja', `Hauiskääntö alataljassa|cable curl
Hauiskääntö köydellä|rope hammer curl
Yhden käden hauiskääntö taljassa|single arm cable curl
Hauiskääntö ylätaljoissa|high cable curl
Bayesian-hauiskääntö|bayesian cable curl`],
  ['Hauis', 'Laite', `Hauiskääntö laitteessa|biceps curl machine
Scott-hauiskääntö laitteessa|preacher curl machine`],
  ['Hauis', 'Vastuskuminauha', `Hauiskääntö vastuskuminauhalla|band curl
Vasarakääntö vastuskuminauhalla|band hammer curl`],
  ['Ojentajat', 'Talja', `Ojentajapunnerrus köydellä|triceps rope pushdown
Ojentajapunnerrus tangolla taljassa|triceps pushdown
Ojentajapunnerrus vastaotteella|reverse grip pushdown
Yhden käden ojentajapunnerrus taljassa|single arm pushdown
Ojentajapunnerrus pään yli taljassa|overhead cable extension
Ojentajan potku taljassa|cable kickback`],
  ['Ojentajat', 'Käsipainot', `Ranskalainen punnerrus käsipainoilla|dumbbell skull crusher
Ojentajapunnerrus pään yli käsipainolla|overhead dumbbell extension
Yhden käden ojentajapunnerrus pään yli|single arm overhead extension
Ojentajan potku käsipainolla|dumbbell kickback
Tate-punnerrus|tate press`],
  ['Ojentajat', 'Levytanko', `Ranskalainen punnerrus tangolla|skull crusher
Ranskalainen punnerrus mutkatangolla|ez bar triceps extension
JM-punnerrus|jm press`],
  ['Ojentajat', 'Kehonpaino', `Dippi|triceps dip
Penkkidippi|bench dip
Timanttipunnerrus|diamond push up
Kapea etunojapunnerrus|close grip push up`],
  ['Ojentajat', 'Laite', `Avustettu dippi|assisted dip
Ojentajapunnerrus laitteessa|triceps extension machine`],
  ['Etureidet', 'Levytanko', `Takakyykky|back squat
Etukyykky|front squat
Zercher-kyykky|zercher squat
Pysäytyskyykky|pause squat
Korkean tangon takakyykky|high bar squat
Matalan tangon takakyykky|low bar squat
Laatikkokyykky|box squat
Askelkyykky tangolla|barbell lunge
Bulgarialainen askelkyykky tangolla|barbell split squat`],
  ['Etureidet', 'Käsipainot', `Askelkyykky käsipainoilla|dumbbell lunge
Askelkyykky taakse käsipainoilla|reverse dumbbell lunge
Kävelyaskelkyykky käsipainoilla|walking dumbbell lunge
Bulgarialainen askelkyykky käsipainoilla|bulgarian split squat
Korokkeelle nousu käsipainoilla|dumbbell step up
Maljakyykky käsipainolla|dumbbell goblet squat
Kantapäät korotettu kyykky käsipainolla|heels elevated squat`],
  ['Etureidet', 'Laite', `Jalkaprässi|leg press
Yhden jalan jalkaprässi|single leg press
Hack-kyykky|hack squat
Reidenojennus laitteessa|leg extension
Yhden jalan reidenojennus|single leg extension
Kyykky Smith-laitteessa|smith squat
Askelkyykky Smith-laitteessa|smith lunge
Vyökyykky|belt squat
Pendulum-kyykky|pendulum squat`],
  ['Etureidet', 'Kehonpaino', `Kehonpainokyykky|bodyweight squat
Askelkyykky|bodyweight lunge
Askelkyykky taakse|reverse lunge
Sivukyykky|lateral lunge
Kasakkakyykky|cossack squat
Pistoolikyykky|pistol squat
Tuolilta nousu|sit to stand
Seinäistunta|wall sit
Korokkeelle nousu|step up
Sissy-kyykky|sissy squat`],
  ['Takareidet', 'Levytanko', `Romanialainen maastaveto|romanian deadlift rdl
Suorin jaloin maastaveto|stiff leg deadlift
Hyvää huomenta -liike|good morning
Yhden jalan romanialainen maastaveto tangolla|single leg barbell rdl`],
  ['Takareidet', 'Käsipainot', `Romanialainen maastaveto käsipainoilla|dumbbell romanian deadlift
Yhden jalan maastaveto käsipainoilla|single leg dumbbell rdl
B-asennon romanialainen maastaveto|b stance rdl`],
  ['Takareidet', 'Laite', `Reidenkoukistus istuen|seated leg curl
Reidenkoukistus maaten|lying leg curl
Reidenkoukistus seisten|standing leg curl
Yhden jalan reidenkoukistus|single leg curl
Romanialainen maastaveto Smith-laitteessa|smith rdl
Glute ham raise|ghr takareisinosto`],
  ['Takareidet', 'Kehonpaino', `Pohjoismainen takareisikoukistus|nordic curl
Liukuva reidenkoukistus|sliding leg curl
Takareisikävely sillasta|hamstring walkout
Yhden jalan lantionnosto pitkällä vivulla|long lever bridge`],
  ['Pakarat', 'Levytanko', `Lantionnosto tangolla|hip thrust
Lantiosilta tangolla|barbell glute bridge
Sumokyykky tangolla|sumo squat
Yhden jalan lantionnosto tangolla|single leg hip thrust`],
  ['Pakarat', 'Kehonpaino', `Lantiosilta|glute bridge
Yhden jalan lantiosilta|single leg glute bridge
Lantionnosto penkkiä vasten|bodyweight hip thrust
Sammakkopumppaus|frog pump
Sivumakuulla jalan loitonnus|side lying hip abduction
Konttausasennon jalan ojennus|donkey kick
Palopostiliike|fire hydrant
Ristiaskelkyykky|curtsy lunge`],
  ['Pakarat', 'Talja', `Pakarapotku taljassa|cable glute kickback
Lonkan loitonnus taljassa|cable hip abduction
Lonkan lähennys taljassa|cable hip adduction
Läpiveto taljassa|cable pull through`],
  ['Pakarat', 'Laite', `Lonkan loitonnus laitteessa|hip abduction machine
Lonkan lähennys laitteessa|hip adduction machine
Lantionnosto laitteessa|hip thrust machine
Pakarapotku laitteessa|glute kickback machine`],
  ['Pakarat', 'Vastuskuminauha', `Sivukävely vastuskuminauhalla|lateral band walk
Hirviökävely|monster walk
Simpukkaliike vastuskuminauhalla|band clamshell
Lantiosilta vastuskuminauhalla|band glute bridge
Lonkan loitonnus seisten kuminauhalla|standing band abduction`],
  ['Pohkeet', 'Laite', `Pohjenousu seisten laitteessa|standing calf raise machine
Pohjenousu istuen laitteessa|seated calf raise
Pohjenousu jalkaprässissä|leg press calf raise
Pohjenousu Smith-laitteessa|smith calf raise`],
  ['Pohkeet', 'Kehonpaino', `Pohjenousu seisten|standing calf raise
Yhden jalan pohjenousu|single leg calf raise
Pohjenousu portaalla|deficit calf raise
Säärilihasnosto seinää vasten|tibialis raise`],
  ['Pohkeet', 'Käsipainot', `Pohjenousu käsipainoilla|dumbbell calf raise
Yhden jalan pohjenousu käsipainolla|single leg dumbbell calf raise`],
  ['Keskivartalo', 'Kehonpaino', `Lankku|plank
Sivulankku|side plank
Käänteinen lankku|reverse plank
Dead bug|kuollut ötökkä
Lintukoira|bird dog
Vatsarutistus|crunch
Käänteinen vatsarutistus|reverse crunch
Polkupyörärutistus|bicycle crunch
Jalkojen nosto maaten|lying leg raise
Jalkojen nosto roikkuen|hanging leg raise
Polvien nosto roikkuen|hanging knee raise
V-istunta|v sit
Ontto pito|hollow body hold
Vuorikiipeilijä|mountain climber
Istumaannousu|sit up
Kantapään kosketus maaten|heel touch
Sivulankun lantionnosto|side plank hip lift
Lankusta punnerrusasentoon|plank up down`],
  ['Keskivartalo', 'Talja', `Vatsarutistus taljassa|cable crunch
Pallof-punnerrus|pallof press
Vartalon kierto taljassa|cable wood chop
Vartalon kierto taljassa alhaalta ylös|low to high wood chop
Sivutaivutus taljassa|cable side bend`],
  ['Keskivartalo', 'Muu väline', `Vatsapyörä|ab wheel rollout
Vatsarullaus jumppapallolla|stability ball rollout
Vatsarutistus jumppapallolla|stability ball crunch
Polvien veto jumppapallolla|stability ball knee tuck
Jalkojen nosto kapteenintuolissa|captains chair leg raise
Vartalon kierto kuntopallolla|medicine ball russian twist`],
  ['Keskivartalo', 'Käsipainot', `Sivutaivutus käsipainolla|dumbbell side bend
Vartalon kierto käsipainolla|dumbbell russian twist
Matkalaukkukanto|suitcase carry
Viljelijän kävely käsipainoilla|farmers walk`],
  ['Koko keho', 'Kahvakuula', `Kahvakuulaheilautus|kettlebell swing
Yhden käden kahvakuulaheilautus|single arm swing
Kahvakuularinnalleveto|kettlebell clean
Kahvakuulatempaus|kettlebell snatch
Kahvakuulapunnerrus|kettlebell press
Turkkilainen ylösnousu|turkish get up
Maljakyykky kahvakuulalla|kettlebell goblet squat
Kahvakuulamaastaveto|kettlebell deadlift
Tuulimylly kahvakuulalla|kettlebell windmill
Kahvakuulaheilautus kahdella kuulalla|double kettlebell swing
Kahvakuulakierto pään ympäri|kettlebell halo
Viljelijän kävely kahvakuulilla|kettlebell farmer carry`],
  ['Koko keho', 'Levytanko', `Rinnalleveto|clean
Raaka rinnalleveto|power clean
Rinnalleveto riipusta|hang clean
Tempaus|snatch
Raaka tempaus|power snatch
Työntö|jerk
Kyykkypunnerrus tangolla|barbell thruster
Valakyykky|overhead squat
Rinnallevetoveto|clean pull
Tempausveto|snatch pull`],
  ['Koko keho', 'Kehonpaino', `Yleisliike|burpee
Kyykkyhyppy|squat jump
Askelkyykkyhyppy|jump lunge
Karhukävely|bear crawl
Mittarimatokävely|inchworm
Rapukävely|crab walk`],
  ['Koko keho', 'Muu väline', `Kelkan työntö|sled push
Kelkan veto|sled drag
Kuntopallon paiskaus|medicine ball slam
Kuntopallon heitto seinään|wall ball
Köysiaallot|battle ropes
Laatikkohyppy|box jump
Säkkikanto|sandbag carry
Trap bar -maastaveto|hex bar deadlift`],
  ['Kestävyys', 'Laite', `Juoksumatto|treadmill
Kuntopyörä|stationary bike
Soutulaite|rowing ergometer
Crosstrainer|elliptical
Porraskone|stair climber
Ilmavastuspyörä|air bike assault bike
Hiihtolaite|ski erg
Spinningpyörä|spin bike`],
  ['Kestävyys', 'Kehonpaino', `Kävely|walking
Reipas kävely|brisk walking
Juoksu|running jogging
Polvennostojuoksu|high knees
Haarahyppy|jumping jack
Luisteluhyppy|skater hop
Sivulaukka|lateral shuffle
Varjonyrkkeily|shadow boxing
Porrasnousu|stair walking`],
  ['Kestävyys', 'Muu väline', `Hyppynaru|jump rope skipping
Pyöräily|cycling
Uinti|swimming
Hiihto|cross country skiing
Soutu vesillä|outdoor rowing`],
  ['Liikkuvuus', 'Kehonpaino', `Lonkan koukistajan venytys|hip flexor stretch
Takareiden venytys|hamstring stretch
Etureiden venytys|quad stretch
Pohkeen venytys|calf stretch
Pakaravenytys|glute stretch
Rintalihaksen venytys|chest stretch
Leveän selkälihaksen venytys|lat stretch
Ojentajan venytys|triceps stretch
Lapsen lepoasento|child pose
Kissa-lehmä|cat cow
Rintarangan kierto kylkimakuulla|open book stretch
Maailman paras venytys|worlds greatest stretch
Lonkan 90/90-kierto|90 90 hip rotation
Nilkan liikkuvuus seinää vasten|ankle mobility
Syväkyykyn pito|deep squat hold
Rintarangan kierto konttausasennossa|quadruped thoracic rotation
Olkapäiden pyöritys|shoulder circles
Ranteiden liikkuvuus|wrist mobility`],
];

const timed = /lankku|seinäistunta|ontto pito|v-istunta|kanto|kävely|köysiaallot|pito$/i;
export const EXERCISES = Object.freeze(groups.flatMap(([category, equipment, rows]) => rows.split('\n').map((row) => {
  const [name, aliases = ''] = row.split('|');
  return Object.freeze({ id: `lib-${normalizeSearch(name).replace(/ /g, '-')}`, name, category, equipment, aliases,
    reps: category === 'Kestävyys' ? '5 min' : category === 'Liikkuvuus' || timed.test(name) ? '30 s' : '10' });
})));

export function findExercises(query = '', { category = '', equipment = '', customOnly = false, custom = [] } = {}) {
  const terms = normalizeSearch(query).slice(0, 160).split(' ').filter(Boolean);
  const entries = [...(customOnly ? [] : EXERCISES), ...custom.map((e) => ({ ...e, custom: true }))];
  return entries.filter((e) => (!category || e.category === category) && (!equipment || e.equipment === equipment)
    && terms.every((term) => normalizeSearch(`${e.name} ${e.aliases || ''} ${e.category} ${e.equipment}`).includes(term)))
    .sort((a, b) => a.name.localeCompare(b.name, 'fi-FI'));
}