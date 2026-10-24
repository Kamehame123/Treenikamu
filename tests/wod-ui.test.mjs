import test from 'node:test';
import assert from 'node:assert/strict';
import * as ui from '../wod-ui.js';
import * as w from '../wod.js';
import * as c from '../core.js';
import { TEMPLATES, TEMPLATE_GROUPS, SEXES, templateRoutine, DEFAULT_WARMUP, DEFAULT_COOLDOWN } from '../wod-templates.js';

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
