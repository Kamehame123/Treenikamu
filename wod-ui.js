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
  SCHEME_CHIPS, MODALITY_LABELS, sanitizeWod, parseScheme, boardLines, modalities, movementLine, wodMinutes, wodPartLabel,
} from './wod.js';
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
  return `<ul class="list type-choices">${choice('newgym', 'weight', 'Kuntosalitreeni', 'Liikkeet, sarjat, toistot ja painot. Tavoitteet kehittyvät tulostesi mukaan.')}${choice('newfunctional', 'stopwatch', 'Toiminnallinen treeni', 'Lämmittely, voima tai taito ja ajastettu WOD: aikaa vastaan, AMRAP, EMOM tai intervallit.')}${choice('newtemplate', 'board', 'Aloita mallista', 'Toiminnallinen treeni valmiista rakenteesta tai tunnetusta vertailutreenistä. Muokattavissa ennen tallennusta.')}</ul>`;
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

// What the whiteboard will say, from the values the save would store.
export function boardPreview(raw) {
  const wod = sanitizeWod(raw);
  const [headline, ...rx] = boardLines(wod, 'rx');
  const scaled = wod.movements.some((m) => m.scaled) ? boardLines(wod, 'scaled').slice(1) : [];
  const minutes = wodMinutes(wod);
  const list = (lines) => `<ul class="board-lines">${lines.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>`;
  return `<p class="eyebrow">Taululla</p><p class="board-headline">${esc(wod.name || headline)}</p>${wod.name ? `<p class="board-sub">${esc(headline)}</p>` : ''}${rx.length ? list(rx) : '<p class="field-hint">Lisää liikkeitä, niin ne näkyvät tässä.</p>'}${scaled.length ? `<p class="eyebrow">Skaalattu</p>${list(scaled)}` : ''}${wod.stimulus ? `<p class="board-stimulus">${esc(wod.stimulus)}</p>` : ''}<p class="board-meta"><span>${minutes ? `Kesto noin ${decimal(minutes)} min` : 'Kesto riippuu tahdista'}</span>${modalities(wod).map((k) => `<span class="pill">${MODALITY_LABELS[k]}</span>`).join('')}</p>`;
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
  const [headline, ...lines] = boardLines(wod, 'rx');
  const minutes = wodMinutes(wod);
  const board = `<div class="wod-board">${headline === t.name ? '' : `<p class="board-headline">${esc(headline)}</p>`}<ul class="board-lines">${lines.map((line) => `<li>${esc(line)}</li>`).join('')}</ul><p class="board-meta"><span>${minutes ? `Kesto noin ${decimal(minutes)} min` : 'Kesto riippuu tahdista'}</span>${modalities(wod).map((k) => `<span class="pill">${MODALITY_LABELS[k]}</span>`).join('')}</p></div>`;
  return `<li class="card template-card"><h2>${esc(t.name)}</h2>${templateParts(t)}${board}${wod.stimulus ? `<p class="board-stimulus">${esc(wod.stimulus)}</p>` : ''}${wod.notes ? `<p class="field-hint">${esc(wod.notes)}</p>` : ''}<button class="btn secondary" data-action="usetemplate" data-template="${esc(t.id)}" data-key="use-${esc(t.id)}">Käytä mallia<span class="sr"> ${esc(t.name)}</span> ${icon('arrow')}</button></li>`;
}

// group: a key of TEMPLATE_GROUPS; sex: a key of SEXES (only the suggested loads differ).
export function templateGallery(group, sex, icon) {
  const toggles = (action, attr, options, current, labelling) => `<div class="segmented" role="group" ${labelling}>${Object.entries(options).map(([value, text]) => `<button class="btn secondary" data-action="${action}" data-${attr}="${value}" data-key="${action}-${value}" aria-pressed="${current === value}">${text}</button>`).join('')}</div>`;
  const cards = TEMPLATES.filter((t) => t.group === group).map((t) => templateCard(t, sex, icon)).join('');
  return `<section class="card gallery-controls" aria-label="Mallien valinta">${toggles('templategroup', 'group', TEMPLATE_GROUPS, group, 'aria-label="Mallien ryhmä"')}<p class="field-hint">${GROUP_NOTES[group]}</p><div class="gallery-loads"><span class="eyebrow" id="gallery-loads">Ehdotetut kuormat</span>${toggles('templatesex', 'sex', SEXES, sex, 'aria-labelledby="gallery-loads"')}</div></section><ul class="list template-list" aria-label="${TEMPLATE_GROUPS[group]}">${cards}</ul>`;
}
