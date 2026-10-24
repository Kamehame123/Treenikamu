// Functional program editor ("Toiminnallinen treeni"): the draft shape and the markup for the
// type chooser, warm-up, WOD parts and cool-down. app.js owns the draft, events and focus.
//
// Editor values stay exactly as typed (strings), like the gym editor's fields, so the unsaved-change
// check and a restored draft see what the user entered. core.validateRoutine checks them and
// core.sanitizeRoutine turns them into saved data; opening and saving unchanged gives the same data.
//
// DOM ids use positions (unique on the screen and safe in aria references); data-key values use the
// stable ids so focus follows a WOD or a movement when the screen is redrawn.
import { uid } from './core.js';
import { escapeHtml as esc } from './statistics-ui.js';
import {
  MAX_WODS, MAX_MOVEMENTS, WOD_FORMATS, FORMAT_LABELS, FORMAT_HELP, SCORE_LABELS, FORMAT_SCORES, FORMAT_DEFAULTS,
  SCHEME_CHIPS, MODALITY_LABELS, DIVISIONS, sanitizeWod, parseScheme, boardLines, modalities, movementLine, wodMinutes, wodPartLabel,
  wodTitle, formatScore, resultLabel, previousResult, bestResults, isPersonalRecord, clockFace,   formatTime, wodHeadline, wodKey, resultFields,
} from './wod.js';
import { GYM_PROGRAMS } from './gym-programs.js';
import { DEFAULT_WARMUP, DEFAULT_COOLDOWN, TEMPLATES, TEMPLATE_GROUPS, SEXES, templateWod, templateRoutine } from './wod-templates.js';

export const FORMAT_TAGLINES = Object.freeze({
  fortime: 'Nopein aika', amrap: 'Kierrokset ajassa', emom: 'Joka minuutti', intervals: 'Työ ja lepo', maxload: 'Raskain nosto',
});
const FORMAT_PARAMS = { fortime: ['rounds', 'scheme', 'minutes'], amrap: ['minutes'], emom: ['every', 'rounds'], intervals: ['work', 'rest', 'rounds'], maxload: ['minutes'] };
export const WOD_TEXT_FIELDS = Object.freeze(['name', 'rounds', 'scheme', 'minutes', 'every', 'work', 'rest', 'stimulus', 'notes']);
const BLOCKS = {
  warmup: { title: 'Lämmittely', add: 'Lisää lämmittely', remove: 'Poista lämmittely', defaults: DEFAULT_WARMUP, placeholder: 'Esim. 5 min soutu, liikkuvuus ja päivän liikkeet kevyesti' },
  cooldown: { title: 'Loppuverryttely', add: 'Lisää loppuverryttely', remove: 'Poista loppuverryttely', defaults: DEFAULT_COOLDOWN, placeholder: 'Esim. kävely ja venyttely' },
};
export const BLOCK_KINDS = Object.freeze(Object.keys(BLOCKS));

const asText = (v, fallback = '') => typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : fallback;
const objectOr = (v) => v && typeof v === 'object' ? v : {};
const filled = (v) => String(v ?? '').trim() !== '';

export function editorMovement(input) {
  const raw = objectOr(input), s = objectOr(raw.scaled);
  const sourceId = typeof raw.sourceId === 'string' ? raw.sourceId : '';
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
    name: asText(raw.name), amount: asText(raw.amount), load: asText(raw.load),
    scaled: { name: asText(s.name), amount: asText(s.amount), load: asText(s.load) },
    ...(sourceId ? { sourceId } : {}),
  };
}

// Only the parameters of the chosen format, with that format's defaults for missing ones.
// A saved time cap of 0 means "no cap" and shows as an empty field.
export function editorWod(input) {
  const raw = objectOr(input);
  const format = WOD_FORMATS.includes(raw.format) ? raw.format : 'amrap';
  const d = FORMAT_DEFAULTS[format], params = {};
  for (const key of FORMAT_PARAMS[format]) params[key] = asText(raw[key], key === 'scheme' ? '' : String(d[key]));
  if (format === 'fortime' && typeof raw.minutes !== 'string' && params.minutes === '0') params.minutes = '';
  if (format === 'emom') { params.alternate = raw.alternate === true; params.ascending = raw.ascending === true; }
  const template = typeof raw.template === 'string' ? raw.template : '';
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
    name: asText(raw.name),
    ...(template ? { template } : {}),
    format,
    ...params,
    score: FORMAT_SCORES[format].includes(raw.score) ? raw.score : d.score,
    movements: (Array.isArray(raw.movements) ? raw.movements : []).filter((m) => m && typeof m === 'object').slice(0, MAX_MOVEMENTS).map(editorMovement),
    stimulus: asText(raw.stimulus),
    notes: asText(raw.notes),
  };
}

export const newEditorWod = () => editorWod({ format: 'amrap', movements: [{}] });

// A new format starts from its own defaults; the movements, texts and a still-valid score stay.
export function switchFormat(w, format) {
  const { id, name, template, score, movements, stimulus, notes } = w;
  return editorWod({ id, name, template, format, score, movements, stimulus, notes });
}

export function editorBlock(input) {
  if (!input || typeof input !== 'object') return null;
  return { text: asText(input.text), minutes: input.minutes === 0 ? '' : asText(input.minutes) };
}

export const newBlock = (kind) => editorBlock(BLOCKS[kind].defaults);

export function normalizeFunctionalDraft(d) {
  d.type = 'functional';
  d.warmup = editorBlock(d.warmup);
  d.wods = (Array.isArray(d.wods) ? d.wods : []).filter((w) => w && typeof w === 'object').slice(0, MAX_WODS).map(editorWod);
  d.cooldown = editorBlock(d.cooldown);
  return d;
}

// ---- Markup ----

export function typeChoices(icon) {
  // The note is the button's description, not part of its name, so voice control can say just the type.
  const choice = (action, glyph, name, note) => `<li><button class="type-choice" data-action="${action}" data-key="${action}" aria-describedby="${action}-note"><span class="choice-icon">${icon(glyph)}</span><span class="grow"><strong>${name}</strong><span class="choice-meta" id="${action}-note" aria-hidden="true">${note}</span></span>${icon('arrow')}</button></li>`;
  return `<ul class="list type-choices">${choice('newgym', 'weight', 'Kuntosalitreeni', 'Liikkeet, sarjat, toistot ja painot. Tavoitteet kehittyvät tulostesi mukaan.')}${choice('newfunctional', 'stopwatch', 'Toiminnallinen treeni', 'Lämmittely, voima tai taito ja ajastettu WOD: aikaa vastaan, AMRAP, EMOM tai intervallit.')}${choice('newgymprogram', 'weight', 'Valmis kuntosaliohjelma', 'Seitsemän yleistä perusohjelmaa: koko keho A ja B, työntävät, vetävät, jalat, yläkroppa ja core. Muokattavissa ennen tallennusta.')}${choice('newtemplate', 'board', 'Aloita mallista', 'Toiminnallinen treeni valmiista rakenteesta tai tunnetusta vertailutreenistä. Muokattavissa ennen tallennusta.')}</ul>`;
}

export function wodGuide(open = false) {
  return `<details class="wod-guide card" ${open ? 'open' : ''}><summary data-key="wod-guide">Miten tunti rakennetaan? <span aria-hidden="true">⌄</span></summary><div class="wod-guide-body">
<p>Tyypillinen tunti kestää noin tunnin ja etenee aina samassa järjestyksessä:</p>
<ol><li><strong>Lämmittely 10–15 min.</strong> Syke ylös, liikkuvuus ja päivän liikkeet kevyesti läpi.</li><li><strong>Voima tai taito 10–15 min.</strong> Esim. takakyykky 5 × 3 tai käsilläseisonnan harjoittelu. Sarjat kirjataan kuten kuntosalitreenissä.</li><li><strong>WOD 10–20 min.</strong> Päivän ajastettu treeni, jonka tulos kirjataan.</li><li><strong>Loppuverryttely 5–10 min.</strong> Rauhoittelu ja venyttely.</li></ol>
<p><strong>Päätä tuntuma ensin.</strong> Lyhyt ja kova (alle 5 min), keskipitkä (5–15 min) vai pitkä ja tasainen (yli 20 min)? Kirjoita se kenttään Tavoite ja tuntuma.</p>
<p><strong>Skaalaa niin, että tuntuma säilyy.</strong> Kevennä kuormaa, vähennä toistoja tai vaihda helpompaan liikkeeseen, jotta treeni kestää suunnitellun ajan. Kirjaa kevennys liikkeen kohtaan Skaalattu versio.</p>
<p><strong>Ensin tekniikka, sitten toistuvuus, vasta sitten teho.</strong></p>
<p><strong>Aloittelijalle maltillinen määrä.</strong> Suuri määrä uusia liikkeitä kerralla voi vaurioittaa lihaksia (rabdomyolyysi). Lisää määrää vähitellen ja hakeudu hoitoon, jos virtsa tummuu tai lihakset turpoavat kovan treenin jälkeen.</p>
</div></details>`;
}

export function blockSection(kind, block, icon) {
  const b = BLOCKS[kind];
  if (!block) return `<button class="btn secondary add-ex-btn" data-action="addblock" data-block="${kind}" data-key="addblock-${kind}">${icon('plus')} ${b.add}</button>`;
  return `<section class="card edit block-edit"><div class="row editor-row"><h2>${b.title}</h2><button class="btn ghost danger-text" data-action="rmblock" data-block="${kind}" data-key="rmblock-${kind}" aria-label="${b.remove}">Poista</button></div><label class="field">Ohjeet<textarea rows="3" maxlength="1000" data-bf="text" data-block="${kind}" data-key="btext-${kind}" placeholder="${b.placeholder}">${esc(block.text)}</textarea></label><label class="field block-minutes">Kesto (min)<input type="number" inputmode="numeric" min="0" max="60" step="1" value="${esc(block.minutes)}" data-bf="minutes" data-block="${kind}" data-key="bminutes-${kind}"></label></section>`;
}

export function scaledSummary(m) {
  const s = objectOr(m?.scaled);
  if (![s.name, s.amount, s.load].some(filled)) return 'Ei asetettu';
  const trim = (v) => String(v ?? '').trim();
  return movementLine({ name: trim(m.name), amount: trim(m.amount), load: trim(m.load), scaled: { name: trim(s.name), amount: trim(s.amount), load: trim(s.load) } }, 'scaled') || 'Ei asetettu';
}

const decimal = (n) => String(n).replace('.', ',');
const boardMeta = (wod) => {
  const minutes = wodMinutes(wod);
  return `<p class="board-meta"><span>${minutes ? `Kesto noin ${decimal(minutes)} min` : 'Kesto riippuu tahdista'}</span>${modalities(wod).map((k) => `<span class="pill">${MODALITY_LABELS[k]}</span>`).join('')}</p>`;
};
// One version of the whiteboard. The headline is left out when the card title already says it.
function wodBoard(wod, division, title, { meta = true } = {}) {
  const [headline, ...lines] = boardLines(wod, division);
  return `<div class="wod-board">${headline === title ? '' : `<p class="board-headline">${esc(headline)}</p>`}<ul class="board-lines">${lines.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>${meta ? boardMeta(wod) : ''}</div>`;
}

// What the whiteboard will say, from the values the save would store.
export function boardPreview(raw) {
  const wod = sanitizeWod(raw);
  const [headline, ...rx] = boardLines(wod, 'rx');
  const scaled = wod.movements.some((m) => m.scaled) ? boardLines(wod, 'scaled').slice(1) : [];
  const list = (lines) => `<ul class="board-lines">${lines.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>`;
  return `<p class="eyebrow">Taululla</p><p class="board-headline">${esc(wod.name || headline)}</p>${wod.name ? `<p class="board-sub">${esc(headline)}</p>` : ''}${rx.length ? list(rx) : '<p class="field-hint">Lisää liikkeitä, niin ne näkyvät tässä.</p>'}${scaled.length ? `<p class="eyebrow">Skaalattu</p>${list(scaled)}` : ''}${wod.stimulus ? `<p class="board-stimulus">${esc(wod.stimulus)}</p>` : ''}${boardMeta(wod)}`;
}

const activeScheme = (w) => parseScheme(w.scheme)?.join('-') ?? '';

function numberField(w, wi, field, label, min, max, { placeholder = '', extra = '' } = {}) {
  return `<label class="field"${extra}>${label}<input type="number" inputmode="numeric" min="${min}" max="${max}" step="1" value="${esc(w[field])}" data-wf="${field}" data-w="${wi}" data-key="w${field}-${esc(w.id)}"${placeholder ? ` placeholder="${placeholder}"` : ''}></label>`;
}

function toggle(w, wi, field, label, note) {
  return `<label class="check wide"><span>${label}<small>${note}</small></span><input type="checkbox" data-wf="${field}" data-w="${wi}" data-key="w${field}-${esc(w.id)}" ${w[field] ? 'checked' : ''}></label>`;
}

function formatParams(w, wi) {
  const id = esc(w.id);
  if (w.format === 'fortime') {
    const active = activeScheme(w);
    return `<label class="field wide">Toistokaava <span class="optional">valinnainen</span><input type="text" maxlength="80" value="${esc(w.scheme)}" data-wf="scheme" data-w="${wi}" data-key="wscheme-${id}" autocomplete="off" placeholder="Esim. 21-15-9" aria-describedby="wscheme-hint-${wi}"></label><p class="field-hint wide" id="wscheme-hint-${wi}">Kaava antaa toistot liikkeille, joilta puuttuu määrä. Kierroksia on yhtä monta kuin kaavassa lukuja.</p><div class="chip-row wide" id="wscheme-chips-${wi}" role="group" aria-label="Valmiit toistokaavat">${SCHEME_CHIPS.map((s, i) => `<button type="button" class="chip" data-action="scheme" data-w="${wi}" data-scheme="${s}" data-key="scheme-${id}-${i}" aria-pressed="${active === s}">${s}</button>`).join('')}</div>${numberField(w, wi, 'rounds', 'Kierrokset', 1, 100, { extra: ` id="wrounds-field-${wi}"${filled(w.scheme) ? ' hidden' : ''}` })}${numberField(w, wi, 'minutes', 'Aikaraja (min)', 0, 180, { placeholder: 'Ei aikarajaa' })}`;
  }
  if (w.format === 'amrap') return numberField(w, wi, 'minutes', 'Kesto (min)', 1, 180);
  if (w.format === 'maxload') return numberField(w, wi, 'minutes', 'Aikaikkuna (min)', 1, 180);
  if (w.format === 'emom') {
    return `${numberField(w, wi, 'every', 'Jakso (s)', 10, 600)}${numberField(w, wi, 'rounds', 'Jaksoja', 1, 100)}${toggle(w, wi, 'alternate', 'Vuorottelevat liikkeet', 'Jakso 1 = liike 1, jakso 2 = liike 2 ja niin edelleen.')}${toggle(w, wi, 'ascending', 'Nousevat toistot', 'Toistot kasvavat joka jaksolla (Death By). Liikkeen määrä on lisäys jaksoa kohden.')}`;
  }
  return `${numberField(w, wi, 'work', 'Työ (s)', 5, 600)}${numberField(w, wi, 'rest', 'Lepo (s)', 0, 600)}${numberField(w, wi, 'rounds', 'Kierrokset', 1, 100)}<div class="chip-row wide"><button type="button" class="chip" data-action="tabata" data-w="${wi}" data-key="tabata-${id}">Tabata 8 × 20 s / 10 s</button></div>`;
}

function scoreField(w, wi) {
  const options = FORMAT_SCORES[w.format];
  if (options.length < 2) return `<p class="field-hint">${w.format === 'fortime' ? 'Tulos on aika. Jos aikaraja tulee vastaan, kirjaat tehdyt toistot.' : 'Tulos on raskain onnistunut kuorma (kg).'}</p>`;
  const menu = `wscore-${wi}`;
  return `<div class="field"><span id="${menu}-label">Tulos</span><details class="choice-menu" id="${menu}"><summary data-key="wscore-${esc(w.id)}" aria-labelledby="${menu}-label ${menu}-value"><span id="${menu}-value">${SCORE_LABELS[w.score]}</span><span aria-hidden="true">⌄</span></summary><fieldset><legend class="sr">Tulos</legend>${options.map((s) => `<label class="choice-option"><input type="radio" name="${menu}" value="${s}" data-wf="score" data-w="${wi}" data-key="wscore-${esc(w.id)}-${s}" ${w.score === s ? 'checked' : ''}><span>${SCORE_LABELS[s]}</span></label>`).join('')}</fieldset></details></div>`;
}

function movementRow(w, wi, m, mi, label, openScaled) {
  const id = esc(m.id), n = mi + 1, data = `data-w="${wi}" data-m="${mi}"`;
  const input = (field, title, max, value, placeholder = '') => `<label class="field">${title}<input type="text" maxlength="${max}" value="${esc(value)}" data-mf="${field}" ${data} data-key="m${field}-${id}" autocomplete="off"${placeholder ? ` placeholder="${placeholder}"` : ''}></label>`;
  return `<li class="wod-move"><div class="row"><span class="eyebrow exercise-tag">LIIKE ${String(n).padStart(2, '0')}</span><div class="mini"><button class="btn ghost icon-button" data-action="moveup" ${data} data-key="mup-${id}" ${mi === 0 ? 'disabled' : ''} aria-label="Siirrä liike ${n} ylös (${label})">↑</button><button class="btn ghost icon-button" data-action="movedown" ${data} data-key="mdown-${id}" ${mi === w.movements.length - 1 ? 'disabled' : ''} aria-label="Siirrä liike ${n} alas (${label})">↓</button><button class="btn ghost danger-text" data-action="rmmove" ${data} data-key="mrm-${id}" aria-label="Poista liike ${n} (${label})">Poista</button></div></div>`
    + `<div class="name-picker-row"><label class="field grow">Liike<input type="text" maxlength="60" value="${esc(m.name)}" data-mf="name" ${data} data-key="mname-${id}" autocomplete="off" placeholder="Esim. kahvakuulaheilautus"></label><button class="btn secondary pick-exercise" data-action="pickmove" data-w="${wi}" data-id="${id}" data-key="pickmove-${id}">Valitse kirjastosta</button></div>`
    + `<div class="move-amounts">${input('amount', 'Määrä', 20, m.amount, 'Esim. 15 tai 400 m')}<label class="field">Kuorma <span class="optional">valinnainen</span><input type="text" maxlength="20" value="${esc(m.load)}" data-mf="load" ${data} data-key="mload-${id}" autocomplete="off" placeholder="Esim. 24 kg"></label></div>`
    + `<details class="move-scaled" data-scaled="${id}" ${openScaled.has(m.id) ? 'open' : ''}><summary data-key="mscaled-${id}"><span>Skaalattu versio</span><span class="scaled-summary" id="mscaled-sum-${wi}-${mi}">${esc(scaledSummary(m))}</span></summary><div class="move-scaled-body"><p class="field-hint">Kevyempi vaihtoehto samalla tuntumalla. Tyhjät kentät käyttävät Rx-arvoja; vaihdetulle liikkeelle kuorma annetaan erikseen.</p>${input('sname', 'Skaalattu liike', 60, m.scaled.name, 'Esim. polvipunnerrus')}<div class="move-amounts">${input('samount', 'Skaalattu määrä', 20, m.scaled.amount)}${input('sload', 'Skaalattu kuorma', 20, m.scaled.load, 'Esim. 16 kg')}</div></div></details></li>`;
}

export function wodEditor(w, wi, count, { icon, openScaled = new Set() }) {
  const id = esc(w.id), label = wodPartLabel(wi, count), full = w.movements.length >= MAX_MOVEMENTS;
  const head = `<div class="row editor-row"><h2 class="wod-title">${label}</h2>${count > 1 ? `<button class="btn ghost danger-text" data-action="rmwod" data-w="${wi}" data-key="rmwod-${id}" aria-label="Poista ${label}">Poista</button>` : ''}</div>`;
  const name = `<label class="field">Nimi <span class="optional">valinnainen</span><input type="text" maxlength="60" value="${esc(w.name)}" data-wf="name" data-w="${wi}" data-key="wname-${id}" autocomplete="off" placeholder="Esim. Perjantain finaali"></label>`;
  const formats = `<fieldset class="format-options"><legend>Muoto</legend><div class="format-grid">${WOD_FORMATS.map((f) => `<label class="format-option"><input type="radio" name="wodformat-${wi}" value="${f}" data-wf="format" data-w="${wi}" data-key="wodformat-${id}-${f}" ${w.format === f ? 'checked' : ''}><span>${FORMAT_LABELS[f]}</span> <small>${FORMAT_TAGLINES[f]}</small></label>`).join('')}</div><p class="field-hint">${FORMAT_HELP[w.format]}</p></fieldset>`;
  const moves = w.movements.length ? `<ol class="wod-moves">${w.movements.map((m, mi) => movementRow(w, wi, m, mi, label, openScaled)).join('')}</ol>` : '';
  const add = `<div class="wod-add-row"><button class="btn secondary add-ex-btn" data-action="addmove" data-w="${wi}" data-key="addmove-${id}" aria-label="Lisää liike (${label})" ${full ? 'disabled' : ''}>${icon('plus')} Lisää liike</button><button class="btn secondary" data-action="addmovelib" data-w="${wi}" data-key="addmovelib-${id}" aria-label="Lisää kirjastosta (${label})" ${full ? 'disabled' : ''}>Lisää kirjastosta</button></div>`;
  const stimulus = `<label class="field">Tavoite ja tuntuma <span class="optional">valinnainen</span><input type="text" maxlength="200" value="${esc(w.stimulus)}" data-wf="stimulus" data-w="${wi}" data-key="wstimulus-${id}" autocomplete="off" placeholder="Esim. Nopea ja kova, alle 8 min"></label>`;
  const notes = `<label class="field">Ohjeet <span class="optional">valinnainen</span><textarea rows="3" maxlength="500" data-wf="notes" data-w="${wi}" data-key="wnotes-${id}" placeholder="Esim. Pidä soutu tasaisena. Vaihda pyörään, jos soutulaite on varattu.">${esc(w.notes)}</textarea></label>`;
  return `<section class="card edit wod-edit">${head}${name}${formats}<div class="wod-params">${formatParams(w, wi)}</div>${scoreField(w, wi)}${moves}${add}${stimulus}${notes}<div class="wod-board" id="wod-board-${wi}">${boardPreview(w)}</div></section>`;
}

// Typing updates only what depends on the typed value, so the field keeps focus and the keyboard stays open.
export function paintWodEditor(w, wi) {
  const board = document.getElementById(`wod-board-${wi}`);
  if (board) board.innerHTML = boardPreview(w);
  if (w.format === 'fortime') {
    const rounds = document.getElementById(`wrounds-field-${wi}`);
    if (rounds) rounds.hidden = filled(w.scheme);
    const active = activeScheme(w);
    for (const chip of document.querySelectorAll(`#wscheme-chips-${wi} .chip`)) chip.setAttribute('aria-pressed', String(chip.dataset.scheme === active));
  }
  w.movements.forEach((m, mi) => {
    const summary = document.getElementById(`mscaled-sum-${wi}-${mi}`), text = scaledSummary(m);
    if (summary && summary.textContent !== text) summary.textContent = text;
  });
}

// ---- Template gallery ("Aloita mallista") ----

const GROUP_NOTES = {
  format: 'Valmis rakenne. Vaihda liikkeet ja määrät omiksesi ennen tallennusta.',
  benchmark: 'Tunnettuja treenejä, jotka tehdään aina samoin, jotta tulosta voi verrata aiempaan.',
};
export const isTemplateGroup = (v) => typeof v === 'string' && Object.hasOwn(TEMPLATE_GROUPS, v);
export const isSex = (v) => typeof v === 'string' && Object.hasOwn(SEXES, v);

// Every template starts with the default warm-up and cool-down, so only a whole class lists its parts.
function templateParts(t) {
  if (!t.warmup && !t.exercises?.length) return '';
  const r = templateRoutine(t);
  const parts = [`Lämmittely ${r.warmup.minutes} min`, ...r.exercises.map((e) => `${e.name} ${e.sets} × ${e.reps}`), 'WOD', `Loppuverryttely ${r.cooldown.minutes} min`];
  return `<p class="template-parts">${parts.map(esc).join(' · ')}</p>`;
}

function templateCard(t, sex, icon) {
  const wod = sanitizeWod(templateWod(t, sex));
  return `<li class="card template-card"><h2>${esc(t.name)}</h2>${templateParts(t)}${wodBoard(wod, 'rx', t.name)}${wod.stimulus ? `<p class="board-stimulus">${esc(wod.stimulus)}</p>` : ''}${wod.notes ? `<p class="field-hint">${esc(wod.notes)}</p>` : ''}<button class="btn secondary" data-action="usetemplate" data-template="${esc(t.id)}" data-key="use-${esc(t.id)}">Käytä mallia<span class="sr"> ${esc(t.name)}</span> ${icon('arrow')}</button></li>`;
}

// group: a key of TEMPLATE_GROUPS; sex: a key of SEXES (only the suggested loads differ).
export function templateGallery(group, sex, icon) {
  const toggles = (action, attr, options, current, labelling) => `<div class="segmented" role="group" ${labelling}>${Object.entries(options).map(([value, text]) => `<button class="btn secondary" data-action="${action}" data-${attr}="${value}" data-key="${action}-${value}" aria-pressed="${current === value}">${text}</button>`).join('')}</div>`;
  const cards = TEMPLATES.filter((t) => t.group === group).map((t) => templateCard(t, sex, icon)).join('');
  return `<section class="card gallery-controls" aria-label="Mallien valinta">${toggles('templategroup', 'group', TEMPLATE_GROUPS, group, 'aria-label="Mallien ryhmä"')}<p class="field-hint">${GROUP_NOTES[group]}</p><div class="gallery-loads"><span class="eyebrow" id="gallery-loads">Ehdotetut kuormat</span>${toggles('templatesex', 'sex', SEXES, sex, 'aria-labelledby="gallery-loads"')}</div></section><ul class="list template-list" aria-label="${TEMPLATE_GROUPS[group]}">${cards}</ul>`;
}

export function gymProgramGallery(icon) {
  const cards = GYM_PROGRAMS.map((p) => `<li class="card template-card"><h2>${esc(p.name)}</h2><p class="template-parts">${p.exercises.map((e) => esc(`${e.name} ${e.sets} × ${e.reps}`)).join(' · ')}</p><p class="field-hint">${esc(p.note)}</p><button class="btn secondary" data-action="usegymprogram" data-program="${esc(p.id)}" data-key="use-${esc(p.id)}">Käytä ohjelmaa<span class="sr"> ${esc(p.name)}</span> ${icon('arrow')}</button></li>`).join('');
  return `<ul class="list template-list" aria-label="Valmiit kuntosaliohjelmat">${cards}</ul>`;
}

// ---- Running workout: warm-up, cool-down and WOD parts ----

const shortDate = (at) => new Date(at).toLocaleDateString('fi-FI', { day: 'numeric', month: 'numeric' });

// "Valmis" is a reminder within this workout; history keeps only the sets and WOD results.
export function sessionBlock(kind, block, icon) {
  const { title } = BLOCKS[kind], done = block.done === true;
  return `<div class="card block-card${done ? ' complete' : ''}" id="block-${kind}"><div class="block-heading"><h2>${title}</h2>${block.minutes ? `<span class="badge">${block.minutes} min</span>` : ''}</div>${block.text ? `<p class="block-text">${esc(block.text)}</p>` : ''}<button class="btn secondary block-done" data-action="blockdone" data-block="${kind}" data-key="blockdone-${kind}" aria-pressed="${done}">${done ? icon('check') : ''}<span class="sr">${title}: </span>Valmis</button></div>`;
}

// The latest result and the best of each version. The first try has nothing to compare with.
function wodPast(w, history) {
  const previous = previousResult(history, w.key);
  if (!previous) return w.score === 'none' ? '' : '<div class="wod-past"><p>Ensimmäinen kerta: tulos on lähtötasosi.</p></div>';
  const best = bestResults(history, w.key);
  const bests = Object.keys(DIVISIONS).filter((d) => best[d]).map((d) => `${DIVISIONS[d]} ${formatScore(best[d].result)}`);
  return `<div class="wod-past"><p>Edellinen ${shortDate(previous.at)}: ${esc(resultLabel(previous.result))}</p>${bests.length ? `<p>Ennätys: ${esc(bests.join(' · '))}</p>` : ''}</div>`;
}

function resultInput(w, fields, field, label, { kilos = false, min = 0, max = 100000 } = {}) {
  const type = kilos ? 'type="text" inputmode="decimal"' : `type="number" inputmode="numeric" min="${min}" max="${max}" step="1"`;
  return `<label class="field">${label}<input ${type} value="${esc(fields[field])}" data-rf="${field}" data-key="rf-${field}-${esc(w.id)}" autocomplete="off"></label>`;
}

// Inputs for the WOD's score. A time cap swaps the time for the reps done by the cap (app.js toggles `hidden`).
function scoreInputs(w, wi, fields) {
  const input = (field, label, options) => resultInput(w, fields, field, label, options);
  if (w.score === 'time') {
    const cap = w.minutes || fields.capped ? `<label class="check"><span>Aikaraja tuli vastaan${w.minutes ? ` (${w.minutes} min)` : ''}<small>Kirjaa silloin aikarajaan mennessä tehdyt toistot.</small></span><input type="checkbox" data-rf="capped" data-w="${wi}" data-key="rf-capped-${esc(w.id)}"${fields.capped ? ' checked' : ''}></label><div id="rf-cap-${wi}"${fields.capped ? '' : ' hidden'}>${input('reps', 'Toistot aikarajaan mennessä')}</div>` : '';
    return `<div class="result-pair" id="rf-time-${wi}"${fields.capped ? ' hidden' : ''}>${input('min', 'Minuutit', { max: 1440 })}${input('sec', 'Sekunnit', { max: 59 })}</div>${cap}`;
  }
  if (w.score === 'roundsReps') return `<div class="result-pair">${input('rounds', 'Kierrokset', { max: 10000 })}${input('reps', 'Lisätoistot')}</div><p class="field-hint">Kokonaiset kierrokset ja viimeisen, kesken jääneen kierroksen toistot.</p>`;
  if (w.score === 'kg') return input('value', 'Kuorma (kg)', { kilos: true });
  if (w.score === 'none') return '<p class="field-hint">Tälle osalle ei kirjata lukua. Tallenna, niin osa merkitään tehdyksi.</p>';
  return input('value', SCORE_LABELS[w.score]);
}

// fields: the values as typed (prefilled by resultFields in wod.js); error: what to fix before saving.
export function resultForm(w, wi, fields, { error = '', advanced = false } = {}) {
  const id = esc(w.id);
  const divisions = Object.entries(DIVISIONS).map(([value, text]) => `<label class="choice-option"><input type="radio" name="rf-division-${wi}" value="${value}" data-rf="division" data-key="rf-division-${id}-${value}"${fields.division === value ? ' checked' : ''}><span>${text}</span></label>`).join('');
  const rpe = advanced ? resultInput(w, fields, 'rpe', 'Rasittavuus (RPE 1–10) <span class="optional">valinnainen</span>', { min: 1, max: 10 }) : '';
  return `<form class="result-form" id="result-form-${wi}" data-w="${wi}" aria-labelledby="result-title-${wi}" novalidate><h3 id="result-title-${wi}">${w.result ? 'Muokkaa tulosta' : 'Kirjaa tulos'}<span class="sr"> (${esc(wodTitle(w))})</span></h3>${error ? `<p class="banner" id="result-error-${wi}" role="alert" tabindex="-1">${esc(error)}</p>` : ''}${scoreInputs(w, wi, fields)}<fieldset class="result-division"><legend>Versio</legend><div class="choice-row">${divisions}</div></fieldset>${rpe}<label class="field">Muistiinpanot <span class="optional">valinnainen</span><textarea maxlength="300" rows="2" data-rf="notes" data-key="rf-notes-${id}" placeholder="Esim. skaalaus tai tuntuma">${esc(fields.notes)}</textarea></label><div class="result-actions"><button type="submit" class="btn primary" data-action="saveresult" data-w="${wi}" data-key="saveresult-${id}">Tallenna tulos</button><button type="button" class="btn secondary" data-action="cancelresult" data-w="${wi}" data-key="cancelresult-${id}">Peruuta</button>${w.result ? `<button type="button" class="btn ghost danger-text" data-action="clearresult" data-w="${wi}" data-key="clearresult-${id}">Poista tulos</button>` : ''}</div></form>`;
}

// A record is only possible against an earlier result of the same version in history.
function resultSummary(w, wi, history, cheer) {
  const r = w.result, record = isPersonalRecord(history, w.key, r);
  return `<div class="wod-result"><p class="wod-score"><span class="eyebrow">Tulos</span> <strong>${esc(formatScore(r, { long: true }))}</strong> <span class="badge">${DIVISIONS[r.division]}</span>${record ? ' <span class="badge done-badge">Uusi ennätys</span>' : ''}</p>${r.rpe ? `<p class="field-hint">RPE ${r.rpe}</p>` : ''}${r.notes ? `<p class="wod-notes">${esc(r.notes)}</p>` : ''}${cheer ? `<p class="cheer">${esc(cheer)}</p>` : ''}<button class="btn secondary" data-action="openresult" data-w="${wi}" data-key="openresult-${esc(w.id)}">Muokkaa tulosta<span class="sr"> (${esc(wodTitle(w))})</span></button></div>`;
}

// ---- WOD clock ----

// Rounds are counted by tapping: always in an AMRAP, and in For Time when it has several rounds.
export const countsRounds = (w) => w.format === 'amrap' || (w.format === 'fortime' && w.rounds > 1);

// What the clock shows. A paused clock says so instead of its running label.
export function clockParts(face) {
  return { label: face.paused ? 'Tauolla' : face.label, time: face.time, target: face.target, detail: face.detail };
}

// The one-line clock status on a WOD card; app.js keeps a running one current.
export function clockStatus(face) {
  const { label, time, detail } = clockParts(face);
  return [label, time, face.phase === 'done' ? detail : ''].filter(Boolean).join(' · ');
}

// Start the clock, follow a running one, or log what an ended one measured.
// "Kirjaa tulos" without the clock is for a workout timed by the gym's own clock.
function clockActions(w, wi, title, icon, now) {
  const id = esc(w.id), sr = `<span class="sr"> (${esc(title)})</span>`;
  const log = (kind) => `<button class="btn ${kind}" data-action="openresult" data-w="${wi}" data-key="openresult-${id}">Kirjaa tulos${sr} ${icon('arrow')}</button>`;
  const start = (kind, text) => `<button class="btn ${kind}" data-action="clockstart" data-w="${wi}" data-key="clockstart-${id}">${text}${sr} ${icon('stopwatch')}</button>`;
  if (!w.clock) return `<div class="wod-actions">${start('primary big', 'Käynnistä kello')}${log('secondary')}</div>`;
  const status = `<p class="clock-status">Kello: <span id="wc-mini-${wi}">${esc(clockStatus(clockFace(w, w.clock, now)))}</span></p>`;
  if (!w.clock.endedAt) return `${status}<button class="btn primary big" data-action="clockopen" data-w="${wi}" data-key="clockopen-${id}">Avaa kello${sr} ${icon('stopwatch')}</button>`;
  return `${status}<div class="wod-actions">${log('primary big')}${start('secondary', 'Käynnistä kello uudelleen')}</div>`;
}

// One WOD part of a running workout. current: the part to do next; form: the open result form's fields.
export function sessionWodCard(w, wi, { count, history = [], current = false, form = null, error = '', cheer = '', advanced = false, icon, now = Date.now() }) {
  const id = esc(w.id), title = wodTitle(w), division = w.division === 'scaled' ? 'scaled' : 'rx';
  const badge = w.result ? '<span class="badge done-badge">Kirjattu</span>' : '';
  const versions = `<div class="segmented" role="group" aria-label="Näytettävä versio: ${esc(title)}">${Object.entries(DIVISIONS).map(([value, text]) => `<button class="btn secondary" data-action="wodversion" data-w="${wi}" data-division="${value}" data-key="wodversion-${id}-${value}" aria-pressed="${division === value}">${text}</button>`).join('')}</div>`;
  const unwritten = division === 'scaled' && !w.movements.some((m) => m.scaled) ? '<p class="field-hint">Skaalattua versiota ei ole kirjoitettu. Kevennä kuormaa, määrää tai liikettä niin, että tuntuma säilyy.</p>' : '';
  // The form opened from an ended clock says what the clock measured; the fields are prefilled from it.
  const measured = form && !w.result && w.clock?.endedAt ? `<p class="clock-status">Kello: ${esc(clockStatus(clockFace(w, w.clock, now)))}</p>` : '';
  const result = form ? `${measured}${resultForm(w, wi, form, { error, advanced })}` : w.result ? resultSummary(w, wi, history, cheer) : clockActions(w, wi, title, icon, now);
  return `<li class="card wod-card${w.result ? ' complete' : ''}${current ? ' current' : ''}" id="wod-${wi}"><div class="exercise-heading"><span class="exercise-index">${wodPartLabel(wi, count)}</span><h2 class="grow">${esc(title)}</h2>${badge}</div>${versions}${unwritten}${wodBoard(w, division, title)}${w.stimulus ? `<p class="board-stimulus">${esc(w.stimulus)}</p>` : ''}${w.notes ? `<p class="wod-notes">${esc(w.notes)}</p>` : ''}${wodPast(w, history)}${result}</li>`;
}

// The round counter. On the last For Time round the tap target becomes a note of the same size,
// so a quick double tap cannot count a round that does not exist; "Valmis" ends the workout.
function lapArea(w, face) {
  const laps = w.clock.laps, n = laps.length;
  const final = w.format === 'fortime' && n >= w.rounds - 1;
  const tapper = final
    ? '<p class="clock-lap clock-lap-final" data-key="clocklap" tabindex="-1">Viimeinen kierros<small>Paina Valmis, kun kierros on tehty.</small></p>'
    : `<button class="btn primary clock-lap" data-action="clocklap" data-key="clocklap" aria-disabled="${face.phase !== 'run' || face.paused}">+1 kierros</button>`;
  const split = n ? formatTime((laps[n - 1] - (n > 1 ? laps[n - 2] : 0)) / 1000) : '';
  const info = n ? `${n} ${n === 1 ? 'kierros' : 'kierrosta'} tehty · viimeisin ${split}` : 'Napauta +1 kierros aina, kun kierros on tehty.';
  return `<div class="clock-laps">${tapper}<p class="clock-lap-info">${info}</p>${n ? '<button class="btn ghost" data-action="clockundo" data-key="clockundo">Peru viimeisin kierros</button>' : ''}</div>`;
}

// The WOD clock screen below the session header. app.js updates the wc-* ids in place every tick.
export function clockScreen(w, wi, { count, history = [], icon, now = Date.now() }) {
  const face = clockFace(w, w.clock, now), parts = clockParts(face), title = wodTitle(w);
  const division = w.division === 'scaled' ? 'scaled' : 'rx', fortime = w.format === 'fortime';
  const long = face.time.length > 5 ? ' long' : '';
  const heading = `<div class="stat-heading"><p class="eyebrow accent">${wodPartLabel(wi, count)} · ${DIVISIONS[division]}</p><h1 tabindex="-1">${esc(title)}</h1></div>`;
  const board = `<section class="card clock-board" aria-label="Taulu: ${esc(title)}">${wodBoard(w, division, title, { meta: false })}${w.stimulus ? `<p class="board-stimulus">${esc(w.stimulus)}</p>` : ''}${wodPast(w, history)}</section>`;
  if (face.phase === 'done') {
    return `${heading}<section class="card timer-card wod-clock" id="wod-clock" data-phase="done" aria-label="WOD-kello"><span class="eyebrow accent">${icon('check')} ${esc(face.label)}</span><strong class="timer-clock${long}">${face.time}</strong>${face.detail ? `<p class="timer-label">${esc(face.detail)}</p>` : ''}</section>`
      + `<div class="timer-controls"><button class="btn" data-action="clockback" data-key="clockback-done">Harjoitukseen</button><button class="btn primary" data-action="clocklog" data-key="clocklog">${w.result ? 'Muokkaa tulosta' : 'Kirjaa tulos'}</button></div>${board}`;
  }
  const hidden = (text) => text ? '' : ' hidden';
  const clock = `<section class="card timer-card wod-clock" id="wod-clock" data-phase="${face.phase}" data-segment="${face.segment}" data-paused="${face.paused}" aria-label="WOD-kello"><span class="timer-round" id="wc-label">${esc(parts.label)}</span><strong class="timer-clock${long}" id="wc-time">${face.time}</strong><p class="timer-label" id="wc-target"${hidden(parts.target)}>${esc(parts.target)}</p><p class="timer-next muted" id="wc-detail"${hidden(parts.detail)}>${esc(parts.detail)}</p></section>`;
  const laps = countsRounds(w) ? lapArea(w, face) : '';
  // "Valmis" leads once there is no round left to count.
  const finishing = fortime && !(countsRounds(w) && w.clock.laps.length < w.rounds - 1);
  const pause = face.paused ? `<button class="btn primary" data-action="clockresume" data-key="clock-pause">${icon('play')}Jatka</button>` : `<button class="btn" data-action="clockpause" data-key="clock-pause">${icon('pause')}Tauko</button>`;
  const done = fortime ? `<button class="btn${finishing ? ' primary' : ''}" data-action="clockdone" data-key="clock-done" aria-disabled="${face.phase === 'preroll'}">${icon('check')}Valmis</button>` : '';
  const controls = `<div class="timer-controls timer-run-controls${fortime ? '' : ' clock-controls-2'}"><button class="btn" data-action="clockstop" data-key="clock-stop">${icon('stop')}Lopeta</button>${pause}${done}</div>`;
  return `${heading}${clock}${laps}${controls}${board}`;
}

// ---- Home, history and records ----

export const isFunctionalRoutine = (r) => r?.type === 'functional' || !!r?.wods?.length;

// Home card: one pill per WOD part ("Fran 21-15-9 aikaa vastaan · aikaraja 10 min"); strength pills come from the exercises.
export function routineWodPills(r) {
  return (r.wods ?? []).map((w) => `<li class="pill">${w.name ? `${esc(w.name)} ` : ''}<b>${esc(wodHeadline(w))}</b></li>`).join('');
}

// "Edellinen tulos: Fran 4:32 · Rx (4.3.)" for the parts that have a logged result.
export function routineLastResults(r, history) {
  const parts = (r.wods ?? []).flatMap((w) => {
    const previous = previousResult(history, w.key || wodKey(w));
    return previous ? [`${esc(wodTitle(w))} <strong>${esc(resultLabel(previous.result))}</strong> (${shortDate(previous.at)})`] : [];
  });
  return parts.length ? `<p class="routine-last small-copy"><span class="eyebrow">Edellinen tulos</span> ${parts.join(' · ')}</p>` : '';
}

const loggedWods = (h) => (h.wods ?? []).filter((w) => w.result).length;

// The amount of work a finished workout holds, e.g. "5/5 sarjaa · 1/1 WOD".
export function historyWork(h) {
  return [h.setsTotal ? `${h.setsDone}/${h.setsTotal} sarjaa` : '', h.wods?.length ? `${loggedWods(h)}/${h.wods.length} WOD` : ''].filter(Boolean).join(' · ') || `${h.setsDone}/${h.setsTotal} sarjaa`;
}

// Result lines and, folded away, the whiteboards as they were done.
export function historyWods(h) {
  if (!h.wods?.length) return '';
  const lines = h.wods.map((w) => `<li><strong>${esc(w.name)}</strong> ${w.result ? `${esc(resultLabel(w.result))}${w.result.notes ? ` <span class="muted">· ${esc(w.result.notes)}</span>` : ''}` : '<span class="muted">ei tulosta</span>'}</li>`).join('');
  const boards = h.wods.filter((w) => w.board).map((w) => `<p><strong>${esc(w.name)}</strong></p><ul class="board-lines">${w.board.split('\n').map((line) => `<li>${esc(line)}</li>`).join('')}</ul>`).join('');
  return `<ul class="history-wods" aria-label="WOD-tulokset: ${esc(h.name)}">${lines}</ul>${boards ? `<details class="history-log"><summary>WOD-taulut: ${esc(h.name)}</summary>${boards}</details>` : ''}`;
}

// Corrections of logged WOD scores, one fieldset per part. Values are read back by app.js on change.
export function historyWodEditor(h) {
  if (!h.wods?.length) return '';
  const hid = esc(h.id);
  return h.wods.map((w, wi) => {
    const fields = resultFields({ result: w.result, division: w.result?.division ?? 'rx' });
    const input = (field, label, { kilos = false } = {}) => `<label class="field"><span>${label}</span><input type="text" inputmode="${kilos ? 'decimal' : 'numeric'}" value="${esc(fields[field])}" data-hwod="${field}" data-hid="${hid}" data-w="${wi}" data-key="hwod-${wi}-${field}" aria-label="${label}: ${esc(w.name)}" autocomplete="off"></label>`;
    const capped = w.result?.kind === 'time' && w.result.capped;
    const score = w.score === 'time' ? (capped ? input('reps', 'Toistot aikarajaan mennessä') : `<div class="result-pair">${input('min', 'Minuutit')}${input('sec', 'Sekunnit')}</div>`)
      : w.score === 'roundsReps' ? `<div class="result-pair">${input('rounds', 'Kierrokset')}${input('reps', 'Lisätoistot')}</div>`
        : w.score === 'kg' ? input('value', 'Kuorma (kg)', { kilos: true })
          : w.score === 'none' ? '' : input('value', SCORE_LABELS[w.score]);
    const divisions = Object.entries(DIVISIONS).map(([value, text]) => `<label class="choice-option"><input type="radio" name="hwod-division-${wi}" value="${value}" data-hwod="division" data-hid="${hid}" data-w="${wi}" data-key="hwod-${wi}-division-${value}"${fields.division === value ? ' checked' : ''}><span>${text}</span></label>`).join('');
    const notes = `<label class="field"><span>Muistiinpanot</span><input type="text" maxlength="300" value="${esc(fields.notes)}" data-hwod="notes" data-hid="${hid}" data-w="${wi}" data-key="hwod-${wi}-notes" aria-label="Muistiinpanot: ${esc(w.name)}"></label>`;
    const clear = w.result ? `<button class="btn small delete" data-action="clearhistorywod" data-id="${hid}" data-w="${wi}" data-key="hwod-${wi}-clear" aria-label="Poista tulos: ${esc(w.name)}">Poista tulos</button>` : '';
    return `<fieldset class="history-edit-ex history-edit-wod"><legend>${esc(w.name)}</legend>${score}<fieldset class="result-division"><legend>Versio</legend><div class="choice-row">${divisions}</div></fieldset>${notes}${clear}</fieldset>`;
  }).join('');
}