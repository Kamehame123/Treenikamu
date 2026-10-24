import test from 'node:test';
import assert from 'node:assert/strict';
import * as ui from '../wod-ui.js';
import * as w from '../wod.js';
import * as c from '../core.js';
import { TEMPLATES, TEMPLATE_GROUPS, SEXES, templateById, templateRoutine, DEFAULT_WARMUP, DEFAULT_COOLDOWN } from '../wod-templates.js';

const icon = (name) => `<svg data-icon="${name}"></svg>`;
const clone = (x) => JSON.parse(JSON.stringify(x));

test('the editor keeps only the chosen format\'s settings, as typed text', () => {
  const emom = ui.editorWod({ id: 'a', format: 'emom', every: 60, rounds: 12, minutes: 5, work: 20, alternate: true, score: 'reps', movements: [{ name: 'Burpee', amount: 10 }, null, 'x'] });
  assert.deepEqual(emom, {
    id: 'a', name: '', format: 'emom', every: '60', rounds: '12', alternate: true, ascending: false, score: 'reps',
    movements: [{ id: emom.movements[0].id, name: 'Burpee', amount: '10', load: '', scaled: { name: '', amount: '', load: '' } }],
    stimulus: '', notes: '',
  });
  assert.deepEqual(ui.editorWod(emom), emom, 'opening an editor WOD again changes nothing');
  assert.equal(ui.editorWod({ format: 'bogus' }).format, 'amrap');
  assert.equal(ui.editorWod({ format: 'amrap', score: 'kg' }).score, 'roundsReps', 'a score the format does not offer falls back');
  assert.equal(ui.editorWod({ format: 'fortime', minutes: 0 }).minutes, '', 'a saved cap of 0 means no cap');
  assert.equal(ui.editorWod({ format: 'fortime', minutes: '0' }).minutes, '0', 'a typed 0 stays as typed');
  assert.equal(ui.editorWod({ format: 'fortime' }).scheme, '');
  const many = ui.editorWod({ movements: Array.from({ length: 25 }, (_, i) => ({ name: `Liike ${i}` })) });
  assert.equal(many.movements.length, w.MAX_MOVEMENTS);
});

test('every template opens in the editor and saves back unchanged', () => {
  for (const template of TEMPLATES) {
    for (const sex of Object.keys(SEXES)) {
      const label = `${template.id} ${sex}`;
      const clean = c.sanitizeRoutine(templateRoutine(template, sex));
      const draft = ui.normalizeFunctionalDraft({ ...clone(clean), isNew: false, base: JSON.stringify(clean) });
      assert.deepEqual(ui.normalizeFunctionalDraft(clone(draft)), draft, `${label}: opening is stable`);
      assert.deepEqual(c.validateRoutine(draft), [], label);
      assert.deepEqual(c.sanitizeRoutine(draft), clean, `${label}: saving unchanged gives the same program`);
      draft.wods.forEach((wod, i) => {
        assert.deepEqual(w.sanitizeWod(wod), clean.wods[i], `${label}: WOD ${i + 1}`);
        assert.equal(w.wodKey(w.sanitizeWod(wod)), w.wodKey(clean.wods[i]), `${label}: results stay comparable`);
      });
    }
  }
});

test('switching the format starts from its defaults and keeps the movements, texts and a valid score', () => {
  const amrap = ui.editorWod({ id: 'a', name: 'Perjantai', template: 't', format: 'amrap', minutes: '20', score: 'reps', movements: [{ name: 'Burpee', amount: '10' }], stimulus: 'Tasainen', notes: 'Rauhassa' });
  const emom = ui.switchFormat(amrap, 'emom');
  assert.equal(emom.id, 'a');
  assert.equal(emom.template, 't');
  assert.equal(emom.every, '60');
  assert.equal(emom.rounds, '10');
  assert.equal(Object.hasOwn(emom, 'minutes'), false);
  assert.equal(emom.score, 'reps');
  assert.deepEqual(emom.movements, amrap.movements);
  assert.deepEqual([emom.name, emom.stimulus, emom.notes], ['Perjantai', 'Tasainen', 'Rauhassa']);
  const fortime = ui.switchFormat(emom, 'fortime');
  assert.deepEqual([fortime.rounds, fortime.scheme, fortime.minutes, fortime.score], ['1', '', '', 'time']);
  assert.equal(ui.switchFormat(fortime, 'amrap').minutes, '12');
  for (const format of w.WOD_FORMATS) assert.deepEqual(w.validateWod(ui.switchFormat(amrap, format)), [], format);
});

test('a new WOD is a 12 min AMRAP that only needs its movement named', () => {
  const wod = ui.newEditorWod();
  assert.deepEqual([wod.format, wod.minutes, wod.score, wod.movements.length], ['amrap', '12', 'roundsReps', 1]);
  assert.deepEqual(w.validateWod(wod), ['WOD, liike 1: lisää nimi.']);
  wod.movements[0].name = 'Burpee';
  assert.deepEqual(w.validateWod(wod), []);
  const routine = { id: 'r', name: 'Uusi', type: 'functional', exercises: [], warmup: null, wods: [wod], cooldown: null };
  assert.deepEqual(c.validateRoutine(routine), []);
  const saved = c.sanitizeRoutine(routine);
  assert.equal(saved.wods[0].minutes, 12);
  assert.equal(Object.hasOwn(saved, 'warmup'), false, 'an empty warm-up is not saved');
});

test('warm-up and cool-down start from the default text and keep a cleared duration empty', () => {
  assert.equal(ui.editorBlock(null), null);
  assert.equal(ui.editorBlock('teksti'), null);
  assert.deepEqual(ui.editorBlock({ text: 'Soutu', minutes: 0 }), { text: 'Soutu', minutes: '' });
  assert.deepEqual(ui.editorBlock({ text: 'Soutu', minutes: 10 }), { text: 'Soutu', minutes: '10' });
  assert.deepEqual(ui.newBlock('warmup'), { text: DEFAULT_WARMUP.text, minutes: String(DEFAULT_WARMUP.minutes) });
  assert.deepEqual(ui.newBlock('cooldown'), { text: DEFAULT_COOLDOWN.text, minutes: String(DEFAULT_COOLDOWN.minutes) });
  for (const kind of ui.BLOCK_KINDS) assert.deepEqual(w.sanitizeBlock(ui.newBlock(kind)), { ...(kind === 'warmup' ? DEFAULT_WARMUP : DEFAULT_COOLDOWN) });
});

test('a restored draft drops broken parts and keeps at most three WODs', () => {
  const draft = ui.normalizeFunctionalDraft({ id: 'r', name: '', exercises: [], warmup: 'x', wods: [null, 'x', { format: 'emom' }, {}, {}, {}], cooldown: { text: 'Venyttely', minutes: 5 } });
  assert.equal(draft.type, 'functional');
  assert.equal(draft.warmup, null);
  assert.deepEqual(draft.cooldown, { text: 'Venyttely', minutes: '5' });
  assert.deepEqual(draft.wods.map((x) => x.format), ['emom', 'amrap', 'amrap']);
  assert.deepEqual(ui.normalizeFunctionalDraft({ wods: 'x' }).wods, []);
});

test('the board preview shows what the save would store, escaped', () => {
  const tabata = ui.editorWod({ format: 'intervals', work: '20', rest: '10', rounds: '8', name: '<b>Tabata</b>', stimulus: 'Kova & lyhyt', movements: [{ name: 'Kyykky <script>', scaled: { amount: '10' } }] });
  const html = ui.boardPreview(tabata);
  assert.match(html, /&lt;b&gt;Tabata&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<script>|<b>/);
  assert.match(html, /8 × 20 s työ \/ 10 s lepo/);
  assert.match(html, /Kesto noin 3,8 min/);
  assert.match(html, /Kova &amp; lyhyt/);
  assert.match(html, /Skaalattu/);
  const empty = ui.boardPreview(ui.editorWod({ format: 'fortime', movements: [] }));
  assert.match(empty, /Lisää liikkeitä, niin ne näkyvät tässä\./);
  assert.match(empty, /Kesto riippuu tahdista/);
  const pills = ui.boardPreview(ui.editorWod({ format: 'amrap', movements: [{ name: 'Yleisliike', sourceId: 'lib-yleisliike' }] }));
  assert.match(pills, /<span class="pill">Voimistelu<\/span>/);
});

test('the scaled summary says what the scaled version is', () => {
  assert.equal(ui.scaledSummary(ui.editorMovement({ name: 'Leuanveto', amount: '10' })), 'Ei asetettu');
  assert.equal(ui.scaledSummary(ui.editorMovement({ name: 'Leuanveto', amount: '10', scaled: { name: ' Rengasveto ' } })), '10 Rengasveto');
  assert.equal(ui.scaledSummary(ui.editorMovement({ name: 'Rintaheitto', amount: '15', load: '43 kg', scaled: { load: '20 kg' } })), '15 Rintaheitto (20 kg)');
});

test('the WOD editor labels every control and marks the chosen settings', () => {
  const wod = ui.editorWod({ id: 'wod-1', format: 'fortime', scheme: '21-15-9', minutes: '10', movements: [{ id: 'm-1', name: 'Kahvakuulaheilautus', amount: '', load: '24 kg', scaled: { load: '16 kg' } }, { id: 'm-2', name: 'Burpee' }] });
  const html = ui.wodEditor(wod, 1, 2, { icon, openScaled: new Set(['m-1']) });
  assert.match(html, /<h2 class="wod-title">WOD 2<\/h2>/);
  assert.match(html, /aria-label="Poista WOD 2"/);
  assert.match(html, /<input type="radio" name="wodformat-1" value="fortime" data-wf="format" data-w="1" data-key="wodformat-wod-1-fortime" checked>/);
  assert.match(html, /data-scheme="21-15-9" data-key="scheme-wod-1-0" aria-pressed="true"/);
  assert.match(html, /<label class="field" id="wrounds-field-1" hidden>/, 'a ladder hides the rounds');
  assert.match(html, /aria-label="Siirrä liike 1 ylös \(WOD 2\)">/);
  assert.match(html, /data-key="mup-m-1" disabled/);
  assert.match(html, /data-key="mdown-m-2" disabled/);
  assert.match(html, /<details class="move-scaled" data-scaled="m-1" open>/);
  assert.match(html, /<details class="move-scaled" data-scaled="m-2" >/);
  assert.match(html, /id="mscaled-sum-1-0">Kahvakuulaheilautus \(16 kg\)</);
  assert.match(html, /aria-label="Lisää liike \(WOD 2\)" >/);
  assert.match(html, /id="wod-board-1"/);
  assert.match(html, /Tulos on aika\./);
  assert.doesNotMatch(ui.wodEditor(wod, 0, 1, { icon }), /data-action="rmwod"/, 'the only WOD cannot be removed');

  const full = ui.editorWod({ format: 'amrap', movements: Array.from({ length: w.MAX_MOVEMENTS }, (_, i) => ({ name: `Liike ${i}` })) });
  const fullHtml = ui.wodEditor(full, 0, 1, { icon });
  assert.match(fullHtml, /data-action="addmove"[^>]* disabled>/);
  assert.match(fullHtml, /data-action="addmovelib"[^>]* disabled>/);
  assert.match(fullHtml, /<details class="choice-menu" id="wscore-0">/);

  const emom = ui.wodEditor(ui.editorWod({ format: 'emom', alternate: true }), 0, 1, { icon });
  assert.match(emom, /data-wf="alternate"[^>]* checked>/);
  assert.doesNotMatch(emom, /data-wf="ascending"[^>]* checked>/);
  assert.match(ui.wodEditor(ui.editorWod({ format: 'intervals' }), 0, 1, { icon }), /data-action="tabata"/);
});

test('editor text is escaped wherever it is shown', () => {
  const evil = '"><img src=x onerror=alert(1)></textarea>';
  const wod = ui.editorWod({ id: evil, name: evil, notes: evil, stimulus: evil, movements: [{ id: evil, name: evil, amount: evil, scaled: { name: evil } }] });
  const html = ui.wodEditor(wod, 0, 1, { icon }) + ui.blockSection('warmup', { text: evil, minutes: evil }, icon);
  assert.doesNotMatch(html, /<img/);
  assert.equal(html.match(/<\/textarea>/g).length, 2, 'only the two real textareas close');
});

test('the type chooser and the guide describe both program types without brand names', () => {
  const choices = ui.typeChoices(icon);
  assert.match(choices, /data-action="newgym"[^>]*aria-describedby="newgym-note"/);
  assert.match(choices, /data-action="newfunctional"[^>]*aria-describedby="newfunctional-note"/);
  assert.match(choices, /data-action="newtemplate"[^>]*aria-describedby="newtemplate-note"/);
  assert.doesNotMatch(choices, /aria-label=/, 'the visible type name is the accessible name');
  assert.match(choices, /<strong>Kuntosalitreeni<\/strong><span class="choice-meta" id="newgym-note" aria-hidden="true">/);
  assert.match(choices, /<strong>Toiminnallinen treeni<\/strong><span class="choice-meta" id="newfunctional-note" aria-hidden="true">/);
  assert.match(choices, /<strong>Aloita mallista<\/strong><span class="choice-meta" id="newtemplate-note" aria-hidden="true">/);
  const guide = ui.wodGuide(true);
  assert.match(guide, /<details class="wod-guide card" open>/);
  assert.match(guide, /Lämmittely 10–15 min/);
  assert.doesNotMatch(ui.wodGuide(false), / open>/);
  const all = [choices, guide, ui.wodEditor(ui.newEditorWod(), 0, 1, { icon }), ui.blockSection('warmup', null, icon)].join('');
  assert.doesNotMatch(all, /crossfit/i);
  assert.match(ui.blockSection('cooldown', null, icon), /data-action="addblock" data-block="cooldown" data-key="addblock-cooldown"/);
});

const templateCard = (html, name) => html.split('<li class="card template-card">').find((chunk) => chunk.startsWith(`<h2>${name}</h2>`)) ?? '';

test('the gallery shows one group at a time and marks the chosen group and loads', () => {
  for (const group of Object.keys(TEMPLATE_GROUPS)) {
    const html = ui.templateGallery(group, 'women', icon);
    assert.deepEqual([...html.matchAll(/data-action="usetemplate" data-template="([^"]+)"/g)].map((m) => m[1]), TEMPLATES.filter((t) => t.group === group).map((t) => t.id), group);
    assert.match(html, new RegExp(`data-group="${group}" data-key="templategroup-${group}" aria-pressed="true"`));
    assert.match(html, /data-sex="women" data-key="templatesex-women" aria-pressed="true"/);
    assert.equal(html.match(/aria-pressed="true"/g).length, 2, 'one group and one load choice');
    assert.match(html, /<span class="eyebrow" id="gallery-loads">Ehdotetut kuormat<\/span><div class="segmented" role="group" aria-labelledby="gallery-loads">/);
    assert.doesNotMatch(html, /crossfit/i);
  }
  assert.equal(new Set(TEMPLATES.map((t) => t.id)).size, TEMPLATES.length, 'template ids are unique');
  assert.equal(ui.isTemplateGroup('benchmark'), true);
  assert.equal(ui.isSex('men'), true);
  for (const bad of ['', 'toString', '__proto__', null, 1]) {
    assert.equal(ui.isTemplateGroup(bad), false, String(bad));
    assert.equal(ui.isSex(bad), false, String(bad));
  }
});

test('a gallery card previews the whiteboard with the chosen loads and names its button', () => {
  const women = templateCard(ui.templateGallery('benchmark', 'women', icon), 'Fran');
  const men = templateCard(ui.templateGallery('benchmark', 'men', icon), 'Fran');
  assert.match(women, /<p class="board-headline">21-15-9 aikaa vastaan · aikaraja 10 min<\/p>/);
  assert.match(women, /<li>Kyykkypunnerrus tangolla \(29 kg\)<\/li><li>Leuanveto myötäotteella<\/li>/);
  assert.match(men, /<li>Kyykkypunnerrus tangolla \(43 kg\)<\/li>/);
  assert.match(women, /Kesto noin 10 min/);
  assert.match(women, /<p class="board-stimulus">Lyhyt ja erittäin kova/);
  assert.match(women, /data-template="fran" data-key="use-fran">Käytä mallia<span class="sr"> Fran<\/span> <svg data-icon="arrow"><\/svg><\/button>/);
  assert.doesNotMatch(women, /template-parts/, 'a WOD-only template does not list class parts');

  const murph = (sex) => templateCard(ui.templateGallery('benchmark', sex, icon), 'Murph');
  assert.match(murph('women'), /<p class="field-hint">Rx tehdään 6 kg painoliivin kanssa\./);
  assert.match(murph('men'), /<p class="field-hint">Rx tehdään 9 kg painoliivin kanssa\./);
  assert.match(murph('women'), /Kesto riippuu tahdista/);

  const formats = ui.templateGallery('format', 'women', icon);
  assert.doesNotMatch(templateCard(formats, 'AMRAP 12 min'), /board-headline/, 'a headline equal to the name is not repeated');
  assert.match(templateCard(formats, 'Kokonainen tunti'), /<p class="template-parts">Lämmittely 12 min · Takakyykky 5 × 5 · WOD · Loppuverryttely 8 min<\/p>/);
  assert.match(templateCard(formats, 'Tabata'), /<p class="field-hint">Perinteinen tulos on heikoimman jakson toistot\./);
});

// ---- Running workout ----

const franWod = (history = []) => c.startSession(c.sanitizeRoutine(templateRoutine(templateById('fran'), 'women')), 1000, { history }).wods[0];
const franHistory = (wod, result) => [{ id: 'h1', endedAt: Date.UTC(2025, 2, 4, 12), wods: [{ id: 'x', key: wod.key, name: 'Fran', format: 'fortime', score: 'time', board: 'b', result }] }];

test('warm-up and cool-down cards show the plan and a "Valmis" toggle named for screen readers', () => {
  const open = ui.sessionBlock('warmup', { text: 'Soutu 5 min\n<b>Liikkuvuus</b>', minutes: 12, done: false }, icon);
  assert.match(open, /^<div class="card block-card" id="block-warmup"><div class="block-heading"><h2>Lämmittely<\/h2><span class="badge">12 min<\/span><\/div>/);
  assert.match(open, /<p class="block-text">Soutu 5 min\n&lt;b&gt;Liikkuvuus&lt;\/b&gt;<\/p>/);
  assert.match(open, /<button class="btn secondary block-done" data-action="blockdone" data-block="warmup" data-key="blockdone-warmup" aria-pressed="false"><span class="sr">Lämmittely: <\/span>Valmis<\/button><\/div>$/);
  const done = ui.sessionBlock('cooldown', { text: '', minutes: null, done: true }, icon);
  assert.match(done, /^<div class="card block-card complete" id="block-cooldown">/);
  assert.match(done, /aria-pressed="true"><svg data-icon="check"><\/svg><span class="sr">Loppuverryttely: <\/span>Valmis<\/button>/);
  assert.doesNotMatch(done, /block-text|class="badge"/);
});

test('a WOD card shows the whiteboard of the chosen version and the next step', () => {
  const wod = franWod();
  const html = ui.sessionWodCard(wod, 0, { count: 1, history: [], current: true, icon });
  assert.match(html, /^<li class="card wod-card current" id="wod-0"><div class="exercise-heading"><span class="exercise-index">WOD<\/span><h2 class="grow">Fran<\/h2><span class="badge now">Vuorossa<\/span><\/div>/);
  assert.match(html, /<div class="segmented" role="group" aria-label="Näytettävä versio: Fran">/);
  assert.match(html, new RegExp(`data-action="wodversion" data-w="0" data-division="rx" data-key="wodversion-${wod.id}-rx" aria-pressed="true">Rx</button>`));
  assert.match(html, /data-division="scaled"[^>]*aria-pressed="false">Skaalattu<\/button>/);
  assert.match(html, /<li>Kyykkypunnerrus tangolla \(29 kg\)<\/li><li>Leuanveto myötäotteella<\/li>/);
  assert.match(html, /<p class="board-stimulus">/);
  assert.match(html, /<div class="wod-past"><p>Ensimmäinen kerta: tulos on lähtötasosi\.<\/p><\/div>/);
  assert.match(html, new RegExp(`<div class="wod-actions"><button class="btn primary big" data-action="clockstart" data-w="0" data-key="clockstart-${wod.id}">Käynnistä kello<span class="sr"> \\(Fran\\)</span> <svg data-icon="stopwatch"></svg></button><button class="btn secondary" data-action="openresult" data-w="0" data-key="openresult-${wod.id}">Kirjaa tulos<span class="sr"> \\(Fran\\)</span> <svg data-icon="arrow"></svg></button></div></li>$`), 'the clock leads; a result timed elsewhere can still be logged');
  assert.doesNotMatch(html, /result-form|clock-status|Skaalattua versiota ei ole|crossfit/i);

  const scaled = ui.sessionWodCard({ ...wod, division: 'scaled' }, 1, { count: 2, icon });
  assert.match(scaled, /^<li class="card wod-card" id="wod-1"><div class="exercise-heading"><span class="exercise-index">WOD 2<\/span><h2 class="grow">Fran<\/h2><\/div>/);
  assert.match(scaled, /data-division="scaled"[^>]*aria-pressed="true">Skaalattu<\/button>/);
  assert.match(scaled, /<li>Kyykkypunnerrus tangolla \(20 kg\)<\/li><li>Avustettu leuanveto<\/li>/);
  const unwritten = ui.sessionWodCard({ ...wod, division: 'scaled', movements: wod.movements.map(({ scaled: _, ...m }) => m) }, 0, { count: 1, icon });
  assert.match(unwritten, /Skaalattua versiota ei ole kirjoitettu\./);
  const none = ui.sessionWodCard({ ...wod, score: 'none' }, 0, { count: 1, icon });
  assert.doesNotMatch(none, /wod-past/, 'a part without a score has no baseline to mention');

  const evil = '"><img src=x onerror=alert(1)>';
  const escaped = ui.sessionWodCard({ ...wod, name: evil, notes: evil, stimulus: evil, movements: [{ ...wod.movements[0], name: evil }] }, 0, { count: 1, form: w.resultFields(wod), icon });
  assert.doesNotMatch(escaped, /<img/);
});

test('the result form asks for the score of the WOD and swaps the time for reps when capped', () => {
  const wod = franWod(), fields = w.resultFields(wod);
  const form = ui.resultForm(wod, 0, fields);
  assert.match(form, /^<form class="result-form" id="result-form-0" data-w="0" aria-labelledby="result-title-0" novalidate><h3 id="result-title-0">Kirjaa tulos<span class="sr"> \(Fran\)<\/span><\/h3>/);
  assert.match(form, /<div class="result-pair" id="rf-time-0"><label class="field">Minuutit<input type="number" inputmode="numeric" min="0" max="1440" step="1" value="" data-rf="min"/);
  assert.match(form, /Sekunnit<input type="number" inputmode="numeric" min="0" max="59"/);
  assert.match(form, /Aikaraja tuli vastaan \(10 min\)/);
  assert.match(form, /<div id="rf-cap-0" hidden><label class="field">Toistot aikarajaan mennessä/);
  assert.match(form, /<fieldset class="result-division"><legend>Versio<\/legend>/);
  assert.match(form, /value="rx" data-rf="division" data-key="rf-division-[^"]+-rx" checked>/);
  assert.match(form, /<textarea maxlength="300" rows="2" data-rf="notes"/);
  assert.match(form, /<button type="submit" class="btn primary" data-action="saveresult" data-w="0"/);
  assert.doesNotMatch(form, /data-rf="rpe"|clearresult|role="alert"/);

  const capped = ui.resultForm(wod, 0, { ...fields, capped: true, reps: '150' }, { error: 'Korjaa <b>', advanced: true });
  assert.match(capped, /<div class="result-pair" id="rf-time-0" hidden>/);
  assert.match(capped, /data-rf="capped" data-w="0" data-key="rf-capped-[^"]+" checked>/);
  assert.match(capped, /<div id="rf-cap-0"><label/);
  assert.match(capped, /value="150" data-rf="reps"/);
  assert.match(capped, /<p class="banner" id="result-error-0" role="alert" tabindex="-1">Korjaa &lt;b&gt;<\/p>/);
  assert.match(capped, /Rasittavuus \(RPE 1–10\)[^<]*<span class="optional">valinnainen<\/span><input type="number" inputmode="numeric" min="1" max="10"/);
  assert.doesNotMatch(ui.resultForm({ ...wod, minutes: 0 }, 0, fields), /data-rf="capped"|rf-cap-0/, 'without a time cap there is nothing to toggle');

  const logged = { ...wod, result: { kind: 'time', seconds: 290, division: 'scaled', notes: 'Hyvä' } };
  const edit = ui.resultForm(logged, 0, w.resultFields(logged));
  assert.match(edit, /<h3 id="result-title-0">Muokkaa tulosta/);
  assert.match(edit, /value="4" data-rf="min"/);
  assert.match(edit, /value="50" data-rf="sec"/);
  assert.match(edit, /value="scaled" data-rf="division"[^>]* checked>/);
  assert.match(edit, />Hyvä<\/textarea>/);
  assert.match(edit, /data-action="clearresult" data-w="0"/);

  const kind = (score) => ui.resultForm({ ...wod, score }, 0, fields);
  assert.match(kind('roundsReps'), /Kierrokset<input[^>]*data-rf="rounds"[\s\S]*Lisätoistot<input[^>]*data-rf="reps"/);
  assert.match(kind('kg'), /Kuorma \(kg\)<input type="text" inputmode="decimal" value="" data-rf="value"/);
  assert.match(kind('cal'), /Kalorit<input type="number"[^>]*data-rf="value"/);
  assert.match(kind('none'), /Tälle osalle ei kirjata lukua\./);
  assert.doesNotMatch(kind('none'), /data-rf="(min|sec|reps|rounds|value)"/);
});

test('a logged WOD shows its score, version, a new record and the record cheer', () => {
  const first = franWod();
  const history = franHistory(first, { kind: 'time', seconds: 300, division: 'rx' });
  const wod = franWod(history);
  assert.match(ui.sessionWodCard(wod, 0, { count: 1, history, icon }), /<div class="wod-past"><p>Edellinen 4\.3\.: 5:00 · Rx<\/p><p>Ennätys: Rx 5:00<\/p><\/div>/);

  const done = { ...wod, result: { kind: 'time', seconds: 280, division: 'rx', rpe: 8, notes: 'Kova <3' } };
  const html = ui.sessionWodCard(done, 0, { count: 1, history, current: false, cheer: 'Nytt personbästa!', icon });
  assert.match(html, /^<li class="card wod-card complete" id="wod-0">/);
  assert.match(html, /<span class="badge done-badge">Kirjattu<\/span>/);
  assert.match(html, /<p class="wod-score"><span class="eyebrow">Tulos<\/span> <strong>4:40<\/strong> <span class="badge">Rx<\/span> <span class="badge done-badge">Uusi ennätys<\/span><\/p>/);
  assert.match(html, /<p class="field-hint">RPE 8<\/p>/);
  assert.match(html, /<p class="wod-notes">Kova &lt;3<\/p>/);
  assert.match(html, /<p class="cheer">Nytt personbästa!<\/p>/);
  assert.match(html, /data-action="openresult"[^>]*>Muokkaa tulosta<span class="sr"> \(Fran\)<\/span><\/button><\/div><\/li>$/);
  assert.doesNotMatch(html, /btn primary big|result-form/);

  assert.doesNotMatch(ui.sessionWodCard({ ...done, result: { kind: 'time', seconds: 300, division: 'rx' } }, 0, { count: 1, history, icon }), /Uusi ennätys/, 'equalling the best is no record');
  assert.doesNotMatch(ui.sessionWodCard({ ...done, result: { kind: 'time', seconds: 200, division: 'scaled' } }, 0, { count: 1, history, icon }), /Uusi ennätys/, 'the first scaled result is a baseline');
  assert.match(ui.sessionWodCard({ ...done, result: { kind: 'time', capped: true, reps: 120, seconds: 600, division: 'rx' } }, 0, { count: 1, history, icon }), /<strong>Aikaraja 10:00 \+ 120 toistoa<\/strong>/);
  const editing = ui.sessionWodCard(done, 0, { count: 1, history, form: w.resultFields(done), icon });
  assert.match(editing, /<form class="result-form"/);
  assert.doesNotMatch(editing, /wod-score/, 'the open form replaces the summary');
});

// ---- WOD clock ----

const T0 = Date.UTC(2025, 2, 4, 12), PRE = w.PREROLL_MS;
const timed = (wod, laps = [], extra = {}) => ({ ...wod, clock: { startedAt: T0, pausedAt: null, pausedMs: 0, laps, ...extra } });
const templateWod = (id) => c.startSession(c.sanitizeRoutine(templateRoutine(templateById(id), 'women')), T0, { history: [] }).wods[0];

test('the WOD card starts the clock, follows a running one and logs what an ended one measured', () => {
  const wod = franWod(), id = wod.id;
  const running = ui.sessionWodCard(timed(wod), 0, { count: 1, current: true, icon, now: T0 + PRE + 65000 });
  assert.match(running, new RegExp(`<p class="clock-status">Kello: <span id="wc-mini-0">Aikaa vastaan · 1:05</span></p><button class="btn primary big" data-action="clockopen" data-w="0" data-key="clockopen-${id}">Avaa kello<span class="sr"> \\(Fran\\)</span> <svg data-icon="stopwatch"></svg></button></li>$`));
  assert.doesNotMatch(running, /data-action="(clockstart|openresult)"/, 'a running clock is followed, not restarted or logged by hand');
  assert.match(ui.sessionWodCard(timed(wod), 0, { count: 1, icon, now: T0 + 3000 }), /<span id="wc-mini-0">Valmistaudu · 7<\/span>/);
  assert.match(ui.sessionWodCard(timed(wod, [], { pausedAt: T0 + PRE + 30000 }), 0, { count: 1, icon, now: T0 + PRE + 90000 }), /<span id="wc-mini-0">Tauolla · 0:30<\/span>/);

  const ended = timed(wod, [], { endedAt: T0 + PRE + 272000 });
  assert.match(ui.sessionWodCard(ended, 0, { count: 1, icon, now: T0 + 9e6 }), new RegExp(`<p class="clock-status">Kello: <span id="wc-mini-0">Valmis · 4:32</span></p><div class="wod-actions"><button class="btn primary big" data-action="openresult" data-w="0" data-key="openresult-${id}">Kirjaa tulos<span class="sr"> \\(Fran\\)</span> <svg data-icon="arrow"></svg></button><button class="btn secondary" data-action="clockstart" data-w="0" data-key="clockstart-${id}">Käynnistä kello uudelleen<span class="sr"> \\(Fran\\)</span> <svg data-icon="stopwatch"></svg></button></div></li>$`));
  const form = ui.sessionWodCard(ended, 0, { count: 1, icon, form: w.resultFields(ended) });
  assert.match(form, /<p class="clock-status">Kello: Valmis · 4:32<\/p><form class="result-form"/, 'the form says what the clock measured');
  assert.match(form, /value="4" data-rf="min"[\s\S]*value="32" data-rf="sec"/);
  const capped = timed(wod, [], { endedAt: T0 + PRE + 600000 });
  assert.match(ui.sessionWodCard(capped, 0, { count: 1, icon, form: w.resultFields(capped) }), /Kello: Aikaraja · 10:00<\/p>[\s\S]*data-rf="capped"[^>]* checked>/);

  const logged = { ...ended, result: { kind: 'time', seconds: 272, division: 'rx' } };
  assert.doesNotMatch(ui.sessionWodCard(logged, 0, { count: 1, icon }), /clock-status|data-action="clock/, 'a logged part shows its result');
  assert.doesNotMatch(ui.sessionWodCard(logged, 0, { count: 1, icon, form: w.resultFields(logged) }), /clock-status/, 'correcting a result does not repeat the clock');

  const cindy = timed(templateWod('cindy'), [300000, 610000, 900000], { endedAt: T0 + PRE + 1200000 });
  assert.match(ui.sessionWodCard(cindy, 0, { count: 1, icon }), /<span id="wc-mini-0">Aika loppui · 20:00 · 3 kierrosta<\/span>/);
});

test('the clock screen shows the pre-roll, the time with the round to do, and controls for the format', () => {
  const fran = franWod(), screen = (wod, now, count = 1) => ui.clockScreen(wod, 0, { count, history: [], icon, now });
  const pre = screen(timed(fran), T0 + 3000);
  assert.match(pre, /^<div class="stat-heading"><p class="eyebrow accent">WOD · Rx<\/p><h1 tabindex="-1">Fran<\/h1><\/div><section class="card timer-card wod-clock" id="wod-clock" data-phase="preroll" data-segment="" data-paused="false" aria-label="WOD-kello">/);
  assert.match(pre, /<span class="timer-round" id="wc-label">Valmistaudu<\/span><strong class="timer-clock" id="wc-time">7<\/strong><p class="timer-label" id="wc-target" hidden><\/p><p class="timer-next muted" id="wc-detail">21-15-9 aikaa vastaan · aikaraja 10 min<\/p><\/section>/);
  assert.match(pre, /<div class="clock-laps"><button class="btn primary clock-lap" data-action="clocklap" data-key="clocklap" aria-disabled="true">\+1 kierros<\/button><p class="clock-lap-info">Napauta \+1 kierros aina, kun kierros on tehty\.<\/p><\/div>/);
  assert.match(pre, /<div class="timer-controls timer-run-controls"><button class="btn" data-action="clockstop" data-key="clock-stop"><svg data-icon="stop"><\/svg>Lopeta<\/button><button class="btn" data-action="clockpause" data-key="clock-pause"><svg data-icon="pause"><\/svg>Tauko<\/button><button class="btn" data-action="clockdone" data-key="clock-done" aria-disabled="true"><svg data-icon="check"><\/svg>Valmis<\/button><\/div>/);
  assert.match(pre, /<section class="card clock-board" aria-label="Taulu: Fran"><div class="wod-board"><p class="board-headline">21-15-9 aikaa vastaan · aikaraja 10 min<\/p>/);
  assert.match(pre, /<p class="board-stimulus">Lyhyt ja erittäin kova[^<]*<\/p><div class="wod-past"><p>Ensimmäinen kerta: tulos on lähtötasosi\.<\/p><\/div><\/section>$/);
  assert.doesNotMatch(pre, /board-meta|clockundo|crossfit/i, 'the board on the clock skips the duration and equipment');

  const go = screen(timed(fran), T0 + PRE + 1000);
  assert.match(go, /data-phase="run" data-segment="" data-paused="false"/);
  assert.match(go, /id="wc-label">Nyt!<\/span><strong class="timer-clock" id="wc-time">0:01<\/strong><p class="timer-label" id="wc-target">Nyt: 21<\/p><p class="timer-next muted" id="wc-detail">Kierros 1\/3 · aikaraja 10:00<\/p>/);
  assert.match(go, /data-action="clocklap" data-key="clocklap" aria-disabled="false">/);
  assert.match(go, /<button class="btn" data-action="clockdone" data-key="clock-done" aria-disabled="false">/, 'with rounds left to count, the round counter leads');

  const second = screen(timed(fran, [60000]), T0 + PRE + 90000);
  assert.match(second, /id="wc-time">1:30<\/strong><p class="timer-label" id="wc-target">Nyt: 15<\/p><p class="timer-next muted" id="wc-detail">Kierros 2\/3 · aikaraja 10:00<\/p>/);
  assert.match(second, /<p class="clock-lap-info">1 kierros tehty · viimeisin 1:00<\/p><button class="btn ghost" data-action="clockundo" data-key="clockundo">Peru viimeisin kierros<\/button><\/div>/);

  const last = screen(timed(fran, [60000, 150000]), T0 + PRE + 200000);
  assert.match(last, /<div class="clock-laps"><p class="clock-lap clock-lap-final" data-key="clocklap" tabindex="-1">Viimeinen kierros<small>Paina Valmis, kun kierros on tehty\.<\/small><\/p><p class="clock-lap-info">2 kierrosta tehty · viimeisin 1:30<\/p>/);
  assert.match(last, /id="wc-target">Nyt: 9<\/p>/);
  assert.match(last, /<button class="btn primary" data-action="clockdone" data-key="clock-done" aria-disabled="false"><svg data-icon="check"><\/svg>Valmis<\/button>/, 'on the last round, "Valmis" leads');
  assert.doesNotMatch(last, /data-action="clocklap"/, 'a round that does not exist cannot be tapped');

  const paused = screen(timed(fran, [60000], { pausedAt: T0 + PRE + 70000 }), T0 + PRE + 500000);
  assert.match(paused, /data-phase="run" data-segment="" data-paused="true"/);
  assert.match(paused, /id="wc-label">Tauolla<\/span><strong class="timer-clock" id="wc-time">1:10<\/strong>/);
  assert.match(paused, /data-action="clocklap" data-key="clocklap" aria-disabled="true">/);
  assert.match(paused, /<button class="btn primary" data-action="clockresume" data-key="clock-pause"><svg data-icon="play"><\/svg>Jatka<\/button>/);

  const done = screen(timed(fran, [60000, 150000], { endedAt: T0 + PRE + 272000 }), T0 + 9e6);
  assert.match(done, /<section class="card timer-card wod-clock" id="wod-clock" data-phase="done" aria-label="WOD-kello"><span class="eyebrow accent"><svg data-icon="check"><\/svg> Valmis<\/span><strong class="timer-clock">4:32<\/strong><\/section><div class="timer-controls"><button class="btn" data-action="clockback" data-key="clockback-done">Harjoitukseen<\/button><button class="btn primary" data-action="clocklog" data-key="clocklog">Kirjaa tulos<\/button><\/div><section class="card clock-board"/);
  assert.doesNotMatch(done, /id="wc-|clock-laps|timer-run-controls/, 'an ended clock has nothing left to update or control');
  assert.match(screen({ ...timed(fran, [], { endedAt: T0 + PRE + 272000 }), result: { kind: 'time', seconds: 272, division: 'rx' } }, T0), /data-key="clocklog">Muokkaa tulosta<\/button>/);
  assert.match(ui.clockScreen({ ...timed(fran), division: 'scaled' }, 1, { count: 2, icon, now: T0 }), /<p class="eyebrow accent">WOD 2 · Skaalattu<\/p>[\s\S]*<li>Avustettu leuanveto<\/li>/);

  const grace = screen(timed(templateWod('grace')), T0 + PRE + 5000);
  assert.doesNotMatch(grace, /clock-laps/, 'one round has nothing to count');
  assert.match(grace, /<button class="btn primary" data-action="clockdone"/);

  const cindy = screen(timed(templateWod('cindy'), [100000, 200000]), T0 + PRE + 300000);
  assert.match(cindy, /id="wc-label">AMRAP<\/span><strong class="timer-clock" id="wc-time">15:00<\/strong><p class="timer-label" id="wc-target" hidden><\/p><p class="timer-next muted" id="wc-detail">Kierros 3<\/p>/);
  assert.match(cindy, /<p class="clock-lap-info">2 kierrosta tehty · viimeisin 1:40<\/p>/);
  assert.match(cindy, /<div class="timer-controls timer-run-controls clock-controls-2"><button class="btn" data-action="clockstop"[^>]*>[\s\S]*Lopeta<\/button><button class="btn" data-action="clockpause"[^>]*>[\s\S]*Tauko<\/button><\/div>/, 'a time-capped format has no "Valmis"');
  assert.match(screen(timed(templateWod('cindy'), [100000, 200000, 900000], { endedAt: T0 + PRE + 1200000 }), T0), /> Aika loppui<\/span><strong class="timer-clock">20:00<\/strong><p class="timer-label">3 kierrosta<\/p><\/section>/);

  const emom = screen(timed(templateWod('emom-10')), T0 + PRE + 5000);
  assert.match(emom, /id="wc-label">Minuutti 1\/10<\/span><strong class="timer-clock" id="wc-time">0:55<\/strong>/);
  assert.doesNotMatch(emom, /clock-laps|clockdone/);
  const tabata = timed(templateWod('tabata'));
  assert.match(screen(tabata, T0 + PRE + 5000), /data-phase="run" data-segment="work"[\s\S]*id="wc-label">TYÖ</);
  assert.match(screen(tabata, T0 + PRE + 25000), /data-phase="run" data-segment="rest"[\s\S]*id="wc-label">LEPO</);

  assert.match(screen(timed({ ...fran, minutes: 0 }), T0 + PRE + 3600000), /<strong class="timer-clock long" id="wc-time">1:00:00<\/strong>/, 'an hour fits on a narrow screen');
  const evil = '"><img src=x onerror=alert(1)>';
  assert.doesNotMatch(screen(timed({ ...fran, name: evil, stimulus: evil, movements: [{ ...fran.movements[0], name: evil }] }), T0 + PRE + 1000), /<img/);
});

test('the clock status line names a paused clock and adds the score only once the clock has ended', () => {
  assert.equal(ui.clockStatus({ phase: 'run', paused: false, label: 'AMRAP', time: '9:00', detail: 'Kierros 4' }), 'AMRAP · 9:00');
  assert.equal(ui.clockStatus({ phase: 'run', paused: true, label: 'AMRAP', time: '9:00', detail: 'Kierros 4' }), 'Tauolla · 9:00');
  assert.equal(ui.clockStatus({ phase: 'done', paused: false, label: 'Aika loppui', time: '12:00', detail: '6 kierrosta' }), 'Aika loppui · 12:00 · 6 kierrosta');
  assert.deepEqual(ui.clockParts({ paused: true, label: 'TYÖ', time: '0:12', target: 'x', detail: 'y' }), { label: 'Tauolla', time: '0:12', target: 'x', detail: 'y' });
  assert.equal(ui.countsRounds({ format: 'amrap' }), true);
  assert.equal(ui.countsRounds({ format: 'fortime', rounds: 3 }), true);
  assert.equal(ui.countsRounds({ format: 'fortime', rounds: 1 }), false);
  assert.equal(ui.countsRounds({ format: 'emom', rounds: 10 }), false);
});

// ---- Home, history and records ----

import { recordsView } from '../statistics-ui.js';

const AT = Date.UTC(2025, 2, 4, 12);
const program = (id) => c.sanitizeRoutine(templateRoutine(templateById(id), 'women'));
const entry = (id, results, extra = {}) => {
  const s = c.startSession(program(id), AT - 1800000);
  s.wods.forEach((wod, i) => { if (results[i]) { wod.result = results[i]; wod.division = results[i].division; } });
  return { ...c.summarize(s, AT), ...extra };
};
const rx = (seconds, extra = {}) => ({ kind: 'time', seconds, division: 'rx', ...extra });

test('a functional program card names its parts and its previous results', () => {
  const fran = program('fran'), tunti = program('tunti');
  assert.equal(ui.isFunctionalRoutine(fran), true);
  assert.equal(ui.isFunctionalRoutine({ type: 'functional', exercises: [] }), true);
  assert.equal(ui.isFunctionalRoutine({ exercises: [{}] }), false);
  assert.equal(ui.routineWodPills(fran), '<li class="pill">Fran <b>21-15-9 aikaa vastaan · aikaraja 10 min</b></li>');
  assert.match(ui.routineWodPills(tunti), /<b>AMRAP 12 min<\/b><\/li>$/);
  assert.equal(ui.routineLastResults(fran, []), '', 'nothing before the first result');
  const history = [entry('fran', [rx(272)])];
  assert.equal(ui.routineLastResults(fran, history), '<p class="routine-last small-copy"><span class="eyebrow">Edellinen tulos</span> Fran <strong>4:32 · Rx</strong> (4.3.)</p>');
  assert.equal(ui.routineLastResults(program('cindy'), history), '', 'another WOD has its own history');
  assert.doesNotMatch(ui.routineWodPills(fran) + ui.routineLastResults(fran, history), /crossfit/i);
});

test('history lines count sets and WOD parts, and keep the whiteboards', () => {
  assert.equal(ui.historyWork({ setsDone: 3, setsTotal: 4 }), '3/4 sarjaa');
  assert.equal(ui.historyWork({ setsDone: 0, setsTotal: 0 }), '0/0 sarjaa', 'old entries read as before');
  assert.equal(ui.historyWork({ setsDone: 0, setsTotal: 0, wods: [{ result: rx(60) }] }), '1/1 WOD');
  assert.equal(ui.historyWork({ setsDone: 5, setsTotal: 5, wods: [{ result: rx(60) }, {}] }), '5/5 sarjaa · 1/2 WOD');

  const h = entry('fran', [rx(272, { notes: 'Hyvä <b>veto</b>' })]);
  const html = ui.historyWods(h);
  assert.match(html, /^<ul class="history-wods" aria-label="WOD-tulokset: Fran"><li><strong>Fran<\/strong> 4:32 · Rx <span class="muted">· Hyvä &lt;b&gt;veto&lt;\/b&gt;<\/span><\/li><\/ul><details class="history-log"><summary>WOD-taulut: Fran<\/summary><p><strong>Fran<\/strong><\/p><ul class="board-lines"><li>/);
  assert.match(html, /<li>21-15-9 aikaa vastaan/);
  assert.match(ui.historyWods(entry('fran', [null])), /<li><strong>Fran<\/strong> <span class="muted">ei tulosta<\/span><\/li>/);
  assert.equal(ui.historyWods({ name: 'Penkki' }), '');
});

test('the history editor corrects each score by its kind, version and notes', () => {
  const html = ui.historyWodEditor(entry('fran', [rx(272, { notes: 'tuntuma' })]));
  assert.match(html, /^<fieldset class="history-edit-ex history-edit-wod"><legend>Fran<\/legend><div class="result-pair">/);
  assert.match(html, /value="4" data-hwod="min" data-hid="[^"]+" data-w="0" data-key="hwod-0-min" aria-label="Minuutit: Fran"/);
  assert.match(html, /value="32" data-hwod="sec"/);
  assert.match(html, /value="rx" data-hwod="division"[^>]* checked>/);
  assert.match(html, /value="tuntuma" data-hwod="notes"/);
  assert.match(html, /data-action="clearhistorywod"[^>]*data-w="0"[^>]*aria-label="Poista tulos: Fran">Poista tulos<\/button>/);

  const capped = ui.historyWodEditor(entry('fran', [rx(600, { capped: true, reps: 40 })]));
  assert.match(capped, /value="40" data-hwod="reps"/);
  assert.doesNotMatch(capped, /data-hwod="min"/, 'a capped result is corrected by its reps');
  const none = ui.historyWodEditor(entry('fran', [null]));
  assert.match(none, /value="" data-hwod="min"/);
  assert.doesNotMatch(none, /clearhistorywod/, 'nothing to remove before a result exists');
  const rounds = ui.historyWodEditor(entry('cindy', [{ kind: 'roundsReps', rounds: 18, reps: 7, division: 'scaled' }]));
  assert.match(rounds, /value="18" data-hwod="rounds"[\s\S]*value="7" data-hwod="reps"[\s\S]*value="scaled" data-hwod="division"[^>]* checked>/);
  assert.equal(ui.historyWodEditor({ id: 'x' }), '');
});

test('the records view lists the best result of each WOD and version', () => {
  const empty = recordsView({ history: [] });
  assert.match(empty, /Ei vielä ennätyksiä/);
  assert.doesNotMatch(empty, /WOD-ennätykset/);
  const history = [entry('fran', [rx(300)], { id: 'a', endedAt: AT }), entry('fran', [rx(272)], { id: 'b', endedAt: AT + 86400000 }), entry('fran', [{ kind: 'time', seconds: 250, division: 'scaled' }], { id: 'c', endedAt: AT + 2 * 86400000 })];
  const html = recordsView({ history });
  assert.doesNotMatch(html, /Ei vielä ennätyksiä/);
  assert.match(html, /<h2 class="record-heading">WOD-ennätykset<\/h2><ul class="card record-list wod-record-list" aria-label="WOD-ennätykset"><li class="record-row"><div class="record-result"><span class="record-name">Fran<\/span> <span class="muted record-date">3 kirjausta<\/span><\/div>/);
  assert.match(html, /Rx <strong>4:32<\/strong><\/span> <span class="muted record-date">5\.3\.2025<\/span>/);
  assert.match(html, /Skaalattu <strong>4:10<\/strong>/);
});

