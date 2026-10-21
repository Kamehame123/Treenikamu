import { buildStatistics, calculateIndex, indexCandidate, indexTimeline, localDateKey, LOAD_TYPES } from './statistics.js';

export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const esc = escapeHtml;
const fmt = (n, digits = 0) => n === null || n === undefined ? '—' : n.toLocaleString('fi-FI', { maximumFractionDigits: digits });
const date = (n) => new Date(typeof n === 'string' ? `${n}T12:00:00` : n).toLocaleDateString('fi-FI');
const change = (current, previous) => previous === null || previous === undefined ? 'Ei vertailutietoa' :
  previous === 0 ? 'Ei aiempaa vertailupohjaa' : `${current >= previous ? '+' : ''}${fmt((current / previous - 1) * 100, 1)} % edelliseen jaksoon`;
const groupLabel = (g) => [g.name, g.routineName, g.tracking?.variant, g.tracking?.equipment].filter(Boolean).join(' · ');
const table = (caption, headers, rows) => `<div class="stat-table-wrap" tabindex="0" role="region" aria-label="${esc(caption)}"><table class="stat-table"><caption>${esc(caption)}</caption><thead><tr>${headers.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
const cells = (...values) => `<tr>${values.map((v, i) => `<${i ? 'td' : 'th scope="row"'}>${v}</${i ? 'td' : 'th'}>`).join('')}</tr>`;

function filterMenu(field, title, choices, value) {
  const selected = choices.find((c) => c.value === value)?.label ?? choices[0].label;
  return `<div class="field"><span id="stat-${field}-label">${esc(title)}</span><details class="choice-menu"><summary data-key="stat-${field}" aria-labelledby="stat-${field}-label stat-${field}-value"><span id="stat-${field}-value">${esc(selected)}</span><span aria-hidden="true">⌄</span></summary><fieldset><legend class="sr">${esc(title)}</legend>${choices.map((c) => `<label class="choice-option"><input type="radio" name="stat-${field}" data-stat-filter="${field}" value="${esc(c.value)}" ${c.value === value ? 'checked' : ''}><span>${esc(c.label)}</span></label>`).join('')}</fieldset></details></div>`;
}

function trendChart(points, title, unit, baseline = null) {
  const valid = points.filter((p) => p.value !== null);
  if (!valid.length) return '<p class="muted stat-note">Ei vielä vertailukelpoisia havaintoja.</p>';
  const values = valid.map((p) => p.value);
  if (baseline !== null) values.push(baseline);
  const min = Math.min(...values), max = Math.max(...values), spread = Math.max(max - min, max * 0.05, 1);
  const low = Math.max(0, min - spread * 0.15), high = max + spread * 0.15;
  const start = points[0].at, end = points.at(-1).at;
  const x = (at) => 64 + (end > start ? (at - start) / (end - start) : 0.5) * 590;
  const y = (v) => 170 - (v - low) / (high - low) * 140;
  const segments = []; let segment = [];
  for (const p of points) {
    if (p.value === null) { if (segment.length) segments.push(segment); segment = []; }
    else segment.push(p);
  }
  if (segment.length) segments.push(segment);
  return `<figure class="stat-chart"><svg viewBox="0 0 680 212" role="img" aria-label="${esc(title)}">
    <title>${esc(title)}. ${esc(date(start))}–${esc(date(end))}. Arvot ${esc(fmt(min, 1))}–${esc(fmt(max, 1))} ${esc(unit)}.</title>
    <path class="stat-axis" d="M64 20V178H654"/><text x="4" y="36">${esc(fmt(high, 1))}</text><text x="4" y="174">${esc(fmt(low, 1))}</text>
    ${baseline === null ? '' : `<path class="stat-baseline" d="M64 ${y(baseline)}H654"/>`}
    ${segments.map((part) => `<polyline class="stat-line" points="${part.map((p) => `${x(p.at)},${y(p.value)}`).join(' ')}"/>${part.map((p) => `<circle class="stat-dot" cx="${x(p.at)}" cy="${y(p.value)}" r="3"><title>${esc(date(p.at))}: ${esc(fmt(p.value, 1))} ${esc(unit)}</title></circle>`).join('')}`).join('')}
    <text x="64" y="204">${esc(date(start))}</text><text x="654" y="204" text-anchor="end">${esc(date(end))}</text></svg>
    <figcaption>${esc(title)} · ${esc(unit)}. Katkokset tarkoittavat puuttuvaa tietoa; tarkat arvot ovat taulukossa.</figcaption></figure>`;
}

function indexCard(data, config, compact = false) {
  const index = calculateIndex(data, config);
  const label = !config ? 'Valitse vertailuliikkeet tilastoissa.' : index.value === null ?
    'Indeksi odottaa puuttuvia tai tuoreempia suorituksia.' : `${index.value >= 100 ? '+' : ''}${fmt(index.value - 100, 1)} % lähtötasosta · lähtötaso 100`;
  return `<section class="card index-card${compact ? ' index-compact' : ''}" aria-label="Kehitysindeksi"><div><p class="eyebrow accent">KEHITYSINDEKSI</p><p class="index-value">${fmt(index.value, 1)}</p><p>${esc(label)}</p><p class="muted small-copy">${config ? `${index.covered}/${index.total} vertailuliikettä ajan tasalla · ` : ''}Oma suorituskyky, ei lihaskasvun tai terveyden mittaus.</p></div>${compact ? '<button class="btn secondary" data-action="statistics" data-key="statistics">Avaa tilastot</button>' : '<button class="btn secondary" data-action="indexsettings" data-key="indexsettings">Valitse vertailuliikkeet</button>'}</section>`;
}

export function statisticsSummary(state) {
  return indexCard(buildStatistics(state.history, { range: '4w' }), state.statistics, true);
}

function indexSection(data, config) {
  const index = calculateIndex(data, config), candidates = data.allGroups.filter((g) => indexCandidate(g, data.now));
  const timeline = indexTimeline(data, config);
  return `${indexCard(data, config)}
    ${config ? `<section class="card"><h2>Yhdistetty kehitys</h2><p class="muted stat-note">Koko historia · jakso- ja liikesuodattimet eivät muuta indeksiä. Vertailu alkaa ${esc(date(config.createdAt))}.</p>
    ${trendChart(timeline, 'Kehitysindeksin historia', 'indeksipistettä', 100)}
    <details class="stat-details"><summary>Indeksin tarkat arvot ja osatekijät</summary>${table('Indeksin historia (enintään 52 viikkoa)', ['Päivä', 'Indeksi', 'Kattavuus'], timeline.map((p) => cells(esc(date(p.at)), fmt(p.value, 1), `${p.covered}/${p.total}`)))}
    ${table('Vertailuliikkeet: saman sarja-RIR:n kolmen treenin mediaani', ['Liike', 'RIR', 'Lähtöarvio (kg)', 'Nykyarvio (kg)', 'Muutos', 'Viimeisin'], index.components.map((b) => cells(esc(b.name), String(b.rir), fmt(b.baseline, 1), fmt(b.current, 1), b.ratio === null ? 'Ei tuoretta tietoa' : `${fmt((b.ratio - 1) * 100, 1)} %`, b.latest ? esc(date(b.latest)) : '—')))}</details></section>` : ''}
    <details class="card stat-details" id="index-settings"><summary>Indeksin vertailuliikkeet ja laskentatapa</summary>
    <p>Valitse 2–6 edustavaa liikettä. Jokainen tarvitsee kolme treeniä samalla sarjakohtaisella RIR-arvolla (0–3), viimeisin 28 päivän ajalta. Vain tehty työsarja, kirjattu 1–10 toiston tulos ja tunnettu positiivinen kg-kuorma kelpaavat. Kipu, heikko palautuminen ja ohjelman automaattinen kevennys sulkevat havainnon pois.</p>
    <fieldset class="benchmark-options"><legend>Vertailuliikkeet</legend>${candidates.length ? candidates.map((g) => `<label class="check"><span>${esc(groupLabel(g))}</span><input type="checkbox" name="benchmark" value="${esc(g.key)}" ${config?.benchmarks.some((b) => b.key === g.key) ? 'checked' : ''}></label>`).join('') : '<p class="muted">Ei vielä riittävästi kirjauksia. Valitse liikkeelle kuorman tyyppi ohjelman muokkauksessa ja kirjaa liikkeen RIR sarjojen alla sekä tulos ja tyyppi harjoituksen valinnaisissa tuloksissa (ota ne ensin käyttöön Asetuksissa “Kuormittavuuden kirjaus”).</p>'}</fieldset>
    <button class="btn primary" data-action="saveindex" data-key="saveindex" ${candidates.length < 2 ? 'disabled' : ''}>${config ? 'Aloita uusi vertailujakso' : 'Aloita kehityksen seuranta'}</button>
    <p class="stat-note">Lähtöarvo ja nykyarvo ovat kolmen viimeisen samalla RIR:llä kirjatun treenin parhaiden sarja-arvioiden mediaaneja. Epleyn arvio: kuorma × (1 + toistot / 30); yhden toiston tulos käyttää kuormaa sellaisenaan. RIR:ää ei lisätä toistoihin. Eri RIR-arvoja ei verrata keskenään.</p>
    <p class="stat-note">Indeksi = 100 × exp(keskiarvo(ln(nykyarvo / lähtöarvo))). Liikkeillä on sama paino. Lähtöarvot ja liikejoukko jäädytetään; puuttuvan liikkeen painoa ei siirretä muille. Yli 28 päivää vanha viimeisin havainto tekee indeksistä puuttuvan, ei nollaa. Uusi jakso korvaa vanhan indeksivertailun, ei harjoitushistoriaa.</p>
    <p class="muted stat-note">Tämä on läpinäkyvä ohjelmistomalli, ei validoitu kokonaisvoiman tai lihaskasvun mittari. Arvioon vaikuttavat tekniikka, toistoalue ja oma RIR-arvio. Kolmen havainnon tasoitus ja 28 päivän raja ovat tuotevalintoja, eivät lääketieteellisiä raja-arvoja.</p></details>`;
}

export function trackingEditor(exercise, i) {
  const t = exercise.tracking;
  return `<details class="tracking-editor stat-details"><summary>Tilastojen liiketiedot</summary><p class="muted small-copy">Tiedot tallentuvat uusiin treeneihin; vanhaa historiaa ei tulkita uudelleen. Sama liike eri ohjelmissa pidetään erillään.</p>
    <fieldset><legend>Kuorman merkitys</legend>${Object.entries(LOAD_TYPES).map(([value, label]) => `<label class="choice-option"><input type="radio" name="tracking-load-${i}" data-tracking="loadType" data-i="${i}" value="${value}" ${(t?.loadType ?? 'unknown') === value ? 'checked' : ''}><span>${esc(label)}</span></label>`).join('')}</fieldset>
    <label class="field">Laite / suoritustapa / kuormakäytäntö<input type="text" maxlength="60" value="${esc(t?.variant ?? '')}" data-tracking="variant" data-i="${i}" data-key="tracking-variant-${esc(exercise.id)}" placeholder="Esim. salin jalkaprässi 1, syvyys vakio"></label>
    <p class="muted small-copy">Pidä kuormakäytäntö samana. Vaihda tunniste, jos laite, liikerata tai suoritustapa muuttuu. Käsipainon kg-lukua ei tuplata.</p></details>`;
}

export function statisticsView(state, filters) {
  const data = buildStatistics(state.history, filters);
  const routines = [...new Map([...state.routines.map((r) => [r.id, { value: r.id, label: r.name }]),
    ...state.history.filter((h) => h.routineId).map((h) => [h.routineId, { value: h.routineId, label: h.name }])]).values()];
  const exerciseChoices = data.allGroups.filter((g) => !filters.routineId || g.routineId === filters.routineId);
  const ranges = [['4w', '4 viikkoa'], ['12w', '12 viikkoa'], ['1y', 'Vuosi'], ['all', 'Kaikki'], ['custom', 'Oma jakso']];
  const controls = `<section class="card stat-filters" aria-label="Tilastojen suodattimet"><div class="stat-ranges" role="group" aria-label="Tilastojakso">${ranges.map(([value, label]) => `<button class="btn secondary" data-action="statrange" data-range="${value}" data-key="stat-range-${value}" aria-pressed="${filters.range === value}">${label}</button>`).join('')}</div>
    ${filters.range === 'custom' ? `<div class="stat-filter-grid"><label class="field">Alkupäivä<input type="date" data-stat-date="from" data-key="stat-from" value="${esc(filters.from)}" max="${localDateKey(data.now)}"></label><label class="field">Loppupäivä<input type="date" data-stat-date="to" data-key="stat-to" value="${esc(filters.to)}" max="${localDateKey(data.now)}"></label></div>` : ''}
    <div class="stat-filter-grid">${filterMenu('routineId', 'Harjoitusohjelma', [{ value: '', label: 'Kaikki ohjelmat' }, ...routines.filter((r) => r.value)], filters.routineId)}
    ${filterMenu('exerciseKey', 'Liike ja suoritustapa', [{ value: '', label: 'Kaikki liikkeet' }, ...exerciseChoices.map((g) => ({ value: g.key, label: groupLabel(g) }))], filters.exerciseKey)}</div></section>`;
  if (!data.period.ok) return `<h1 tabindex="-1">Tilastot</h1>${controls}<p class="banner" role="alert">${esc(data.period.error)}</p>`;
  const t = data.totals, p = data.previousTotals;
  const metric = (label, value, comparison, note = '') => `<div class="card stat-metric"><h2>${esc(label)}</h2><strong>${value}</strong><span class="muted small-copy">${esc(comparison)}</span>${note ? `<p class="muted small-copy">${esc(note)}</p>` : ''}</div>`;
  const metrics = [
    metric('Tallennetut treenit', fmt(t.workouts), change(t.workouts, p?.workouts), `${t.partial} osittaista · ${t.activeDays} aktiivista päivää`),
    metric('Tehdyt sarjat', fmt(t.sets), change(t.sets, p?.sets), `${fmt(t.workingSets)} luokiteltua työsarjaa`),
    metric('Kirjatut toistot', t.repSets ? fmt(t.reps) : '—', t.repSets && p?.repSets ? change(t.reps, p.reps) : 'Vertailu vaatii kirjattuja toistoja', `${t.repSets}/${t.sets} sarjassa toistot tiedossa`),
    metric('Ulkoinen volyymi', t.volumeSets ? `${fmt(t.volume)} kg` : '—', t.volumeSets && p?.volumeSets ? change(t.volume, p.volume) : 'Vertailu vaatii tunnetun kg-kuorman', `${t.volumeSets}/${t.sets} sarjaa laskettavissa`),
    metric('Kirjattu treeniaika', t.durationSessions ? `${fmt(t.duration / 3600000, 1)} h` : '—', p ? change(t.duration, p.duration) : 'Ei vertailutietoa', 'Sisältää levot ja auki jääneen harjoituksen ajan.'),
    metric('Kirjatut aikasuoritukset', t.timedSets ? `${fmt(t.seconds / 60, 1)} min` : '—', 'Vain toteutunut kesto, ei tavoiteaikaa', `${t.timedSets} sarjaa`),
  ].join('');
  const maxSets = Math.max(1, ...data.weeks.map((w) => w.sets));
  const weekWidth = 590 / Math.max(1, data.weeks.length);
  const weeklyChart = data.weeks.length ? `<figure class="stat-chart"><svg viewBox="0 0 680 190" role="img" aria-label="Viikoittaiset tehdyt sarjat"><title>Viikoittaiset tehdyt sarjat. Tarkat luvut alla taulukossa.</title><path class="stat-axis" d="M64 15V155H654"/><text x="4" y="28">${fmt(maxSets)}</text><text x="20" y="155">0</text>${data.weeks.map((w, i) => `<rect class="stat-bar" x="${64 + i * weekWidth + 1}" y="${155 - w.sets / maxSets * 130}" width="${Math.max(1, weekWidth - 2)}" height="${w.sets / maxSets * 130}"><title>${esc(date(w.date))}: ${w.sets} sarjaa</title></rect>`).join('')}<text x="64" y="182">${esc(date(data.weeks[0].date))}</text><text x="654" y="182" text-anchor="end">${esc(date(data.weeks.at(-1).date))}</text></svg><figcaption>Tehdyt sarjat viikoittain, myös luokittelemattomat ja lämmittelysarjat. Enintään viimeiset 104 viikkoa valitulta jaksolta.</figcaption></figure>` : '';
  const exerciseTable = data.exercises.length ? table('Liikekohtaiset tulokset valitulta jaksolta', ['Liike', 'Treenit', 'Sarjat', 'Suurin kirjattu kg', 'Paras arvio (kg)', 'Volyymi (kg)'], data.exercises.map((g) => cells(
    `<button class="btn ghost stat-exercise" data-action="statexercise" data-id="${esc(g.key)}">${esc(groupLabel(g))}</button>`,
    fmt(g.points.length), fmt(g.sets), fmt(g.bestLoad, 2), fmt(g.bestEstimate, 1), g.points.some((x) => x.volumeSets) ? fmt(g.volume) : '—'))) : '<p class="muted stat-note">Ei liikekohtaisia tuloksia tällä rajauksella. Vanha yhteenvetohistoria näkyy yleisluvuissa.</p>';
  const selected = filters.exerciseKey && data.exercises.find((g) => g.key === filters.exerciseKey);
  const pageCount = selected ? Math.max(1, Math.ceil(selected.points.length / 50)) : 1;
  const page = Math.min(Math.max(0, filters.page ?? 0), pageCount - 1);
  const pagePoints = selected ? [...selected.points].reverse().slice(page * 50, (page + 1) * 50) : [];
  const detail = selected ? `<section class="card"><h2>${esc(selected.name)}: suoritushistoria</h2><p class="muted stat-note">${esc(LOAD_TYPES[selected.tracking?.loadType ?? 'unknown'])}. Paras arvio huomioi vain indeksikelpoiset sarjat; eri RIR-arvojen vaihtelu voi vaikuttaa tähän kuvaajaan.</p>
    ${trendChart([...pagePoints].reverse().map((x) => ({ at: x.at, value: x.estimate })), 'Kirjatuista työsarjoista laskettu suoritusarvio', 'kg (arvio)')}
    ${table('Suoritukset: vain toteutuneet, tehdyt sarjat', ['Päivä', 'Sarjat', 'Toistot', 'Suurin kg', 'Arvio (kg)', 'Volyymi (kg)'], pagePoints.map((x) => cells(esc(date(x.at)), fmt(x.sets), x.repSets ? fmt(x.reps) : '—', fmt(x.maxLoad, 2), fmt(x.estimate, 1), x.volumeSets ? fmt(x.volume) : '—')))}
    <div class="stat-ranges" role="group" aria-label="Suoritushistorian sivut"><button class="btn secondary" data-action="statpage" data-page="${page - 1}" data-key="stat-previous-page" ${page === 0 ? 'disabled' : ''}>Uudemmat suoritukset</button><button class="btn secondary" data-action="statpage" data-page="${page + 1}" data-key="stat-next-page" ${page + 1 === pageCount ? 'disabled' : ''}>Vanhemmat suoritukset</button></div><p class="muted small-copy" role="status">Sivu ${page + 1}/${pageCount} · ${selected.points.length} treeniä. Kuvaaja ja taulukko näyttävät saman sivun, enintään 50 suoritusta.</p></section>` : '';
  const leading = data.days.length ? (new Date(`${data.days[0].date}T12:00:00`).getDay() + 6) % 7 : 0;
  return `<div class="stat-heading"><p class="eyebrow accent">OMA KEHITYS · TIEDOT VAIN TÄLLÄ LAITTEELLA</p><h1 tabindex="-1">Tilastot</h1><p class="muted">Suorituskyky, harjoittelun jatkuvuus ja kuormitus erikseen — ilman arvattuja tuloksia.</p></div>
    ${indexSection(data, state.statistics)}${controls}<p class="muted stat-period">${esc(date(data.period.from))}–${esc(date(data.period.to - 1))}${p ? ' · vertailu edeltävään samanpituiseen kalenterijaksoon, samaan kellonaikaan asti' : ''}. Treeni kuuluu lopetuspäivälleen. Keskeneräinen treeni ei sisälly lukuihin.</p>
    <div class="stat-metrics">${metrics}</div>${!t.workouts ? '<p class="card" role="status">Ei tallennettuja harjoituksia tällä rajauksella. Vaihda jaksoa tai kirjaa ensimmäinen harjoitus.</p>' : ''}
    <div class="stat-columns"><section class="card"><h2>Harjoittelun jatkuvuus</h2><p class="muted stat-note">Valitun jakson viimeiset 84 päivää. Numero kertoo päivän tallennetut treenit; nolla ei ole tuntematon tulos.</p><div class="calendar-weekdays" aria-hidden="true">${['Ma', 'Ti', 'Ke', 'To', 'Pe', 'La', 'Su'].map((d) => `<span>${d}</span>`).join('')}</div><ol class="activity-calendar" aria-label="Harjoituskalenteri">${Array.from({ length: leading }, () => '<li class="calendar-gap" aria-hidden="true"></li>').join('')}${data.days.map((d) => `<li data-active="${d.workouts > 0}" title="${esc(date(d.date))}: ${d.workouts} treeniä"><span aria-hidden="true">${d.workouts}</span><span class="sr">${esc(date(d.date))}: ${d.workouts} treeniä</span></li>`).join('')}</ol></section>
    <section class="card"><h2>Kuormittavuus ja palautumismerkinnät</h2><p class="stat-note">${t.fatigue} treenissä heikko palautuminen · ${t.pain} liikekirjauksessa kipua.</p><p class="muted stat-note">RIR-jakauma sisältää vain erikseen kirjatut työsarjojen RIR-arvot. Liikkeen RIR kirjataan sen viimeiselle työsarjalle eikä sitä siirretä muille sarjoille. Puuttuva merkintä ei tarkoita hyvää palautumista tai kivuttomuutta.</p>${table('Kirjatut työsarjojen RIR-arvot', ['RIR', 'Sarjoja'], data.efforts.map((n, i) => cells(i === 5 ? '5 tai enemmän' : String(i), fmt(n))))}<p class="muted stat-note">Ei palautumisdiagnoosia. Älä jatka kipua aiheuttavaa liikettä.</p></section></div>
    <section class="card"><h2>Viikoittainen harjoitusmäärä</h2>${weeklyChart}<details class="stat-details"><summary>Viikkoluvut taulukkona</summary>${table('Viikot alkavat maanantaina; reunaviikot voivat olla osittaisia', ['Viikko alkaa', 'Treenit', 'Sarjat', 'Työsarjat', 'Ulkoinen volyymi (kg)'], data.weeks.map((w) => cells(esc(date(w.date)), fmt(w.workouts), fmt(w.sets), fmt(w.workingSets), w.volumeSets ? fmt(w.volume) : '—')))}</details></section>
    <section class="card"><h2>Liikkeet ja henkilökohtaiset parhaat</h2><p class="muted stat-note">Parhaat ovat valitun jakson kirjattuja tuloksia, eivät automaattisesti uusia ennätyksiä. Kuorma-arviota ei lasketa yli 10 toiston sarjoista. Valitse liike nähdäksesi kaikki suoritukset.</p>${exerciseTable}</section>${detail}
    <section class="card"><h2>Luokitellut työsarjat pääryhmittäin</h2><p class="muted stat-note">Liikkeen kirjastoluokka, ei täydellinen lihaskohtainen kuormitusmalli. Avustavien lihasten sarjoja ei arvata. Luokittelemattomat sarjat ja vanha yhteenvetohistoria puuttuvat tästä.</p>${data.muscles.length ? table('Kirjattujen työsarjojen pääryhmät', ['Pääryhmä', 'Työsarjat'], data.muscles.map(([name, n]) => cells(esc(name), fmt(n)))) : '<p class="stat-note muted">Ei luokiteltuja työsarjoja.</p>'}</section>
    <section class="card"><h2>Tietojen kattavuus ja tulkinta</h2><ul class="stat-notes"><li>${t.legacy} vanhaa yhteenvetotreeniä: vain treeni-, sarja- ja aikatiedot ovat käytettävissä.</li><li>${t.missingReps} yksityiskohtaisesta sarjasta puuttuu toteutunut toistomäärä tai kesto. Tavoitteita ei lasketa tuloksiksi.</li><li>${t.unclassifiedSets} sarjan tyyppi on tuntematon. Työsarjojen määrä on vain varmasti luokiteltujen sarjojen määrä.</li><li>${t.volumeSets}/${t.sets} sarjassa on laskettava kg-volyymi. Muu kuorma ja puuttuvat tiedot eivät ole nollia.</li><li>${data.excluded} virheellisesti ajoitettua tai tulevaisuuteen päivättyä treeniä jätettiin pois koko historiasta.</li><li>Ulkoinen volyymi = kirjattu kuorma × toteutuneet toistot. Se sisältää myös lämmittelysarjat eikä mittaa lihaskasvua tai mekaanista työtä. Eri liikkeiden yhteissumma riippuu liikevalinnoista.</li><li>Suodatetun liikkeen treeniaika on koko harjoituksen aika. Prosenttimuutokset voivat johtua myös kirjausten kattavuuden muutoksista.</li></ul><p class="stat-note">Tutkimuspohja ja rajoitukset:</p><ul class="stat-sources"><li><a href="https://acsm.org/resistance-training-guidelines-update-2026/" target="_blank" rel="noopener noreferrer">ACSM 2026: jatkuvuus, voima ja harjoitusmäärä</a></li><li><a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC10579494/" target="_blank" rel="noopener noreferrer">Voima- ja hypertrofiaharjoittelun meta-analyysi</a></li><li><a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC10933212/" target="_blank" rel="noopener noreferrer">Toistomäärien ja maksimivoiman vaihtelu</a></li></ul></section>`;
}
