import * as core from './core.js';

import { EXERCISES, CATEGORIES, EQUIPMENT, findExercises, normalizeSearch } from './exercises.js';

const $app = document.getElementById('app');
const $live = document.getElementById('live');
const DRAFT_KEY = 'gym-tracker-draft-v1';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = (x) => JSON.parse(JSON.stringify(x));
const blankEx = () => ({ id: core.uid(), name: '', sets: 3, reps: '10', weight: '' });
const paths = {
  arrow: 'M5 12h14m-6-6 6 6-6 6', back: 'm14 6-6 6 6 6',
  plus: 'M12 5v14M5 12h14', check: 'm5 12 4 4L19 6',
  clock: 'M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  weight: 'M7 9h10M7 15h10M7 6v12M4 9v6M17 6v12M20 9v6',
  shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3m-4 9 3 3 5-6',
  settings: 'M4 7h16M4 17h16M8 4v6M16 14v6',
  edit: 'm15 5 4 4M5 15l10-10a3 3 0 0 1 4 4L9 19l-5 1 1-5',
};
const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.weight}"/></svg>`;
let announceId;
function announce(text) {
  clearTimeout(announceId); $live.textContent = '';
  announceId = setTimeout(() => { $live.textContent = text; }, 40);
}
let storage = null;
let storageOk = true;
let durableRaw = null;
try { storage = window.localStorage; durableRaw = storage.getItem(core.STORAGE_KEY); } catch { storageOk = false; }
let state = core.loadState(storage);
let newerSchema = core.hasNewerSchema(durableRaw);
if (newerSchema) storageOk = false;
let dirty = false;
let saveConflict = false;
let saveMessage = '';
let draft = null;
let draftOk = true;
try {
  const saved = JSON.parse(sessionStorage.getItem(DRAFT_KEY));
  if (saved && typeof saved.id === 'string' && Array.isArray(saved.exercises)) {
    draft = saved;
    draft.exercises = draft.exercises.slice(0, 60).filter((e) => e && typeof e === 'object');
  }
} catch { /* Session storage is optional; the workout still works. */ }
let view = draft ? 'edit' : state.session ? 'workout' : 'home';
let renderedView;
let editError = '';
let settingsOpen = false;
let picker = { query: '', category: '', equipment: '', customOnly: false, limit: 40, target: null };
let customError = '';
let customOpen = false;
const customEntry = () => draft.customEntry ??= { name: '', category: 'Koko keho', equipment: 'Muu väline', reps: '10' };
let importMessage = '';
let importMode = 'merge';
let offlineReady = false;
let updateReady = false;
let wakeLock = null;
let wakePending = false;
let pendingActions = 0;
let actionQueue = Promise.resolve();
const byId = (id, source = state) => source.routines.find((r) => r.id === id);

function rememberDraft() {
  try {
    if (draft) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else sessionStorage.removeItem(DRAFT_KEY);
    draftOk = true;
  } catch { draftOk = false; }
  const status = document.getElementById('draft-status');
  const message = draftOk ? 'LUONNOS SÄILYY TÄSSÄ VÄLILEHDESSÄ' : 'LUONNOS EI TALLENTUNUT — pidä välilehti auki';
  if (status && status.textContent !== message) status.textContent = message;
}

function readLatest() {
  if (dirty || !storageOk || !storage) return;
  try {
    const saved = storage.getItem(core.STORAGE_KEY);
    newerSchema = core.hasNewerSchema(saved);
    if (newerSchema) { storageOk = false; durableRaw = saved; return; }
    if (saved) state = core.sanitizeState(JSON.parse(saved));
    else if (durableRaw !== null) state = core.defaultState();
    durableRaw = saved;
  } catch { storageOk = false; }
}

// Every write reads the latest durable state while holding an origin-wide lock.
// Never save stale state on pagehide: every actual mutation is saved immediately.
async function mutate(change, { critical = false, sessionId = null } = {}) {
  const work = async () => {
    try { newerSchema = core.hasNewerSchema(storage?.getItem(core.STORAGE_KEY)); } catch { /* Storage denial is handled below. */ }
    if (newerSchema) { storageOk = false; render(); return false; }
    if ((dirty || !storageOk) && storage) {
      try {
        if (storage.getItem(core.STORAGE_KEY) !== durableRaw) {
          saveConflict = true;
          saveMessage = 'Toinen välilehti tallensi uudempia tietoja. Vie tämän välilehden muutokset talteen ja lataa sitten tallennettu versio. Mitään ei ole korvattu.';
          storageOk = false; render(); return false;
        }
      } catch { /* Keep memory-only progress available when storage is still denied. */ }
    }
    readLatest();
    if (sessionId && state.session?.id !== sessionId) {
      announce('Harjoitus muuttui toisessa välilehdessä. Näkymä on päivitetty.'); render(); return false;
    }
    const next = clone(state);
    if (change(next) === false) return false;
    const saved = core.saveState(storage, next);
    storageOk = saved;
    if (saved) { durableRaw = JSON.stringify(next); saveConflict = false; }
    saveMessage = saved ? '' : critical ? 'Muutosta ei voitu tallentaa. Harjoitus on yhä tallessa tässä välilehdessä. Yritä uudelleen ennen sulkemista.' : 'Muutokset ovat vain tässä välilehdessä. Tallennus ei onnistu. Älä sulje välilehteä ennen tallentamista.';
    if (saved || !critical) { state = next; dirty = !saved; }
    render();
    return saved || !critical;
  };
  return navigator.locks ? navigator.locks.request(`${core.STORAGE_KEY}:write`, work) : work();
}

const warn = () => storageOk ? '' : `<div class="banner" role="alert">${icon('shield')}<div><strong>${newerSchema ? 'Päivitä sovellus' : 'Tallennus vaatii huomiota'}</strong><p>${esc(newerSchema ? 'Tiedot on tallennettu uudemmalla sovelluksella. Tämä versio ei muuta niitä. Sulje sovelluksen välilehdet, yhdistä verkkoon ja avaa uudelleen. Voit viedä alkuperäiset tiedot talteen.' : saveMessage || 'Tallennus ei ole käytettävissä. Muutokset katoavat, jos suljet välilehden.')}</p><div class="recovery-actions">${newerSchema ? '' : '<button class="btn small" data-action="retry" data-key="retry">Yritä tallentaa uudelleen</button>'}<button class="btn small" data-action="export" data-key="export-pending">${newerSchema ? 'Vie alkuperäiset tiedot' : 'Vie tallentamattomat muutokset'}</button>${saveConflict ? '<button class="btn small" data-action="reloadsaved" data-key="reloadsaved">Lataa tallennettu versio</button>' : ''}</div></div></div>`;
const sectionHead = (title, label = '') => `<div class="section-head"><h2>${title}</h2>${label ? `<span class="eyebrow">${label}</span>` : ''}</div>`;
const progressBar = (p) => `<progress class="progress" max="${Math.max(1, p.total)}" value="${p.done}" aria-label="Harjoituksen edistyminen">${p.pct}%</progress>`;

function brand() {
  return `<header class="brand-row"><a class="brand" href="#" data-action="home" data-key="brand" aria-label="Treenipäiväkirja – etusivu"><span class="brand-mark">${icon('weight')}</span><span>TREENI<span class="brand-light">PÄIVÄKIRJA</span></span></a><span class="status" id="connection">${connectionText()}</span></header>`;
}
function connectionText() { return !navigator.onLine ? 'Ei verkkoyhteyttä' : offlineReady ? 'Toimii myös ilman verkkoa' : 'Tällä laitteella'; }

function homeView() {
  const s = state.session;
  const totalSets = state.history.reduce((n, h) => n + h.setsDone, 0);
  const weekStart = new Date(); weekStart.setHours(0, 0, 0, 0); weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const thisWeek = state.history.filter((h) => h.endedAt >= +weekStart).length;
  const resume = s ? `<section class="resume card"><div class="row"><span class="eyebrow accent"><span class="pulse" aria-hidden="true"></span> HARJOITUS KESKEN</span><span class="badge now">${core.progress(s).pct}%</span></div><h2>${esc(s.name)}</h2><p class="muted">${core.progress(s).done}/${core.progress(s).total} sarjaa tehty · Jatka siitä, mihin jäit.</p>${progressBar(core.progress(s))}<button class="btn primary big" data-action="resume" data-key="resume">Jatka harjoitusta ${icon('arrow')}</button></section>` : '';
  const routines = state.routines.map((r, i) => {
    const pills = r.exercises.slice(0, 4).map((e) => `<span class="pill">${esc(e.name)} <b>${e.sets}×${esc(e.reps)}</b></span>`).join(' ') + (r.exercises.length > 4 ? ` <span class="pill pill-muted">+${r.exercises.length - 4} muuta</span>` : '');
    return `<li class="card routine"><div class="row routine-head"><span class="routine-icon">${icon('weight')}</span><div class="grow"><span class="eyebrow">OHJELMA ${String(i + 1).padStart(2, '0')}</span><h3>${esc(r.name)}</h3><p class="routine-meta">${r.exercises.length} liikettä <span>·</span> ${r.exercises.reduce((n, e) => n + e.sets, 0)} sarjaa</p></div><button class="btn ghost icon-button" data-action="edit" data-key="edit-${esc(r.id)}" data-id="${esc(r.id)}" aria-label="Muokkaa: ${esc(r.name)}">${icon('edit')}</button></div><div class="routine-pills">${pills}</div><button class="btn ${i === 0 ? 'primary' : 'secondary'} big" data-action="start" data-key="start-${esc(r.id)}" data-id="${esc(r.id)}">Aloita harjoitus ${icon('arrow')}</button></li>`;
  }).join('');
  const history = state.history.slice(0, 10).map((h) => `<li class="hist"><span class="history-check">${icon('check')}</span><div class="grow"><h3>${esc(h.name)}</h3><span class="muted">${new Date(h.endedAt).toLocaleDateString('fi-FI', { month: 'short', day: 'numeric' })} · ${core.formatDuration(h.endedAt - h.startedAt)}</span></div><span class="history-sets">${h.setsDone}<span>/${h.setsTotal} sarjaa</span></span></li>`).join('');
  const ios = (/iPad|iPhone|iPod/.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) && !navigator.standalone;
  const hint = ios ? '<p class="install-hint" id="ios-hint">Lisää sovellus aloitusnäyttöön: Jaa → Lisää Koti-valikkoon. Tiedot säilyvät tällä laitteella. Selaintietojen tyhjentäminen voi poistaa ne.</p>' : '';
  return `${brand()}${warn()}${resume}<section class="home-hero"><div><p class="eyebrow accent">OMA TREENISI · SARJA KERRALLAAN</p><h1 class="hero-title" tabindex="-1">Treenipäiväkirja</h1><p class="hero-copy">Suunnittele ohjelma ja kirjaa sarjat yhdellä napautuksella.</p></div><div class="hero-art" aria-hidden="true"><div class="art-weight">${icon('weight')}</div></div></section>
    <div class="stats"><div><strong>${thisWeek}</strong><span>tällä viikolla</span></div><div><strong>${totalSets}</strong><span>kirjattua sarjaa</span></div><div><strong>${state.history.length}</strong><span>valmista treeniä</span></div></div>
    <div class="home-grid"><section>${sectionHead('Harjoitukset', 'OMAT OHJELMASI')}<ul class="list routine-list">${routines}</ul><button class="btn secondary add-workout" data-action="new" data-key="new">${icon('plus')} Uusi harjoitus</button><p class="coaching-note">Liikekirjastossa on ${EXERCISES.length} liikettä. Valitse liikkeet harjoituksen muokkauksessa tai lisää omasi. Esimerkkiohjelma ei ole henkilökohtainen suositus. Lämmittele, valitse sopivat painot ja lepää tarpeeksi. Lopeta, jos tunnet kipua.</p></section>
    <div class="home-aside"><section>${sectionHead('Historia', 'VIIMEISIMMÄT HARJOITUKSET')}${history ? `<ul class="list history-list">${history}</ul>` : `<div class="empty-state">${icon('clock')}<h3>Kehitys alkaa tästä</h3><p>Tallenna ensimmäinen harjoituksesi. Jokainen tehty sarja merkitsee.</p></div>`}</section>
    <details class="settings card" ${settingsOpen ? 'open' : ''}><summary>${icon('settings')}<h2>Asetukset</h2><span class="settings-chevron" aria-hidden="true">⌄</span></summary><div class="settings-body"><label class="check"><span>Automaattinen lepoajastin<small>Käynnistyy tehdyn sarjan jälkeen</small></span><input type="checkbox" role="switch" data-action="autorest" data-key="autorest" ${state.settings.autoRest ? 'checked' : ''} aria-label="Käynnistä lepoajastin sarjan jälkeen"></label><label class="field">Lepoaika sekunteina<input type="number" inputmode="numeric" min="10" max="600" value="${state.settings.restSeconds}" data-action="restsecs" data-key="restsecs"></label><p class="muted small-copy">10–600 sekuntia. Lepää tarvittaessa pidempään.</p><div class="settings-actions"><button class="btn secondary" data-action="export" data-key="export">Vie varmuuskopio</button><button class="btn secondary" data-action="import" data-key="import">Tuo varmuuskopio</button><button class="btn secondary" data-action="restore" data-key="restore">Palauta varmuuskopio</button></div><p class="muted small-copy">Tuonti yhdistää varmuuskopion nykyisiin tietoihin. Palautus korvaa ne. Keskeneräinen harjoitus säilyy aina.</p>${importMessage ? `<p class="small-copy" id="import-status" role="status">${esc(importMessage)}</p>` : ''}</div></details></div></div>${hint}<footer>${icon('shield')} Vain tällä laitteella. Ei tiliä. Ei seurantaa.<span>Tietosi pysyvät laitteellasi. Muista varmuuskopio.</span>${updateReady ? '<p>Päivitys on valmis. Sulje sovelluksen välilehdet ja avaa uudelleen.</p>' : ''}</footer>`;
}

function workoutView() {
  const s = state.session, p = core.progress(s), cur = core.currentExercise(s);
  const exercises = s.exercises.map((e, ei) => {
    const done = core.exerciseDone(e);
    const completed = e.sets.filter((set) => set.done).length;
    const nextSi = ei === cur ? e.sets.findIndex((set) => !set.done) : -1;
    const sets = e.sets.map((set, si) => `<button class="set ${set.done ? 'done' : ''} ${si === nextSi ? 'next' : ''}" data-action="set" data-e="${ei}" data-s="${si}" data-key="s${ei}-${si}" aria-pressed="${set.done}" aria-label="Sarja ${si + 1} ${set.done ? 'Tehty' : `${esc(e.reps)} Kirjaa`}. ${esc(e.name)}, sarja ${si + 1}/${e.sets.length}, ${esc(core.targetLabel(e.reps))}"><span class="set-label">SARJA ${si + 1}</span> <span class="set-value">${set.done ? icon('check') : esc(e.reps)}</span> <span class="set-foot">${set.done ? 'Tehty' : 'Kirjaa'}</span></button>`).join('');
    return `<li class="card ex ${done ? 'complete' : ''} ${ei === cur ? 'current' : ''}" id="exercise-${ei}"><div class="exercise-heading"><span class="exercise-index">${String(ei + 1).padStart(2, '0')}</span><div class="grow"><h2>${esc(e.name)}</h2><p class="target">${e.sets.length} sarjaa <span>×</span> ${esc(core.targetLabel(e.reps))}${e.weight ? ` <span class="weight-pill">${esc(e.weight)}</span>` : ''}</p></div>${done ? '<span class="badge done-badge">Tehty</span>' : ei === cur ? '<span class="badge now">Vuorossa</span>' : `<span class="badge">${completed}/${e.sets.length}</span>`}</div><div class="sets">${sets}</div><div class="exercise-footer"><span class="muted">${completed}/${e.sets.length} kirjattu</span><div class="mini"><button class="btn ghost" data-action="rmset" data-key="r${ei}" data-e="${ei}" ${e.sets.length < 2 ? 'disabled' : ''} aria-label="Poista sarja: ${esc(e.name)}">− Sarja</button><button class="btn ghost" data-action="addset" data-key="a${ei}" data-e="${ei}" ${e.sets.length >= core.MAX_SETS ? 'disabled' : ''} aria-label="Lisää sarja: ${esc(e.name)}">+ Sarja</button></div></div></li>`;
  }).join('');
  return `<header class="session-header"><button class="btn ghost back" data-action="home" data-key="back" aria-label="Takaisin harjoituksiin">${icon('back')} Harjoituksiin</button><span class="session-time">${icon('clock')}<span id="elapsed">0:00</span></span></header>${warn()}<section class="session-intro card"><div class="row"><p class="eyebrow accent">${p.done === p.total ? 'KAIKKI SARJAT KIRJATTU' : 'HARJOITUS KÄYNNISSÄ'}</p><span class="session-stat">${p.done}/${p.total} sarjaa · ${p.pct}%</span></div><h1 tabindex="-1">${esc(s.name)}</h1>${progressBar(p)}<div class="session-summary"><p class="session-guide">${cur < 0 ? 'Hienoa työtä! Tallenna harjoitus lopettamalla.' : 'Napauta sarjaa kirjataksesi. Uusi napautus peruu.'}</p><span class="muted">${s.exercises.filter(core.exerciseDone).length}/${s.exercises.length} liikettä</span></div>${cur > 0 ? `<button class="btn secondary jump" data-action="jump" data-key="jump">Jatka liikkeestä: ${esc(s.exercises[cur].name)} ${icon('arrow')}</button>` : ''}</section><ul class="list exercise-list">${exercises}</ul><div class="session-end"><button class="btn ${p.done === p.total ? 'primary' : 'secondary'} big" data-action="finish" data-key="finish">${p.done === p.total ? 'Tallenna harjoitus' : 'Lopeta kesken'} ${icon('check')}</button><button class="btn danger" data-action="discard" data-key="discard">Hylkää harjoitus</button><p class="small-copy muted">${storageOk ? 'Edistyminen tallennettu tälle laitteelle.' : 'Edistymistä ei ole tallennettu. Pidä välilehti auki.'}</p></div><div id="rest" class="rest" hidden></div>`;
}

function editView() {
  const rows = draft.exercises.map((e, i) => `<li class="card edit"><div class="row editor-row"><span class="eyebrow exercise-tag">LIIKE ${String(i + 1).padStart(2, '0')}</span><div class="mini"><button class="btn ghost icon-button" data-action="up" data-i="${i}" data-key="up-${esc(e.id)}" ${i === 0 ? 'disabled' : ''} aria-label="Siirrä ylös">↑</button><button class="btn ghost icon-button" data-action="down" data-i="${i}" data-key="down-${esc(e.id)}" ${i === draft.exercises.length - 1 ? 'disabled' : ''} aria-label="Siirrä alas">↓</button><button class="btn ghost danger-text" data-action="rmex" data-i="${i}" data-key="remove-${esc(e.id)}" aria-label="Poista liike ${i + 1}">Poista</button></div></div><div class="name-picker-row"><label class="field grow">Liikkeen nimi<input type="text" maxlength="60" value="${esc(e.name)}" data-f="name" data-i="${i}" data-key="name-${esc(e.id)}" autocomplete="off" placeholder="Esim. maljakyykky"></label><button class="btn secondary pick-exercise" data-action="pickex" data-id="${esc(e.id)}" data-key="pick-${esc(e.id)}">Valitse kirjastosta</button></div><div class="grid3"><label class="field">Sarjat<input type="number" inputmode="numeric" min="1" max="20" step="1" value="${esc(e.sets)}" data-f="sets" data-i="${i}" data-key="sets-${esc(e.id)}"></label><label class="field">Toistot / aika<input type="text" maxlength="20" value="${esc(e.reps)}" data-f="reps" data-i="${i}" data-key="reps-${esc(e.id)}" placeholder="8–12 / 30 s"></label><label class="field">Paino <span class="optional">valinnainen</span><input type="text" maxlength="20" value="${esc(e.weight)}" data-f="weight" data-i="${i}" data-key="weight-${esc(e.id)}" placeholder="20 kg"></label></div></li>`).join('');
  return `<header class="editor-header"><button class="btn ghost back" data-action="home" data-key="cancel">${icon('back')} Peruuta</button><span class="eyebrow" id="draft-status" role="status">${draftOk ? 'LUONNOS SÄILYY TÄSSÄ VÄLILEHDESSÄ' : 'LUONNOS EI TALLENTUNUT — pidä välilehti auki'}</span></header>${warn()}<div class="editor-top"><p class="eyebrow accent">SUUNNITTELE HARJOITUKSESI</p><h1 tabindex="-1">${draft.isNew ? 'Uusi harjoitus' : 'Muokkaa harjoitusta'}</h1><p class="editor-copy">Valitse ${EXERCISES.length} liikkeestä tai lisää omasi. Aseta tavoitteet oman tasosi mukaan.</p></div><label class="field name-field">Harjoituksen nimi<input type="text" maxlength="60" value="${esc(draft.name)}" data-f="rname" data-key="rname" autocomplete="off" placeholder="Esim. ylävartalo A"></label><ul class="list editor-list">${rows}</ul><button class="btn secondary add-ex-btn" data-action="addex" data-key="addex" ${draft.exercises.length >= 60 ? 'disabled' : ''}>${icon('plus')} Lisää liike</button><p id="err" class="banner" role="alert" tabindex="-1" ${editError ? '' : 'hidden'}>${esc(editError)}</p><div class="editor-save"><button class="btn primary big" data-action="save" data-key="save">Tallenna harjoitus ${icon('check')}</button></div>${draft.isNew ? '' : '<button class="btn danger" data-action="delroutine" data-key="delroutine">Poista harjoitus</button>'}`;
}

// Disclosure + native radios avoid mobile WebKit's CSP-blocked select shadow styles.
function choiceMenu(id, label, values, selected, all = '', custom = false) {
  const choices = all ? ['', ...values] : values;
  const field = id.endsWith('category') ? 'category' : 'equipment';
  return `<div class="field"><span id="${id}-label">${label}</span><details class="choice-menu" id="${id}"><summary data-key="${id}" aria-labelledby="${id}-label ${id}-value"><span id="${id}-value">${esc(selected || all)}</span><span aria-hidden="true">⌄</span></summary><fieldset><legend class="sr">${label}</legend>${choices.map((value, i) => `<label class="choice-option"><input type="radio" name="${id}" value="${esc(value)}" ${custom ? `data-custom="${field}"` : `data-filter="${field}"`} data-key="${id}-${i}" ${value === selected ? 'checked' : ''}><span>${esc(value || all)}</span></label>`).join('')}</fieldset></details></div>`;
}
function libraryMatches() { return findExercises(picker.query, { ...picker, custom: state.customExercises }); }
function libraryResults(rows) {
  return rows.slice(0, picker.limit).map((e) => `<li><button class="exercise-choice" data-action="chooseex" data-id="${esc(e.id)}" data-key="choice-${esc(e.id)}"><span class="choice-icon">${icon('weight')}</span><span class="grow"><span class="sr">Valitse liike: </span><strong>${esc(e.name)}</strong><span class="choice-meta">${esc(e.category)} · ${esc(e.equipment)}${e.custom ? ' · Oma liike' : ''}</span></span>${icon('plus')}</button></li>`).join('');
}
function libraryView() {
  const rows = libraryMatches(), own = customEntry();
  return `<header class="editor-header"><button class="btn ghost back" data-action="backedit" data-key="backedit">${icon('back')} Takaisin harjoitukseen</button><span class="eyebrow">${EXERCISES.length} + ${state.customExercises.length} OMAA</span></header>${warn()}<div class="library-top"><h1 tabindex="-1">Liikekirjasto</h1><p class="editor-copy">${picker.target ? 'Valitse liike tähän kohtaan. Tavoitteet säilyvät.' : 'Valitse harjoitukseen lisättävä liike.'} Haku toimii myös englanniksi.</p></div>
    <div role="search" aria-label="Liikkeiden haku" class="library-filters card"><label class="field">Hae liikettä<input type="search" id="exercise-search" data-key="exercise-search" maxlength="120" value="${esc(picker.query)}" placeholder="Esim. kyykky, ylätalja tai bench press" aria-controls="library-results" autocomplete="off"></label><div class="filter-grid">${choiceMenu('library-category', 'Lihasryhmä', CATEGORIES, picker.category, 'Kaikki lihasryhmät')}${choiceMenu('library-equipment', 'Väline', EQUIPMENT, picker.equipment, 'Kaikki välineet')}</div><label class="check library-own"><span>Vain omat liikkeet</span><input type="checkbox" id="library-own" data-key="library-own" ${picker.customOnly ? 'checked' : ''}></label></div>
    <details class="custom-exercise card" ${customOpen ? 'open' : ''}><summary>Lisää oma liike ${icon('plus')}</summary><p class="small-copy muted">Oma liike tallentuu kirjastoon ja varmuuskopioon. Voit valita sen myöhemmin uudelleen.</p><form id="custom-exercise-form" novalidate><label class="field">Oman liikkeen nimi<input type="text" data-custom="name" data-key="custom-name" maxlength="60" value="${esc(own.name)}" required autocomplete="off"></label><div class="filter-grid">${choiceMenu('custom-category', 'Oman liikkeen lihasryhmä', CATEGORIES, own.category, '', true)}${choiceMenu('custom-equipment', 'Oman liikkeen väline', EQUIPMENT, own.equipment, '', true)}</div><label class="field">Oletustoistot / aika<input type="text" data-custom="reps" data-key="custom-reps" maxlength="20" value="${esc(own.reps)}" required></label><p id="custom-error" role="alert" tabindex="-1" class="banner" ${customError ? '' : 'hidden'}>${esc(customError)}</p><button type="submit" class="btn primary big">Tallenna ja lisää harjoitukseen ${icon('plus')}</button></form></details>
    <div class="section-head library-count"><h2>Liikkeet</h2><span id="library-count" class="muted small-copy" role="status">${rows.length} hakutulosta</span></div><ul id="library-results" class="list library-results">${libraryResults(rows)}</ul><div id="library-empty" class="empty-state" ${rows.length ? 'hidden' : ''}><h3>Liikettä ei löytynyt</h3><p>Kokeile toista hakusanaa tai lisää oma liike.</p><button class="btn secondary" data-action="newcustom" data-key="newcustom">Lisää haettu nimi omana liikkeenä</button></div><button class="btn secondary library-more" data-action="moreex" data-key="moreex" ${rows.length <= picker.limit ? 'hidden' : ''}>Näytä lisää liikkeitä</button>`;
}
function updateLibraryResults() {
  const rows = libraryMatches();
  document.getElementById('library-results').innerHTML = libraryResults(rows);
  document.getElementById('library-count').textContent = `${rows.length} hakutulosta`;
  document.getElementById('library-empty').hidden = rows.length > 0;
  document.querySelector('[data-action="moreex"]').hidden = rows.length <= picker.limit;
}
function openLibrary(target = null) {
  picker = { query: '', category: '', equipment: '', customOnly: false, limit: 40, target };
  customOpen = false; customError = ''; view = 'library'; rememberDraft(); render();
}
function chooseExercise(exercise) {
  if (!exercise || !draft) return;
  let row = picker.target && draft.exercises.find((e) => e.id === picker.target);
  if (!row) {
    if (draft.exercises.length >= 60) { announce('Harjoituksessa voi olla enintään 60 liikettä.'); return; }
    row = blankEx(); draft.exercises.push(row);
  }
  if (!row.name.trim()) row.reps = exercise.reps;
  row.name = exercise.name;
  delete draft.customEntry;
  view = 'edit'; rememberDraft(); render();
  document.querySelector(`[data-key="name-${CSS.escape(row.id)}"]`)?.focus();
  announce(`${exercise.name} lisätty harjoitukseen.`);
}

function render() {
  const previous = document.activeElement;
  const key = previous?.dataset?.key;
  const selection = previous?.tagName === 'INPUT' && previous.type === 'text' ? [previous.selectionStart, previous.selectionEnd] : null;
  const scroll = window.scrollY;
  if (view === 'workout' && !state.session) view = 'home';
  if (view === 'library' && !draft) view = 'home';
  const changed = renderedView !== view;
  $app.className = `view-${view}`;
  $app.innerHTML = view === 'workout' ? workoutView() : view === 'library' ? libraryView() : view === 'edit' && draft ? editView() : homeView();
  const target = key && document.querySelector(`[data-key="${CSS.escape(key)}"]`);
  if (!changed && target) {
    target.focus({ preventScroll: true });
    if (selection) target.setSelectionRange(...selection);
  } else if (changed && renderedView) document.querySelector('h1')?.focus({ preventScroll: true });
  window.scrollTo(0, changed ? 0 : scroll);
  renderedView = view;
  tick(); syncWakeLock();
}

let lastRestBeep = 0;
function tick() {
  const elapsed = document.getElementById('elapsed');
  if (elapsed && state.session) elapsed.textContent = core.formatDuration(Date.now() - state.session.startedAt);
  const rest = document.getElementById('rest');
  if (!rest) return;
  if (!state.restEnd) { rest.hidden = true; rest.dataset.state = ''; return; }
  const left = state.restEnd - Date.now();
  const mode = left > 0 ? 'run' : 'over';
  rest.hidden = false;
  if (rest.dataset.state !== mode) {
    rest.dataset.state = mode;
    rest.innerHTML = mode === 'run' ? `<div class="rest-info">${icon('clock')}<div><span class="eyebrow">PALAUDU RAUHASSA</span><strong id="rleft"></strong></div></div><div class="rest-actions"><button class="btn" data-action="plus" data-key="plus">+30 s</button><button class="btn primary" data-action="skiprest" data-key="skip">Ohita</button></div>` : `<div class="rest-info">${icon('check')}<div><span class="eyebrow">JATKA KUN OLET VALMIS</span><strong>Lepoaika päättyi</strong></div></div><button class="btn primary" data-action="skiprest" data-key="dismiss">Sulje</button>`;
  }
  if (left > 0) document.getElementById('rleft').textContent = core.formatDuration(left + 999);
  else if (lastRestBeep !== state.restEnd) { lastRestBeep = state.restEnd; navigator.vibrate?.([200, 100, 200]); announce('Lepoaika päättyi. Lepää tarvittaessa lisää.'); }
}
setInterval(tick, 500);

async function syncWakeLock() {
  const want = () => view === 'workout' && state.session && document.visibilityState === 'visible';
  try {
    if (want() && !wakeLock && !wakePending && 'wakeLock' in navigator) {
      wakePending = true;
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (!want()) { await lock.release(); return; }
        wakeLock = lock;
        lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
      } finally { wakePending = false; }
    } else if (!want() && wakeLock) { const lock = wakeLock; wakeLock = null; await lock.release(); }
  } catch { /* Denied/unsupported: tracking does not depend on it. */ }
}

function editorError(message) {
  editError = message; render(); document.getElementById('err')?.focus({ preventScroll: false });
}
function clearDraft() { draft = null; editError = ''; rememberDraft(); }
function openDraft(r, isNew) {
  draft = { ...clone(r), isNew, base: isNew ? null : JSON.stringify(r) };
  draft.initial = JSON.stringify({ name: draft.name, exercises: draft.exercises });
  view = 'edit'; editError = ''; rememberDraft(); render();
}
function swap(i, direction) {
  const target = i + direction;
  if (target < 0 || target >= draft.exercises.length) return;
  [draft.exercises[i], draft.exercises[target]] = [draft.exercises[target], draft.exercises[i]];
  rememberDraft(); render(); announce(`Liike siirretty kohtaan ${target + 1}.`);
}
function sessionOptions() { return { sessionId: state.session?.id }; }

const actions = {
  async start(t) {
    await mutate((next) => {
      if (next.session && !confirm('Korvataanko keskeneräinen harjoitus? Sen kirjaukset menetetään.')) return false;
      const session = core.startSession(byId(t.dataset.id, next));
      if (!session) { announce('Lisää ensin vähintään yksi liike.'); return false; }
      next.session = session; next.restEnd = null;
    });
    if (state.session) { view = 'workout'; render(); }
  },
  resume() { view = 'workout'; render(); },
  home() {
    if (draft && JSON.stringify({ name: draft.name, exercises: draft.exercises }) !== draft.initial && !confirm('Hylätäänkö harjoituksen tallentamattomat muutokset?')) return;
    clearDraft(); view = 'home'; render();
  },
  async retry() {
    // Keep pending in-memory progress; the write lock prevents another simultaneous write.
    await mutate(() => {}, { critical: true });
    if (storageOk) announce('Edistyminen tallennettu.');
  },
  reloadsaved() {
    if (!confirm('Korvataanko tämän välilehden tallentamattomat muutokset tallennetulla versiolla? Vie muutokset ensin talteen, jos haluat säilyttää molemmat.')) return;
    dirty = false; saveConflict = false; storageOk = true; readLatest(); render();
  },
  async set(t) {
    await mutate((next) => {
      const ei = +t.dataset.e, si = +t.dataset.s, ex = next.session?.exercises[ei];
      if (!ex?.sets[si]) return false;
      const done = core.toggleSet(next.session, ei, si);
      if (done) {
        navigator.vibrate?.(15);
        const p = core.progress(next.session);
        next.restEnd = next.settings.autoRest && p.done < p.total ? Date.now() + next.settings.restSeconds * 1000 : null;
      }
      announce(`${ex.name}, sarja ${si + 1} ${done ? 'tehty' : 'kirjaus peruttu'}.${done && next.restEnd ? ` Lepoajastin käynnistyi, ${next.settings.restSeconds} sekuntia.` : ''}`);
    }, sessionOptions());
  },
  async addset(t) { await mutate((next) => core.addSet(next.session, +t.dataset.e), sessionOptions()); },
  async rmset(t) {
    await mutate((next) => {
      const ex = next.session?.exercises[+t.dataset.e];
      if (!ex || ex.sets.length < 2) return false;
      if (ex.sets.at(-1).done && !confirm('Poistetaanko tehty sarja? Myös sen suoritusmerkintä poistuu.')) return false;
      core.removeSet(next.session, +t.dataset.e);
      const p = core.progress(next.session); if (p.done === p.total) next.restEnd = null;
    }, sessionOptions());
  },
  async skiprest() { await mutate((next) => { next.restEnd = null; }, sessionOptions()); },
  async plus() { await mutate((next) => { next.restEnd = Math.max(next.restEnd || 0, Date.now()) + 30000; }, sessionOptions()); },
  async finish() {
    const ok = await mutate((next) => {
      if (!next.session) return false;
      const p = core.progress(next.session);
      if (p.done < p.total && !confirm(`${p.total - p.done} sarjaa on tekemättä. Lopetetaanko silti?`)) return false;
      if (p.done) next.history.unshift(core.summarize(next.session));
      next.history = next.history.slice(0, 100); next.session = null; next.restEnd = null;
    }, { ...sessionOptions(), critical: true });
    if (ok) { view = 'home'; render(); announce('Harjoitus tallennettu. Hienoa työtä!'); }
  },
  async discard() {
    if (!confirm('Hylätäänkö harjoitus? Suoritusmerkinnät menetetään.')) return;
    if (await mutate((next) => { next.session = null; next.restEnd = null; }, { ...sessionOptions(), critical: true })) { view = 'home'; render(); }
  },
  new() { openDraft({ id: core.uid(), name: '', exercises: [blankEx()] }, true); },
  edit(t) { const r = byId(t.dataset.id); if (r) openDraft(r, false); },
  addex() { if (draft.exercises.length >= 60) return; openLibrary(draft.exercises.find((e) => !e.name.trim())?.id ?? null); },
  pickex(t) { openLibrary(t.dataset.id); },
  backedit() { view = 'edit'; render(); document.querySelector(picker.target ? `[data-key="pick-${CSS.escape(picker.target)}"]` : '[data-key="addex"]')?.focus(); },
  chooseex(t) { chooseExercise([...EXERCISES, ...state.customExercises].find((e) => e.id === t.dataset.id)); },
  moreex() { picker.limit += 40; updateLibraryResults(); document.querySelectorAll('.exercise-choice')[picker.limit - 40]?.focus(); },
  newcustom() {
    customOpen = true; customEntry().name = picker.query.slice(0, 60); rememberDraft(); render();
    document.querySelector('[data-custom="name"]')?.focus();
  },
  async createcustom() {
    const own = customEntry();
    const fail = (message) => { customError = message; customOpen = true; render(); document.getElementById('custom-error')?.focus(); };
    if (!own.name.trim()) { fail('Anna omalle liikkeelle nimi.'); return; }
    if (!own.reps.trim()) { fail('Lisää toistotavoite tai kesto.'); return; }
    const record = core.sanitizeCustomExercises([{ ...own, id: `own-${core.uid()}` }])[0];
    const ok = await mutate((next) => {
      if (next.customExercises.length >= core.MAX_CUSTOM_EXERCISES) { fail(`Voit tallentaa enintään ${core.MAX_CUSTOM_EXERCISES} omaa liikettä.`); return false; }
      if ([...EXERCISES, ...next.customExercises].some((e) => normalizeSearch(e.name) === normalizeSearch(record.name) && e.equipment === record.equipment)) {
        fail('Samanniminen liike samalla välineellä on jo kirjastossa. Valitse se hakutuloksista.'); return false;
      }
      next.customExercises.push(record);
    }, { critical: true });
    if (ok) { customError = ''; customOpen = false; chooseExercise(record); }
  },
  rmex(t) { draft.exercises.splice(+t.dataset.i, 1); rememberDraft(); render(); document.querySelector('[data-key="addex"]')?.focus(); },
  up(t) { swap(+t.dataset.i, -1); },
  down(t) { swap(+t.dataset.i, 1); },
  async save() {
    const errors = core.validateRoutine(draft);
    if (errors.length) { editorError(errors.join(' ')); return; }
    const r = core.sanitizeRoutine(draft);
    const ok = await mutate((next) => {
      const existing = byId(r.id, next);
      if (!draft.isNew && JSON.stringify(existing) !== draft.base) { editorError('Harjoitus muuttui toisessa välilehdessä. Luonnoksesi säilyy tässä. Peruuta ja avaa tallennettu versio tai kopioi muutokset uuteen harjoitukseen.'); return false; }
      if (draft.isNew && next.routines.length >= 100) { editorError('Voit tallentaa enintään 100 harjoitusta. Poista ensin tarpeeton ohjelma.'); return false; }
      const i = next.routines.findIndex((x) => x.id === r.id);
      if (i < 0) next.routines.push(r); else next.routines[i] = r;
    }, { critical: true });
    if (ok) { clearDraft(); view = 'home'; render(); announce('Harjoitus tallennettu.'); }
  },
  async delroutine() {
    if (!confirm('Poistetaanko harjoitusohjelma? Keskeneräinen harjoitus ei muutu.')) return;
    const ok = await mutate((next) => {
      if (next.routines.length < 2) { editorError('Säilytä vähintään yksi harjoitus. Luo ensin uusi ohjelma.'); return false; }
      if (JSON.stringify(byId(draft.id, next)) !== draft.base) { editorError('Harjoitus muuttui toisessa välilehdessä. Peruuta ja avaa se uudelleen ennen poistamista.'); return false; }
      next.routines = next.routines.filter((r) => r.id !== draft.id);
    }, { critical: true });
    if (ok) { clearDraft(); view = 'home'; render(); }
  },
  jump() {
    const index = core.currentExercise(state.session);
    const card = document.getElementById(`exercise-${index}`);
    card?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    card?.querySelector('.set.next, .set')?.focus({ preventScroll: true });
  },
  export() {
    const blob = new Blob([newerSchema ? storage.getItem(core.STORAGE_KEY) : JSON.stringify(core.buildBackup(state), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = core.backupFileName(); a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    announce('Varmuuskopio ladattu. Säilytä se turvallisessa paikassa.');
  },
  import() { importMode = 'merge'; $file.click(); },
  restore() { importMode = 'replace'; $file.click(); },
};

const $file = document.getElementById('import-file');
function importDone(message) { importMessage = message; render(); announce(message); }
$file.addEventListener('change', async () => {
  const file = $file.files[0], mode = importMode;
  $file.value = '';
  if (!file) return;
  if (file.size > core.MAX_BACKUP_BYTES) return importDone('Varmuuskopio on liian suuri (enintään 5 Mt). Mitään ei muutettu.');
  let text;
  try { text = await file.text(); } catch { return importDone('Tiedostoa ei voitu lukea. Mitään ei muutettu.'); }
  const parsed = core.parseBackup(text);
  if (!parsed.ok) return importDone(`${parsed.error} Mitään ei muutettu.`);
  const { routines, history } = parsed.state;
  const counts = `${routines.length} ohjelmaa, ${history.length} harjoitusmerkintää ja ${parsed.state.customExercises.length} omaa liikettä`;
  const when = parsed.meta.exportedAt ? ` (${new Date(parsed.meta.exportedAt).toLocaleDateString('fi-FI')})` : '';
  const question = mode === 'replace'
    ? `Korvataanko ohjelmat, historia, omat liikkeet ja asetukset varmuuskopiolla${when}: ${counts}? Vie nykyiset tiedot ensin varmuuskopioksi, jos haluat säilyttää ne.`
    : `Yhdistetäänkö varmuuskopio${when} nykyisiin tietoihin: ${counts}?`;
  if (!confirm(question)) return importDone('Tuonti peruttu. Mitään ei muutettu.');
  let result = null;
  const ok = await mutate((next) => {
    const merged = mode === 'replace' ? core.replaceState(next, parsed.state) : core.mergeState(next, parsed.state);
    Object.assign(next, merged.state); result = merged.result;
  }, { critical: true });
  if (!ok || !result) return importDone('Varmuuskopiota ei voitu tallentaa. Mitään ei muutettu.');
  const extra = result.skipped ? ` ${result.skipped} ohjelmaa ohitettiin, koska 100 ohjelman raja täyttyi.` : '';
  importDone(mode === 'replace'
    ? `Palautettu ${result.routines} ohjelmaa ja ${result.history} harjoitusmerkintää. Omat liikkeet palautettu.${result.session ? ' Myös keskeneräinen harjoitus palautettiin.' : ''}`
    : `Lisätty ${result.routines} ohjelmaa ja ${result.history} harjoitusmerkintää. Omat liikkeet yhdistetty.${result.session ? ' Myös keskeneräinen harjoitus palautettiin.' : ''}${extra}`);
});

function enqueueAction(work) {
  pendingActions++;
  $app.setAttribute('aria-busy', 'true');
  actionQueue = actionQueue.then(work).catch(() => {
    announce('Muutosta ei voitu tehdä. Yritä uudelleen.');
  }).finally(() => {
    pendingActions--;
    $app.setAttribute('aria-busy', String(pendingActions > 0));
  });
}
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action]');
  if (!t || t.disabled || !Object.hasOwn(actions, t.dataset.action) || t.tagName === 'INPUT') return;
  e.preventDefault(); enqueueAction(() => actions[t.dataset.action](t));
});
document.addEventListener('submit', (e) => {
  if (e.target.id !== 'custom-exercise-form') return;
  e.preventDefault(); enqueueAction(() => actions.createcustom());
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'exercise-search') { picker.query = t.value; picker.limit = 40; updateLibraryResults(); return; }
  if (t.dataset.custom && draft) { customEntry()[t.dataset.custom] = t.value; rememberDraft(); return; }
  if (!t.dataset.f || !draft) return;
  if (t.dataset.f === 'rname') draft.name = t.value;
  else if (['name', 'sets', 'reps', 'weight'].includes(t.dataset.f)) draft.exercises[+t.dataset.i][t.dataset.f] = t.value;
  rememberDraft();
});
document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.type === 'radio' && t.checked && (t.dataset.filter || t.dataset.custom)) {
    const menu = t.closest('.choice-menu');
    menu.querySelector(`#${menu.id}-value`).textContent = t.nextElementSibling.textContent;
    menu.open = false; menu.querySelector('summary').focus({ preventScroll: true });
    if (t.dataset.filter) { picker[t.dataset.filter] = t.value; picker.limit = 40; updateLibraryResults(); }
  }
  if (t.id === 'library-own') { picker.customOnly = t.checked; picker.limit = 40; updateLibraryResults(); }
  if (t.dataset.action === 'autorest') {
    const checked = t.checked;
    await mutate((next) => { next.settings.autoRest = checked; if (!checked) next.restEnd = null; });
  }
  if (t.dataset.action === 'restsecs') {
    const seconds = core.clampInt(t.value, 10, 600, 90);
    await mutate((next) => { next.settings.restSeconds = seconds; });
  }
});
document.addEventListener('toggle', (e) => {
  if (e.target.matches('.settings')) settingsOpen = e.target.open;
  if (e.target.matches('.custom-exercise')) customOpen = e.target.open;
}, true);
window.addEventListener('storage', (e) => {
  if (e.key !== core.STORAGE_KEY && e.key !== null) return;
  if (!dirty) {
    readLatest();
    // Avoid replacing a focused editor input while someone is typing.
    if (view !== 'edit' || newerSchema) render();
  } else announce('Toinen välilehti muutti tallennettua harjoitusta. Pidä tämä välilehti auki, kunnes muutokset ovat tallessa.');
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { readLatest(); if (view !== 'edit') render(); }
  tick(); syncWakeLock();
});
window.addEventListener('pageshow', (e) => { if (e.persisted) { readLatest(); render(); } });
for (const event of ['online', 'offline']) window.addEventListener(event, () => {
  const status = document.getElementById('connection'); if (status) status.textContent = connectionText();
});
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then((registration) => {
    navigator.serviceWorker.ready.then(() => { offlineReady = true; const status = document.getElementById('connection'); if (status) status.textContent = connectionText(); });
    const update = () => { updateReady = !!registration.waiting; };
    update(); registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', update));
  }).catch(() => { /* No offline promise when registration is denied. */ });
}
render();
