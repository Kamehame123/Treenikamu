import * as core from './core.js';
import * as autobackup from './autobackup.js';
import { progressionConfig, progressionRange, prescription, reviseRoutine, undoRevision, canUndoRevision } from './progression.js';

import { EXERCISES, CATEGORIES, EQUIPMENT, findExercises, normalizeSearch } from './exercises.js';
import { pickCheer, pickRecordCheer } from './cheers.js';
import { createMonitor, hrSupported, emptyHr, addHrSample, summarizeHr } from './heartrate.js';
import { buildStatistics, configureIndex, libraryTracking, localDateKey, shiftDays, sanitizeTracking, LOAD_TYPES } from './statistics.js';
import { escapeHtml as esc, statisticsView, recordsView, trackingEditor, historySets } from './statistics-ui.js';
import { TIMER_MAX_INTERVALS, TIMER_MAX_SEQUENCES, TIMER_PRESETS, defaultTimerName, buildTimer, newInterval, draftFrom, phaseAt, runElapsed, sanitizeRun, intervalLabel, intervalSeconds, presetKind, presetSeconds, totalSeconds, formatClock, formatLength } from './timer.js';
import { MAX_WODS, MAX_MOVEMENTS, WOD_FORMATS, FORMAT_LABELS, FORMAT_HELP, SCORE_LABELS, FORMAT_SCORES, DIVISIONS, parseScheme, wodPartLabel, wodTitle, resultFields, buildResult, resultLabel, isPersonalRecord, clockFace, startClock, pauseClock, resumeClock, settleClock, stopClock, addLap, undoLap } from './wod.js';
import { BLOCK_KINDS, WOD_TEXT_FIELDS, editorMovement, newEditorWod, switchFormat, newBlock, normalizeFunctionalDraft, typeChoices, wodGuide, blockSection, wodEditor, paintWodEditor, templateGallery, gymProgramGallery, isTemplateGroup, isSex, sessionBlock, sessionWodCard, clockScreen, clockParts, clockStatus, isFunctionalRoutine, routineWodPills, routineLastResults, historyWork, historyWods, historyWodEditor } from './wod-ui.js';
import { gymProgramById, gymProgramRoutine } from './gym-programs.js';
import { TEMPLATES, TEMPLATE_GROUPS, SEXES, templateById, templateRoutine } from './wod-templates.js';

// Views restore their own position; browser reload restoration must not undo it.
history.scrollRestoration = 'manual';
const $app = document.getElementById('app');
const $live = document.getElementById('live');
const DRAFT_KEY = 'gym-tracker-draft-v1';
const BACKUP_KEY = 'gym-tracker-last-backup';
const BACKUP_REMIND_DAYS = 7;
const clone = (x) => JSON.parse(JSON.stringify(x));
const blankEx = () => ({ id: core.uid(), name: '', sets: 3, reps: '10', weight: '', setReps: null });
const paths = {
  arrow: 'M5 12h14m-6-6 6 6-6 6', back: 'm14 6-6 6 6 6',
  plus: 'M12 5v14M5 12h14', minus: 'M5 12h14', check: 'm5 12 4 4L19 6',
  clock: 'M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  weight: 'M7 9h10M7 15h10M7 6v12M4 9v6M17 6v12M20 9v6',
  shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3m-4 9 3 3 5-6',
  settings: 'M4 7h16M4 17h16M8 4v6M16 14v6',
  edit: 'm15 5 4 4M5 15l10-10a3 3 0 0 1 4 4L9 19l-5 1 1-5',
  play: 'M8 5v14l11-7z',
  pause: 'M8 5h3v14H8zM13 5h3v14h-3z',
  stop: 'M6 6h12v12H6z',
  stopwatch: 'M9.5 2.5h5M12 2.5V6M12 10v3.5l2.5 1.5M19.5 13.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0M18.5 6.5l1.5-1.5',
  heart: 'M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  feather: 'M20 4c-9 0-14 5-14 11v5M6 20 15 11M20 4c0 7-4 11-10 11',
  flame: 'M12 3c.5 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2.5-4.5 0 1.5.5 2.5 1.5 3 0-3 0-5 1-8.5z',
  board: 'M4 4h16v11H4zM8 8h8M8 11h5M9 15l-2 5M15 15l2 5',
};
const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.weight}"/></svg>`;
let announceId;
let appearanceMessage = '';
const APPEARANCE_FAILED = 'Ulkoasua ei voitu tallentaa pysyvästi. Valinta on käytössä vain tässä välilehdessä.';
// The appearance choice is a per-device preference kept by appearance.js, never part of the training data or backups.
function appearanceNote() { return window.TrackerAppearance?.saved === false ? APPEARANCE_FAILED : appearanceMessage; }
function appearanceSection() {
  const api = window.TrackerAppearance;
  const current = api?.theme ?? 'dark';
  const option = (value, glyph, name, note) => `<label class="appearance-option">${icon(glyph)}<span class="appearance-text">${name}<small>${note}</small></span><input type="radio" name="appearance" value="${value}" data-appearance="${value}" data-key="appearance-${value}" ${current === value ? 'checked' : ''} ${api ? '' : 'disabled'}></label>`;
  return `<fieldset class="appearance"><legend>Ulkoasu</legend><div class="appearance-options">${option('dark', 'moon', 'Dark mode', 'Oletus')}${option('aurora', 'sun', 'Aurora', 'Vaalea ja värikäs')}</div><p class="small-copy muted appearance-status" id="appearance-status" role="status">${esc(appearanceNote())}</p></fieldset>`;
}
// Updates the selector in place; changing the look must never rebuild the screen or touch saved data.
function paintAppearance() {
  const api = window.TrackerAppearance;
  if (!api) return;
  for (const radio of document.querySelectorAll('input[name="appearance"]')) radio.checked = radio.value === api.theme;
  const status = document.getElementById('appearance-status');
  if (status) status.textContent = appearanceNote();
}
window.addEventListener('appearancechange', paintAppearance);
function announce(text) {
  clearTimeout(announceId); $live.textContent = '';
  announceId = setTimeout(() => { $live.textContent = text; }, 40);
}
// Native confirm() titles the dialog with the page origin (the GitHub Pages host), so ask in-app instead.
function askConfirm(message, accept = 'Vahvista') {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'confirm';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-labelledby', 'confirm-title');
    dialog.setAttribute('aria-describedby', 'confirm-text');
    dialog.innerHTML = `<h2 id="confirm-title">Treenipäiväkirja</h2><p id="confirm-text">${esc(message)}</p><div class="confirm-actions"><button class="btn" value="cancel" autofocus>Peruuta</button><button class="btn primary" value="ok">${esc(accept)}</button></div>`;
    dialog.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) dialog.close(b.value); });
    dialog.addEventListener('close', () => { dialog.remove(); resolve(dialog.returnValue === 'ok'); });
    document.body.append(dialog);
    dialog.showModal();
  });
}
const CHANGED_ELSEWHERE = 'Tilanne muuttui toisessa välilehdessä. Näkymä on päivitetty. Yritä uudelleen.';
let storage = null;
let storageOk = true;
let durableRaw = null;
try { storage = window.localStorage; durableRaw = storage.getItem(core.STORAGE_KEY); } catch { storageOk = false; }
let state = core.loadState(storage);
let newerSchema = false;
let unreadable = false;
const locked = () => newerSchema || unreadable;
function checkProblem(raw) {
  const problem = core.storageProblem(raw);
  newerSchema = problem === 'newer'; unreadable = problem === 'unreadable';
  return problem !== null;
}
if (checkProblem(durableRaw)) storageOk = false;
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
    if (draft.type === 'functional') normalizeFunctionalDraft(draft);
  }
} catch { /* Session storage is optional; the workout still works. */ }
// A running interval timer survives a reload (sessionStorage); saved sequences live in state.timers.
const TIMER_RUN_KEY = 'gym-tracker-timer-run-v1';
let timerRun = null;
try { timerRun = sanitizeRun(JSON.parse(sessionStorage.getItem(TIMER_RUN_KEY)), state.timers ?? []); } catch { /* A timer run is optional. */ }
// A running WOD clock lives in the saved workout, so its screen comes back after a reload.
// wodCue is the last cue played ("wodId|cue"); null means a restored clock, which stays silent until its next change.
const runningClock = (s = state.session) => s?.wods?.find((w) => w.clock && !w.clock.endedAt) ?? null;
let clockWodId = runningClock()?.id ?? null;
let wodCue = null;
let clockSettling = false;
let view = draft ? 'edit' : timerRun ? 'timer' : clockWodId ? 'wod' : state.session ? 'workout' : 'home';
const HOME_PERIODS = ['week', 'month', 'year'];
const HOME_PERIOD_KEY = 'gym-tracker-home-period';
let homePeriod = 'week';
try { const saved = localStorage.getItem(HOME_PERIOD_KEY); if (HOME_PERIODS.includes(saved)) homePeriod = saved; } catch { /* Defaults to week. */ }
// "Aloita mallista": the chosen group lasts for the visit; the load choice is a per-device preference.
const TEMPLATE_SEX_KEY = 'gym-tracker-template-loads';
let galleryGroup = 'format';
let templateSex = 'women';
try { const saved = localStorage.getItem(TEMPLATE_SEX_KEY); if (isSex(saved)) templateSex = saved; } catch { /* Defaults to women's loads. */ }
let renderedView;
let editError = '';
let settingsOpen = false;
let backupOpen = false;
const statisticsFilters = { range: '12w', from: localDateKey(shiftDays(Date.now(), -83)), to: localDateKey(Date.now()), routineId: '', exerciseKey: '', page: 0 };
// Interval timer editor draft and cue state: in memory only. null cue = a restored run, which must not beep on reload.
let timerDraft = null;
let timerError = '';
let timerCue = null;
let audioContext = null;
// mode 'draft' picks for the program editor; mode 'session' swaps or adds an exercise in the active workout only.
let picker = { query: '', category: '', equipment: '', customOnly: false, limit: 40, target: null, adding: true, keepOpen: false, added: [], mode: 'draft' };
let customError = '';
let customOpen = false;
let sessionCustom = null;
const newCustomEntry = () => ({ name: '', category: 'Koko keho', equipment: 'Muu väline', reps: '10' });
const customEntry = () => picker.mode === 'session' ? sessionCustom ??= newCustomEntry() : draft.customEntry ??= newCustomEntry();
let importMessage = '';
let historyLimit = 10;
let historyEditing = null;
let historyMessage = '';
let lastDeleted = null;
let savedId = null;
let shareMessage = '';
let importMode = 'merge';
let offlineReady = false;
let updateReady = false;
let updateRegistration = null;
let updateDismissed = false;
let updateBusy = false;
let updateError = '';
let updateCheck = null;
let updateTimer;
let offeredWorker = null;
let releaseNotes = [];
let buildNumber = '';
let reloadPending = false;
let wakeLock = null;
let wakePending = false;
let pendingActions = 0;
let actionQueue = Promise.resolve();
const revisionMessages = new Map();
const openLogs = new Set();
const openExerciseActions = new Set();
const openRoutines = new Set();
// Functional editor disclosures (scaled versions by movement id, and the class-structure guide) survive redraws.
const openScaled = new Set();
let guideOpen = false;
let logError = '';
const byId = (id, source = state) => source.routines.find((r) => r.id === id);

// Heart rate: the connection and the running totals live outside the saved state. Only the finished
// workout's average/maximum is saved. Totals survive a reload through sessionStorage.
const HR_KEY = 'gym-tracker-hr-v1';
const HR_DEVICE_KEY = 'gym-tracker-hr-device';
let hrAcc = emptyHr();
try {
  const saved = JSON.parse(sessionStorage.getItem(HR_KEY));
  if (saved && typeof saved.id === 'string' && Number.isFinite(saved.sum) && Number.isInteger(saved.n) && Number.isInteger(saved.max) && saved.n >= 0) hrAcc = { id: saved.id, sum: saved.sum, n: saved.n, max: saved.max };
} catch { /* Heart rate totals are optional. */ }
let hrSavedAt = 0;
function persistHr(force = false) {
  if (!force && Date.now() - hrSavedAt < 10000) return;
  hrSavedAt = Date.now();
  try { sessionStorage.setItem(HR_KEY, JSON.stringify(hrAcc)); } catch { /* Optional. */ }
}
function resetHr() { hrAcc = emptyHr(); persistHr(true); }
function recordHr(bpm) {
  const id = state.session?.id;
  if (!id) return;
  if (hrAcc.id !== id) hrAcc = emptyHr(id);
  hrAcc = addHrSample(hrAcc, bpm);
  persistHr();
}
function onHrChange(info) {
  const text = { connected: `Sykemittari yhdistetty: ${info.name}.`, reconnecting: 'Sykemittarin yhteys katkesi. Yritetään yhdistää uudelleen.', error: info.error }[info.status];
  if (text) announce(text);
  const hadFocus = document.activeElement?.dataset?.key?.startsWith('hr');
  if (view === 'home' || view === 'workout') render();
  if (hadFocus) document.querySelector('[data-key="hrconnect"], [data-key="hrdisconnect"]')?.focus({ preventScroll: true });
}
const hr = createMonitor({
  onChange: onHrChange,
  onSample: (bpm) => { recordHr(bpm); paintHr(); },
  remember: (id) => { try { localStorage.setItem(HR_DEVICE_KEY, id); } catch { /* Optional. */ } },
  recall: () => { try { return localStorage.getItem(HR_DEVICE_KEY); } catch { return null; } },
});
function paintHr() {
  const bpm = hr.current();
  for (const id of ['hr-value', 'hr-live']) {
    const el = document.getElementById(id);
    const text = bpm === null ? '--' : String(bpm);
    if (el && el.textContent !== text) el.textContent = text;
  }
}
function hrBadge() {
  if (!['connected', 'reconnecting'].includes(hr.info.status)) return '';
  return `<span class="session-hr${hr.info.status === 'reconnecting' ? ' lost' : ''}">${icon('heart')} <span id="hr-value">${hr.current() ?? '--'}</span> <small>bpm</small></span>`;
}
function hrSettings() {
  const { status, name, error } = hr.info;
  let text, button = '';
  if (!hrSupported()) text = 'Selaimesi ei tue Bluetooth-sykemittareita. Käytä Chromea tai Edgeä Androidilla, Windowsilla tai Macilla. iPhonessa ei ole tukea.';
  else if (status === 'connecting') { text = 'Yhdistetään sykemittariin…'; button = '<button class="btn secondary" data-action="hrdisconnect" data-key="hrdisconnect">Peruuta</button>'; }
  else if (status === 'connected') { text = `Yhdistetty: ${esc(name)} · <strong id="hr-live">${hr.current() ?? '--'}</strong> bpm`; button = '<button class="btn secondary" data-action="hrdisconnect" data-key="hrdisconnect">Katkaise yhteys</button>'; }
  else if (status === 'reconnecting') { text = 'Yhteys katkesi. Yritetään yhdistää uudelleen…'; button = '<button class="btn secondary" data-action="hrdisconnect" data-key="hrdisconnect">Katkaise yhteys</button>'; }
  else {
    text = status === 'error' ? esc(error) : 'Yhdistä Polar H10 tai muu Bluetooth-sykemittari ennen harjoituksen aloitusta. Syke näkyy harjoituksen aikana kellon vieressä, ja keskiarvo sekä huippu tallentuvat harjoitukseen.';
    button = '<button class="btn secondary" data-action="hrconnect" data-key="hrconnect">Yhdistä sykemittari</button>';
  }
  return `<section class="hr-setting" aria-label="Sykemittari"><div class="hr-text"><strong>Sykemittari</strong><p class="small-copy muted" id="hr-status">${text}</p></div>${button}</section>`;
}
const hrText = (h) => h.hr ? ` · syke keskim. ${h.hr.avg}, enint. ${h.hr.max} bpm` : '';

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
    if (checkProblem(saved)) { storageOk = false; durableRaw = saved; return; }
    if (saved) state = core.sanitizeState(JSON.parse(saved));
    else if (durableRaw !== null) state = core.defaultState();
    durableRaw = saved;
  } catch { storageOk = false; }
}

// Every write reads the latest durable state while holding an origin-wide lock.
// Never save stale state on pagehide: every actual mutation is saved immediately.
// `patch` lets a successful save update the DOM in place instead of rebuilding the view,
// so a field being typed in keeps focus (and the mobile keyboard stays open).
async function mutate(change, { critical = false, sessionId = null, patch = null } = {}) {
  if (updateBusy) { announce('Päivitys on käynnissä. Odota sovelluksen avautumista uudelleen.'); return false; }
  const work = async () => {
    try { checkProblem(storage?.getItem(core.STORAGE_KEY)); } catch { /* Storage denial is handled below. */ }
    if (locked()) { storageOk = false; render(); return false; }
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
    const result = core.saveStateResult(storage, next);
    const saved = result.ok;
    const wasHealthy = storageOk && !saveMessage;
    storageOk = saved;
    if (saved) { durableRaw = JSON.stringify(next); saveConflict = false; }
    saveMessage = saved ? ''
      : result.quota ? 'Selaimen tallennustila on täynnä, joten muutosta ei voitu tallentaa. Muutokset ovat vain tässä välilehdessä. Vie varmuuskopio nyt ja vapauta tilaa (esimerkiksi poista vanhoja harjoituksia varmuuskopion jälkeen). Älä sulje välilehteä ennen kuin tallennus onnistuu.'
      : critical ? 'Muutosta ei voitu tallentaa. Harjoitus on yhä tallessa tässä välilehdessä. Yritä uudelleen ennen sulkemista.' : 'Muutokset ovat vain tässä välilehdessä. Tallennus ei onnistu. Älä sulje välilehteä ennen tallentamista.';
    if (saved || !critical) { state = next; dirty = !saved; }
    if (saved && state.history.length) requestPersistence();
    if (saved) { autoBackup.pending = true; scheduleAutoBackup(); }
    if (patch && saved && wasHealthy && view === renderedView) patch(); else render();
    return saved || !critical;
  };
  return navigator.locks ? navigator.locks.request(`${core.STORAGE_KEY}:write`, work) : work();
}

const warn = () => {
  if (storageOk) return '';
  const title = newerSchema ? 'Päivitä sovellus' : unreadable ? 'Tallennettuja tietoja ei voitu lukea' : 'Tallennus vaatii huomiota';
  const text = newerSchema ? 'Tiedot on tallennettu uudemmalla sovelluksella. Tämä versio ei muuta niitä. Sulje sovelluksen välilehdet, yhdistä verkkoon ja avaa uudelleen. Voit viedä alkuperäiset tiedot talteen.'
    : unreadable ? 'Selaimeen tallennetut tiedot ovat vioittuneet. Niitä ei ole poistettu eikä korvattu, eikä mitään tallenneta ennen kuin valitset jatkotoimen. Vie alkuperäiset tiedot ensin talteen. "Aloita tyhjästä" siirtää vioittuneet tiedot erilliseen säilytyspaikkaan selaimessa ja aloittaa puhtaalta pöydältä.'
    : saveMessage || 'Tallennus ei ole käytettävissä. Muutokset katoavat, jos suljet välilehden.';
  const actions = locked()
    ? `<button class="btn small" data-action="export" data-key="export-pending">Vie alkuperäiset tiedot</button>${unreadable ? '<button class="btn small" data-action="resetunreadable" data-key="resetunreadable">Aloita tyhjästä</button>' : ''}`
    : `<button class="btn small" data-action="retry" data-key="retry">Yritä tallentaa uudelleen</button><button class="btn small" data-action="export" data-key="export-pending">Vie tallentamattomat muutokset</button>${saveConflict ? '<button class="btn small" data-action="reloadsaved" data-key="reloadsaved">Lataa tallennettu versio</button>' : ''}`;
  return `<div class="banner" role="alert">${icon('shield')}<div><strong>${title}</strong><p>${esc(text)}</p><div class="recovery-actions">${actions}</div></div></div>`;
};
// Ask the browser not to evict the saved data under storage pressure. Works offline; the answer
// is only shown, never required. Asked once per page load, and only once there is history to protect.
let persisted = null;
let persistAsked = false;
const persistText = () => persisted === true ? 'Selain suojaa tietosi automaattiselta poistolta.'
  : persisted === false ? 'Selain voi poistaa tiedot, jos laitteen tila loppuu. Tee varmuuskopio säännöllisesti.' : '';
async function requestPersistence() {
  if (persistAsked || !navigator.storage?.persist) return;
  persistAsked = true;
  try {
    persisted = (await navigator.storage.persisted?.()) || (await navigator.storage.persist());
  } catch { persisted = null; }
  const el = document.getElementById('persist-status');
  if (el) el.textContent = persistText();
}
const storageNearlyFull = () => (durableRaw?.length ?? 0) > core.STORAGE_WARN_CHARS;
function storageNote() {
  const parts = [persistText()];
  if (storageNearlyFull()) parts.push('Selaimen tallennustila alkaa täyttyä. Vie varmuuskopio ja harkitse vanhimpien harjoitusten poistamista sen jälkeen.');
  return parts.filter(Boolean).join(' ');
}
function lastBackupAt() {
  try { const t = Number(localStorage.getItem(BACKUP_KEY)); return Number.isFinite(t) && t > 0 ? t : 0; } catch { return 0; }
}
// Automatic folder backup. Its settings live in IndexedDB (autobackup.js), never in the training data.
const autoBackup = { supported: autobackup.supported(), enabled: false, handle: null, permission: 'granted', lastAt: 0, error: '', busy: false, pending: false };
let autoTimer = 0;
const autoNeedsGrant = () => autoBackup.enabled && autoBackup.permission !== 'granted';
function autoBackupText() {
  const ab = autoBackup;
  if (!ab.supported) return 'Tämä selain ei voi tallentaa kansioon (esimerkiksi iPhone). Käytä "Vie varmuuskopio" -painiketta. Toimii tietokoneen Chromessa ja Edgessä sekä uusimmassa Androidin Chromessa.';
  if (!ab.enabled && ab.error) return ab.error;
  if (!ab.enabled) return `Tallentaa tiedot itsestään valitsemaasi kansioon, kun sovellus on auki: viimeisin kopio sekä yksi kopio päivässä (${autobackup.KEEP_DAYS} viimeisintä päivää). Kopiot pysyvät vain tällä laitteella.`;
  const where = `Kansio: ${ab.handle?.name ?? ''}.`;
  if (ab.error) return `${where} ${ab.error}`;
  if (ab.permission !== 'granted') return `${where} Selain tarvitsee luvan kansioon. Paina "Anna lupa kansioon".`;
  if (ab.lastAt) return `${where} Viimeisin kopio: ${new Date(ab.lastAt).toLocaleString('fi-FI', { dateStyle: 'short', timeStyle: 'short' })}.`;
  return `${where} ${state.history.length ? 'Ensimmäinen kopio tehdään pian.' : 'Kopio tehdään, kun ensimmäinen harjoitus on kirjattu.'}`;
}
function autoBackupHtml() {
  const ab = autoBackup;
  const grant = ab.permission !== 'granted' ? '<button class="btn secondary" data-action="autobackupgrant" data-key="autobackup-grant">Anna lupa kansioon</button>' : '';
  const buttons = ab.enabled ? `<div class="settings-actions">${grant}<button class="btn secondary" data-action="autobackupfolder" data-key="autobackup-folder">Vaihda kansio</button></div>` : '';
  return `<label class="check"><span>Automaattinen varmuuskopio kansioon<small id="autobackup-status">${esc(autoBackupText())}</small></span><input type="checkbox" role="switch" data-autobackup="toggle" data-key="autobackup" ${ab.enabled ? 'checked' : ''} ${ab.supported ? '' : 'disabled'} aria-label="Automaattinen varmuuskopio kansioon"></label>${buttons}`;
}
// Updates in place so a focused control and the open settings survive.
function paintAutoBackup() {
  const box = document.getElementById('autobackup');
  if (!box) return;
  const focus = box.contains(document.activeElement) ? document.activeElement.dataset.key : null;
  box.innerHTML = autoBackupHtml();
  if (focus) (box.querySelector(`[data-key="${focus}"]`) ?? box.querySelector('input'))?.focus({ preventScroll: true });
}
function autoBackupError(error) {
  if (error?.name === 'NotFoundError') return 'Kansiota ei löydy. Valitse kansio uudelleen.';
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return 'Selaimella ei ole lupaa kansioon.';
  if (error?.name === 'QuotaExceededError') return 'Levy on täynnä, kopiota ei voitu kirjoittaa.';
  return 'Kopiota ei voitu kirjoittaa kansioon.';
}
async function writeAutoBackup() {
  const ab = autoBackup;
  readLatest();
  if (locked() || !storageOk || dirty) { ab.pending = true; return; }
  // An empty state must never replace the latest copy.
  if (!state.history.length) return;
  const text = JSON.stringify(core.buildBackup(state), null, 2);
  try {
    await autobackup.writeBackup(ab.handle, text, localDateKey(Date.now()), (copy) => copy === text && core.parseBackup(copy).ok);
    ab.lastAt = Date.now(); ab.error = '';
    autobackup.saveConfig({ handle: ab.handle, enabled: true, lastAt: ab.lastAt }).catch(() => { /* The time is only shown. */ });
  } catch (error) {
    ab.pending = true; ab.error = autoBackupError(error);
    ab.permission = await autobackup.permission(ab.handle);
  }
}
// Failures here never block or delay saving the training data.
async function runAutoBackup() {
  const ab = autoBackup;
  if (!ab.enabled || !ab.handle || ab.busy) return;
  if (locked() || !storageOk || dirty || saveConflict) return;
  ab.busy = true; ab.pending = false;
  try {
    ab.permission = await autobackup.permission(ab.handle);
    if (ab.permission !== 'granted') { ab.pending = true; return; }
    await (navigator.locks ? navigator.locks.request('gym-tracker-autobackup', { ifAvailable: true }, (lock) => lock && writeAutoBackup()) : writeAutoBackup());
  } catch { ab.pending = true; } finally { ab.busy = false; paintAutoBackup(); }
}
function scheduleAutoBackup(delay = 10000) {
  if (!autoBackup.enabled) return;
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => void runAutoBackup(), delay);
}
const autoBackupDue = () => autoBackup.enabled && (autoBackup.pending || !autoBackup.lastAt || localDateKey(autoBackup.lastAt) !== localDateKey(Date.now()));
// Needs a user gesture: call before the first await.
async function chooseAutoFolder() {
  const ab = autoBackup;
  let handle;
  try { handle = await autobackup.pickFolder(); } catch (error) {
    if (error?.name === 'AbortError') { if (!ab.enabled) ab.error = 'Kansiota ei otettu käyttöön. Jos valitsit kansion, selain ei saanut lupaa tallentaa siihen: valitse kansio uudelleen ja vastaa selaimen kysymykseen Muokkaa tiedostoja / Salli. Käytä Chromea tai Edgeä.'; }
    else if (error?.name === 'SecurityError') ab.error = 'Selain ei salli tätä kansiota (esimerkiksi Asiakirjat, Lataukset, Työpöytä tai kotikansio). Luo uusi tyhjä alikansio ja valitse se.';
    else ab.error = `Kansion valinta ei onnistunut (${error?.name || 'tuntematon virhe'}).`;
    paintAutoBackup(); return;
  }
  try { await autobackup.saveConfig({ handle, enabled: true, lastAt: 0 }); } catch (error) {
    ab.error = `Valintaa ei voitu tallentaa tälle selaimelle (${error?.name || 'tuntematon virhe'}). Yksityisessä ikkunassa kansiota ei voi muistaa.`; paintAutoBackup(); return;
  }
  Object.assign(ab, { handle, enabled: true, permission: 'granted', error: '', lastAt: 0, pending: true });
  paintAutoBackup();
  announce(`Automaattinen varmuuskopio on päällä kansioon ${handle.name}.`);
  void runAutoBackup();
}
async function disableAutoBackup() {
  const ab = autoBackup;
  clearTimeout(autoTimer);
  try { await autobackup.clearConfig(); } catch { ab.error = 'Asetusta ei voitu tallentaa. Yritä uudelleen.'; paintAutoBackup(); return; }
  Object.assign(ab, { enabled: false, handle: null, error: '', pending: false, permission: 'granted' });
  paintAutoBackup();
  announce('Automaattinen varmuuskopio on pois päältä. Kansion tiedostot jätettiin paikalleen.');
}
function backupInfo() {
  const last = lastBackupAt();
  const days = last ? Math.max(0, Math.floor((Date.now() - last) / 86400000)) : null;
  const newest = Math.max(last, autoBackup.enabled ? autoBackup.lastAt : 0);
  const newestDays = newest ? Math.max(0, Math.floor((Date.now() - newest) / 86400000)) : null;
  const due = state.history.length > 0 && (newestDays === null || newestDays >= BACKUP_REMIND_DAYS);
  const status = days === null ? 'Et ole vielä tehnyt varmuuskopiota.'
    : `Viimeisin varmuuskopio: ${new Date(last).toLocaleDateString('fi-FI')} (${days === 0 ? 'tänään' : days === 1 ? 'eilen' : `${days} päivää sitten`}).`;
  return { due, status };
}
// Backup controls live only in Asetukset; when a backup is due the collapsed Asetukset row shows a small flag.
function backupCompact() {
  const { due, status } = backupInfo();
  const advice = due ? '<p class="backup-status" id="backup-advice">Tietosi ovat vain tällä laitteella ja katoavat, jos selaintiedot tyhjennetään tai sovellus poistetaan.</p>' : '';
  return `<details class="backup-group" ${backupOpen || importMessage ? 'open' : ''}>
    <summary>Varmuuskopio${due ? ' <span class="settings-flag">Tee varmuuskopio</span>' : autoNeedsGrant() ? ' <span class="settings-flag">Anna lupa</span>' : ''}<span class="settings-chevron" aria-hidden="true">⌄</span></summary>
    <section class="backup compact" aria-label="Varmuuskopio">
      <div class="backup-text"><p class="backup-status" id="backup-status">${status}</p>${advice}<p class="backup-status" id="persist-status">${esc(storageNote())}</p></div>
      <div class="autobackup" id="autobackup">${autoBackupHtml()}</div>
      <div class="settings-actions"><button class="btn secondary" data-action="export" data-key="export">Vie varmuuskopio</button><button class="btn secondary" data-action="import" data-key="import">Tuo varmuuskopio</button><button class="btn secondary" data-action="restore" data-key="restore">Palauta varmuuskopio</button></div>
      <p class="muted small-copy">Tuonti yhdistää varmuuskopion nykyisiin tietoihin. Palautus korvaa ne. Keskeneräinen harjoitus säilyy aina.</p>
      ${importMessage ? `<p class="small-copy" id="import-status" role="status">${esc(importMessage)}</p>` : ''}
    </section>
  </details>`;
}
function backupFlag() {
  return backupInfo().due || autoNeedsGrant() ? '<span class="settings-flag">Varmuuskopioi</span>' : '';
}
const progressBar = (p) => `<progress class="progress" max="${Math.max(1, p.total)}" value="${p.done}" aria-label="Harjoituksen edistyminen">${p.pct}%</progress>`;

function brand() {
  return `<header class="brand-row"><a class="brand" href="#" data-action="home" data-key="brand" aria-label="Treenipäiväkirja – etusivu"><span class="brand-mark">${icon('weight')}</span><span>TREENI<span class="brand-light">PÄIVÄKIRJA</span></span></a><span class="status" id="connection">${connectionText()}</span></header>`;
}
function connectionText() { return !navigator.onLine ? 'Ei verkkoyhteyttä' : offlineReady ? 'Toimii myös ilman verkkoa' : 'Tällä laitteella'; }

function renderUpdateNotice() {
  let notice = document.getElementById('update-notice');
  if (!notice) {
    notice = document.createElement('aside');
    notice.id = 'update-notice';
    notice.className = 'update-notice card';
    notice.setAttribute('aria-labelledby', 'update-title');
    $app.after(notice);
  }
  notice.hidden = updateDismissed || (!updateReady && !reloadPending && !updateError && !updateBusy);
  $app.inert = updateBusy;
  if (notice.hidden) return;
  const ready = updateReady || reloadPending;
  // Failed checks must not displace the workout controls.
  if (ready || updateBusy) {
    if (notice.nextElementSibling !== $app) $app.before(notice);
  } else if (notice.previousElementSibling !== $app) $app.after(notice);
  const html = `<h2 id="update-title">${updateBusy ? 'Päivitetään sovellusta…' : ready ? 'Uusi versio saatavilla' : 'Päivityksen tarkistus ei onnistunut'}</h2><p role="status">${esc(updateError || (updateBusy ? 'Odota hetki. Sovellus avautuu uudelleen päivittyneenä.' : 'Päivitä sovellus nyt tai myöhemmin. Tallennettu harjoitus, historia ja muokkausluonnos säilyvät. Jos muita sovelluksen ikkunoita on näkyvissä, sulje ne ennen päivittämistä.'))}</p>${ready && !updateBusy && releaseNotes.length ? `<div class="release-notes"><strong>Muutokset</strong>${releaseNotes.map((n) => `<p class="release-version">Versio ${esc(n.version)}</p><ul>${n.changes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`).join('')}</div>` : ''}<div class="update-actions">${ready ? `<button class="btn primary" data-action="installupdate" data-key="installupdate" ${updateBusy ? 'disabled' : ''}>Päivitä nyt</button>` : '<button class="btn" data-action="checkupdates" data-key="checkupdates">Yritä uudelleen</button>'}<button class="btn" data-action="laterupdate" data-key="laterupdate" ${updateBusy ? 'disabled' : ''}>Myöhemmin</button></div>`;
  if (notice.innerHTML !== html) notice.innerHTML = html;
}

function updateFailed(message) {
  clearTimeout(updateTimer);
  updateBusy = false; updateDismissed = false; updateError = message;
  renderUpdateNotice(); announce(message);
}

function askWorker(worker) {
  return new Promise((resolve) => {
    if (!worker) { resolve(null); return; }
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); resolve(null); }, 2000);
    channel.port1.onmessage = ({ data }) => { clearTimeout(timer); channel.port1.close(); resolve(data); };
    try { worker.postMessage({ type: 'RELEASE_INFO' }, [channel.port2]); } catch { clearTimeout(timer); channel.port1.close(); resolve(null); }
  });
}

// The waiting version carries its own release notes. Show every entry newer than the running version.
async function loadReleaseNotes(worker) {
  const [next, current] = await Promise.all([askWorker(worker), askWorker(navigator.serviceWorker.controller)]);
  if (updateRegistration?.waiting !== worker || !Array.isArray(next?.notes)) return;
  const notes = next.notes.filter((n) => n && Number.isFinite(n.version) && Array.isArray(n.changes) && n.changes.every((c) => typeof c === 'string'));
  const from = Number(current?.version), to = Number(next.version);
  releaseNotes = Number.isFinite(from) && Number.isFinite(to) ? notes.filter((n) => n.version > from && n.version <= to) : notes.slice(0, 1);
  renderUpdateNotice();
}

function syncUpdateState() {
  const registration = updateRegistration;
  if (!registration) { renderUpdateNotice(); return; }
  updateReady = !!registration.waiting && !!navigator.serviceWorker.controller;
  if (updateReady && offeredWorker !== registration.waiting) {
    offeredWorker = registration.waiting; updateDismissed = false; updateError = ''; releaseNotes = [];
    announce('Uusi sovellusversio on saatavilla. Voit päivittää nyt tai myöhemmin.');
    void loadReleaseNotes(offeredWorker);
  }
  renderUpdateNotice();
}

async function checkForUpdates() {
  if (updateBusy || updateCheck || !updateRegistration || !navigator.onLine) return;
  if (updateRegistration.installing && !updateRegistration.active) return;
  updateCheck = updateRegistration.update();
  try { await updateCheck; }
  catch { updateFailed('Uutta versiota ei voitu tarkistaa. Nykyinen sovellus ja tietosi säilyvät. Tarkista verkkoyhteys ja yritä uudelleen.'); }
  finally { updateCheck = null; syncUpdateState(); }
}

async function registerUpdates() {
  if (updateRegistration) { await checkForUpdates(); return; }
  try {
    const registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
    updateRegistration = registration;
    const refresh = syncUpdateState;
    const watch = (worker) => worker?.addEventListener('statechange', () => {
      if (worker.state === 'redundant' && registration.active) updateFailed('Uuden version lataus ei valmistunut. Nykyinen versio ja tietosi säilyvät. Yritä uudelleen verkkoyhteydessä.');
      refresh();
    });
    registration.addEventListener('updatefound', () => watch(registration.installing));
    watch(registration.installing);
    refresh();
    // Reloading is how iOS Chrome users "refresh"; apply an update that was already downloaded.
    if (registration.waiting && navigator.serviceWorker.controller && claimAutoUpdate()) void installUpdate({ auto: true });
    navigator.serviceWorker.ready.then(() => {
      offlineReady = true;
      const status = document.getElementById('connection');
      if (status) status.textContent = connectionText();
      askWorker(navigator.serviceWorker.controller || registration.active).then((info) => {
        if (!info?.version) return;
        buildNumber = String(info.version);
        const el = document.getElementById('build-number');
        if (el) el.textContent = `Versio ${buildNumber}`;
      });
    });
    await checkForUpdates();
  } catch {
    updateFailed('Päivityspalvelua ei voitu käynnistää. Nykyisiä tietoja ei muutettu. Tarkista verkkoyhteys ja selaimen sivusto-oikeudet, ja yritä uudelleen.');
  }
}

// Safe to call twice (controllerchange and the worker's `activated` state both end here).
function reloadForNewVersion() {
  if (reloadPending) return;
  clearTimeout(updateTimer);
  updateBusy = false; reloadPending = true;
  if (dirty || saveConflict || (draft && !draftOk) || pendingActions > 1) {
    updateFailed('Uusi versio on valmis, mutta tässä ikkunassa on tallentamattomia muutoksia. Tallenna ne ennen uudelleenavausta.');
  } else window.location.reload();
}

// A load-time attempt that fails falls back to the normal offer instead of showing an error.
const AUTO_UPDATE_KEY = 'gym-tracker-auto-update';
function claimAutoUpdate() {
  try {
    if (Date.now() - Number(sessionStorage.getItem(AUTO_UPDATE_KEY)) < 60000) return false;
    sessionStorage.setItem(AUTO_UPDATE_KEY, String(Date.now()));
    return true;
  } catch { return false; }
}

async function installUpdate({ auto = false } = {}) {
  const fail = (message) => {
    if (!auto) { updateFailed(message); return; }
    clearTimeout(updateTimer); updateBusy = false; updateError = ''; syncUpdateState();
  };
  if (pendingActions > 1) { fail('Odota keskeneräisten kirjausten tallentumista ja yritä päivittämistä uudelleen.'); return; }
  if (!auto && (dirty || !storageOk) && !locked()) await mutate(() => {}, { critical: true });
  if (dirty || saveConflict || (!storageOk && !locked())) {
    fail('Päivitystä ei aloitettu: kaikkia harjoitustietoja ei ole tallennettu. Käytä tallennuksen palautustoimintoja ja yritä uudelleen.'); return;
  }
  if (draft) rememberDraft();
  if (draft && !draftOk) { fail('Muokkausluonnosta ei voitu tallentaa. Tallenna ohjelma tai korjaa luonnoksen tallennus ennen päivitystä.'); return; }
  if (logError) { fail('Tarkista harjoituksen virheellinen kirjaus ennen päivitystä.'); return; }
  readLatest();
  if (!storageOk && !locked()) { fail('Tallennettua harjoitusta ei voitu lukea. Korjaa tallennuksen tila ennen päivitystä.'); return; }
  if (reloadPending) { window.location.reload(); return; }
  const worker = updateRegistration?.waiting;
  if (!worker) { updateReady = false; fail('Ladattua päivitystä ei enää löytynyt. Tarkista päivitykset uudelleen.'); return; }
  updateError = ''; updateBusy = true; renderUpdateNotice();
  const channel = new MessageChannel();
  updateTimer = setTimeout(() => {
    channel.port1.close();
    fail('Päivitys ei valmistunut ajoissa. Tietojasi ei poistettu. Sulje muut sovelluksen ikkunat ja yritä uudelleen.');
  }, 12000);
  channel.port1.onmessage = ({ data }) => {
    channel.port1.close();
    if (data?.ok) {
      // Some iOS browsers skip `controllerchange`; the worker reaching `activated` is the fallback.
      const activated = () => { if (worker.state === 'activated') reloadForNewVersion(); };
      worker.addEventListener('statechange', activated); activated();
    } else fail(data?.reason === 'other-windows'
      ? 'Sulje muut tämän sovelluksen ikkunat ja selaimen välilehdet. Niiden harjoituksia ei keskeytetty. Yritä sitten uudelleen.'
      : 'Päivitystä ei voitu ottaa käyttöön. Nykyiset tiedot säilyvät. Yritä uudelleen.');
  };
  try { worker.postMessage({ type: 'APPLY_UPDATE' }, [channel.port2]); }
  catch { channel.port1.close(); fail('Päivityspyyntö ei onnistunut. Tarkista päivitykset uudelleen; nykyiset tiedot säilyvät.'); }
}

function progressionControls(r) {
  const active = state.session?.routineId === r.id;
  const revision = r.revision;
  const report = revision ? `<div class="revision-report"><strong>${revision.undone ? 'Tarkistus peruttu – edelliset tavoitteet käytössä' : 'Viimeisin tarkistus'}</strong><ul>${revision.changes.map((change) => `<li><strong>${esc(change.name)}</strong><p>${esc(change.before)}${change.kind !== 'hold' ? ` → ${esc(change.after)}` : ' · ennallaan'}</p><p class="muted">${esc(change.reason)}</p></li>`).join('')}</ul>${canUndoRevision(r) ? `<button class="btn secondary" data-action="undorevision" data-id="${esc(r.id)}" data-key="undo-${esc(r.id)}" ${active ? 'disabled' : ''}>Peru tarkistus</button>` : ''}</div>` : '';
  return `<div class="progression-controls"><div class="progression-row"><button class="btn secondary" data-action="revise" data-id="${esc(r.id)}" data-key="revise-${esc(r.id)}" ${active ? 'disabled' : ''}>Tarkista seuraava treeni</button><label class="check"><span>Auto</span><input type="checkbox" role="switch" data-action="autoprogress" data-id="${esc(r.id)}" data-key="auto-${esc(r.id)}" aria-label="Tarkista automaattisesti: ${esc(r.name)}" ${r.autoProgress ? 'checked' : ''}></label></div>${active ? '<p class="muted small-copy">Keskeneräistä harjoitusta ei muuteta. Tarkista tavoitteet tallennuksen jälkeen.</p>' : ''}${revisionMessages.has(r.id) ? `<p class="small-copy" role="status">${esc(revisionMessages.get(r.id))}</p>` : ''}${report}${coachingGuide()}</div>`;
}

function historyDetails(h) {
  const sets = h.exercises?.length ? `<details class="history-log"><summary>Toteutuneet sarjat: ${esc(h.name)}</summary>${historySets(h)}</details>` : '';
  return `${historyWods(h)}${sets}`;
}

const historyDate = (ts) => new Date(ts).toLocaleDateString('fi-FI', { ...(new Date(ts).getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }), month: 'short', day: 'numeric' });

// Kilograms moved in completed sets whose reps and weight are known; unknown values are skipped, never guessed.
function knownVolume(h) {
  let kg = 0;
  for (const e of h.exercises ?? []) for (const set of e.sets) {
    if (!set.done) continue;
    const reps = core.setRepCount(e, set), weight = core.setWeightValue(e, set);
    if (reps !== null && weight !== null) kg += reps * weight;
  }
  return Math.round(kg);
}

function historyEditor(h) {
  const id = esc(h.id), minutes = h.startedAt ? Math.floor((h.endedAt - h.startedAt) / 60000) : 0;
  const duration = minutes >= 2 ? `<label class="field"><span>Kesto (min)</span><input type="text" inputmode="numeric" value="${minutes}" data-hedit="duration" data-hid="${id}" data-key="hdur-${id}" aria-label="Kesto (min), voi vain lyhentää"></label>` : '';
  const sets = (h.exercises ?? []).map((e, ei) => {
    const loadType = e.tracking?.loadType ?? 'unknown';
    const load = `<details class="choice-menu"><summary data-key="hload-${id}-${ei}">Kuorman merkitys: ${esc(LOAD_TYPES[loadType])}</summary><fieldset><legend>${esc(e.name)}: kuorman merkitys</legend>${Object.entries(LOAD_TYPES).map(([value, label]) => `<label class="choice-option"><input type="radio" name="hload-${id}-${ei}" data-hedit="loadType" data-hid="${id}" data-e="${ei}" data-key="hload-${id}-${ei}-${value}" value="${value}" ${loadType === value ? 'checked' : ''}><span>${esc(label)}</span></label>`).join('')}</fieldset></details>`;
    const confirm = core.historyRepSuggestions(e).length ? `<button class="btn secondary" data-action="confirmhistoryreps" data-id="${id}" data-e="${ei}" data-key="hconfirm-${id}-${ei}">Vahvista tavoitteiden mukaiset toistot</button>` : '';
    return `<fieldset class="history-edit-ex"><legend>${esc(e.name)}</legend>${load}${e.sets.map((set, si) => `<div class="history-edit-set"><label class="check"><span>Sarja ${si + 1}</span><input type="checkbox" data-hedit="done" data-hid="${id}" data-e="${ei}" data-s="${si}" data-key="hd-${ei}-${si}" aria-label="Sarja ${si + 1} tehty: ${esc(e.name)}" ${set.done ? 'checked' : ''}></label><label class="field"><span>Toistot</span><input type="text" inputmode="numeric" value="${esc(set.actualReps ?? '')}" placeholder="${esc(set.reps ?? e.reps ?? '')}" data-hedit="actualReps" data-hid="${id}" data-e="${ei}" data-s="${si}" data-key="hr-${ei}-${si}" aria-label="Toistot: ${esc(e.name)}, sarja ${si + 1}"></label><label class="field"><span>Paino (kg)</span><input type="text" inputmode="decimal" value="${esc(set.actualWeight ?? '')}" placeholder="${esc(e.weight ?? '')}" data-hedit="actualWeight" data-hid="${id}" data-e="${ei}" data-s="${si}" data-key="hw-${ei}-${si}" aria-label="Paino (kg): ${esc(e.name)}, sarja ${si + 1}"></label></div>`).join('')}${confirm}</fieldset>`;
  }).join('');
  return `<div class="history-editor">${duration}${sets}${historyWodEditor(h)}<p class="muted small-copy">Tyhjät toistot ovat tuntemattomia. Tyhjä paino käyttää tallennettua tavoitepainoa. Muutokset tallentuvat heti ja koskevat vain tätä harjoitusta.</p></div>`;
}

function historyItem(h) {
  const id = esc(h.id), editing = historyEditing === h.id;
  return `<li data-hist="${id}"><div class="hist"><span class="history-check">${icon('check')}</span><div class="grow"><h2>${esc(h.name)}</h2><span class="muted">${historyDate(h.endedAt)} · ${core.formatDuration(h.endedAt - h.startedAt)}${h.editedAt ? ' · muokattu' : ''}${hrText(h)}</span></div><span class="history-sets">${h.setsTotal || !h.wods?.length ? `${h.setsDone}<span>/${h.setsTotal} sarjaa</span>` : `${h.wods.filter((w) => w.result).length}<span>/${h.wods.length} WOD</span>`}</span></div>${editing ? historyEditor(h) : historyDetails(h)}<div class="history-actions"><button class="btn small" data-action="edithistory" data-id="${id}" data-key="hedit-${id}" aria-label="${editing ? 'Valmis' : 'Muokkaa'}: ${esc(h.name)}, ${historyDate(h.endedAt)}" aria-expanded="${editing}">${editing ? 'Valmis' : 'Muokkaa'}</button><button class="btn small delete" data-action="delhistory" data-id="${id}" data-key="hdel-${id}" aria-label="Poista: ${esc(h.name)}, ${historyDate(h.endedAt)}">Poista</button></div></li>`;
}

function savedCard() {
  const h = savedId && state.history.find((x) => x.id === savedId);
  if (!h) return '';
  const kg = knownVolume(h);
  return `<section class="card saved-card" aria-label="Tallennettu harjoitus"><span class="eyebrow accent">TALLENNETTU</span><h2>${esc(h.name)}</h2><p class="muted">${historyWork(h)} · ${core.formatDuration(h.endedAt - h.startedAt)}${kg ? ` · ${kg.toLocaleString('fi-FI')} kg nostettu` : ''}${hrText(h)}</p><p class="muted small-copy">${h.wods?.length ? 'Unohditko kirjata sarjan, painon tai WOD-tuloksen? Korjaa tulos nyt.' : 'Unohditko kirjata sarjan tai painon? Korjaa tulos nyt.'}</p><div class="history-actions"><button class="btn small" data-action="fixsaved" data-key="fixsaved">Muokkaa tulosta</button><button class="btn small" data-action="closesaved" data-key="closesaved">Sulje</button></div></section>`;
}

function coachingGuide() {
  return `<details class="coaching-guide card"><summary>Miten tavoitteita tarkistetaan?</summary><div class="small-copy"><p>Yhtä parasta toistoaluetta ei ole. ACSM:n vuoden 2026 katsauksessa raskaammat kuormat tukivat maksimivoimaa ja suurempi viikkovolyymi lihaskasvua. Harjoita suuria lihasryhmiä säännöllisesti, yleensä vähintään kahdesti viikossa. Noin 10 sarjaa lihasryhmää kohti viikossa on hyödyllinen lihaskasvun suunnittelun vertailukohta, ei kaikille pakollinen vähimmäismäärä. Sovellus laskee toistoalueen, kuorman noston tai kevennyksen, sarjamäärän ja lepoajan automaattisesti liikkeen ja toteutuneen suorituksen perusteella.</p><p>Liikkeen tyyppi ja nykyinen tavoite ohjaavat automaattista aluetta: esimerkiksi 3–6 toistoa voimapainotteiseen työhön, 6–12 yhdistettyyn voima-/massaharjoitteluun, 10–20 eristäviin liikkeisiin tai 15–30 pitkille sarjoille. Painoaskel (0,25–5 kg) skaalataan automaattisesti liikkeen ja kuorman mukaan siten, ettei yksittäinen korotus ylitä 10 % kuormasta.</p><p>Ylimääräiset toistot ja lisäsarjat huomioidaan tieteellisesti seuraavassa harjoituksessa: jos teet tavoitetta enemmän toistoja tai lisäsarjoja hyvällä varalla, seuraava toisto- tai sarjatavoite nousee suoraan osoitetun suorituskyvyn mukaan (enintään 5 työsarjaa liikettä kohti roskavolyymin estämiseksi). Jos ylität toistoalueen ylärajan lisätoistoilla tai lisäsarjalla, kuormaa nostetaan heti seuraavaan harjoitukseen ja toistot sovitetaan uuteen painoon.</p><p>Jyrkkä toistojen putoaminen tai kaksi selvää alisuoriutumista keventää seuraavaa harjoituskertaa automaattisesti. Jos palautuminen on heikkoa jo ennen treeniä, avaa ohjelma ja aloita se Kevennetty-painikkeella: treeni kevennetään heti ja ohjelma säilyy ennallaan, eikä kevennetyn treenin tulos muuta tavoitteita. Super-painike lisää jokaiseen liikkeeseen yhden sarjan vain sille treenille. Palautuneena onnistunut kevennys palauttaa aiemmat tavoitteet. Kipua ei käsitellä tavallisena väsymyksenä: lopeta kipua aiheuttava liike ja selvitä oire tarvittaessa ammattilaisen kanssa.</p><p>Lepoajastin valitsee lepoajan automaattisesti liikkeen ja sarjan kuormittavuuden mukaan: raskaissa moninivelliikkeissä 2–3 minuuttia (120–180 s), eristävissä liikkeissä 75–120 s ja keskivartalo- tai liikkuvuusliikkeissä 45–60 s. Uni, riittävä ravinto ja jatkuvuus tukevat kehitystä.</p><p>Tutkimuspohja:</p><ul class="sources"><li><a href="https://acsm.org/resistance-training-guidelines-update-2026/" target="_blank" rel="noopener noreferrer">ACSM 2026</a></li><li><a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC10579494/" target="_blank" rel="noopener noreferrer">Voima- ja hypertrofiaharjoittelun meta-analyysi 2023</a></li><li><a href="https://doi.org/10.47206/ijsc.v1i1.81" target="_blank" rel="noopener noreferrer">IUSCA 2021</a></li><li><a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC10511399/" target="_blank" rel="noopener noreferrer">Kevennyksen asiantuntijakonsensus</a></li></ul></div></details>`;
}

function historyView() {
  const history = state.history.slice(0, historyLimit).map(historyItem).join('');
  const remaining = state.history.length - historyLimit;
  const more = remaining > 0 ? `<button class="btn secondary" data-action="morehistory" data-key="morehistory">Näytä lisää (${remaining} vanhempaa)</button>` : '';
  const undoDelete = lastDeleted ? `<div class="notice" role="status">Harjoitus "${esc(lastDeleted.entry.name)}" poistettiin. <button class="btn small" data-action="undodelete" data-key="undodelete">Peru poisto</button></div>` : '';
  const historyError = historyMessage ? `<div class="banner" role="alert"><div>${esc(historyMessage)}</div></div>` : '';
  return `<div class="stat-heading"><h1 tabindex="-1">Historia</h1><p class="muted">Viimeisimmät harjoitukset. Voit korjata tai poistaa tuloksia.</p><div class="history-links"><button class="btn secondary" data-action="statistics" data-key="statistics-top">Tilastot</button></div></div>${undoDelete}${historyError}${history ? `<ul class="list history-list">${history}</ul>${more}` : `<div class="empty-state">${icon('clock')}<h3>Kehitys alkaa tästä</h3><p>Tallenna ensimmäinen harjoituksesi. Jokainen tehty sarja merkitsee.</p></div>`}`;
}

function timerChrome(back, body) {
  return `${brand()}${warn()}${back}<div class="statistics-content">${body}</div>`;
}

function timerListView(timers) {
  const items = timers.map((t) => {
    const id = esc(t.id);
    const steps = t.intervals.map((i, n) => `<li>${esc(intervalLabel(t, n))} · ${formatLength(i.seconds)}</li>`).join('');
    return `<li class="card timer-item"><div><h2>${esc(t.name)}</h2><p class="muted small-copy">${t.intervals.length} ${t.intervals.length === 1 ? 'intervalli' : 'intervallia'} · ${t.repeats} ${t.repeats === 1 ? 'kierros' : 'kierrosta'} · yhteensä ${formatLength(totalSeconds(t))}</p></div><ol class="timer-steps" aria-label="Intervallit: ${esc(t.name)}">${steps}</ol><div class="timer-item-actions"><button class="btn primary" data-action="timerstart" data-id="${id}" data-key="tstart-${id}" aria-label="Käynnistä: ${esc(t.name)}">${icon('play')} Käynnistä</button><button class="btn small" data-action="timeredit" data-id="${id}" data-key="tedit-${id}" aria-label="Muokkaa: ${esc(t.name)}">Muokkaa</button><button class="btn small delete" data-action="timerdelete" data-id="${id}" data-key="tdel-${id}" aria-label="Poista: ${esc(t.name)}">Poista</button></div></li>`;
  }).join('');
  const empty = `<div class="empty-state">${icon('clock')}<h3>Ei vielä ajastinsarjoja</h3><p>Luo sarja, jossa on intervalleja, selitykset ja kierrosten määrä.</p></div>`;
  const add = timers.length >= TIMER_MAX_SEQUENCES ? '' : `<button class="btn ${timers.length ? 'secondary' : 'primary'}" data-action="timernew" data-key="timernew">${icon('plus')} Uusi sarja</button>`;
  return timerChrome(`<button class="btn ghost back" data-action="home" data-key="timer-back">${icon('back')} Harjoituksiin</button>`,
    `<div class="stat-heading"><h1 tabindex="-1">Ajastin</h1><p class="muted">Intervalliajastin: määritä jaksot selityksineen ja kierrosten määrä.</p></div>${timers.length ? `<ul class="list timer-list">${items}</ul>` : empty}${add}`);
}

function timerEditorView(timers) {
  const d = timerDraft;
  const placeholder = defaultTimerName(timers.filter((t) => t.id !== d.id));
  const intervals = d.intervals.map((i, n) => `<fieldset class="timer-fieldset"><legend>Intervalli ${n + 1}</legend>
    <label class="field">Selitys<input type="text" maxlength="60" placeholder="esim. Juoksu" value="${esc(i.label)}" data-tf="label" data-ti="${n}" data-key="tl-${n}"></label>
    <div class="timer-duration"><label class="field">Minuutit<input type="number" inputmode="numeric" min="0" max="180" step="1" placeholder="0" value="${esc(i.min)}" data-tf="min" data-ti="${n}" data-key="tm-${n}"></label><label class="field">Sekunnit<input type="number" inputmode="numeric" min="0" max="59" step="1" placeholder="0" value="${esc(i.sec)}" data-tf="sec" data-ti="${n}" data-key="ts-${n}"></label></div>
    <div class="timer-fieldset-actions"><button class="btn small delete" data-action="timerdelint" data-i="${n}" data-key="tdelint-${n}" aria-label="Poista intervalli ${n + 1}" ${d.intervals.length < 2 ? 'disabled' : ''}>Poista intervalli</button><button class="btn small timer-default" data-action="timerdefault" data-i="${n}" data-key="tdef-${n}" aria-label="Tee oletus intervalli ${n + 1}" ${presetKind(i.label) ? '' : 'hidden'}>Tee oletus</button></div></fieldset>`).join('');
  const error = timerError ? `<div class="banner" role="alert" id="timer-err" tabindex="-1"><div>${esc(timerError)}</div></div>` : '';
  const full = d.intervals.length >= TIMER_MAX_INTERVALS ? 'disabled' : '';
  const preset = (kind) => `<button class="btn secondary timer-preset" data-action="timeradd${kind}" data-key="timer-${kind}" ${full}>${TIMER_PRESETS[kind].label} <span class="timer-preset-time">${formatClock(presetSeconds(state.timerDefaults, kind) * 1000)}</span></button>`;
  return timerChrome(`<button class="btn ghost back" data-action="timercancel" data-key="timer-cancel-top">${icon('back')} Ajastimiin</button>`,
    `<div class="stat-heading"><h1 tabindex="-1">${d.id ? 'Muokkaa sarjaa' : 'Uusi sarja'}</h1><p class="muted">Intervallit suoritetaan järjestyksessä ja koko sarja toistetaan valitun kierrosmäärän verran.</p></div>
    <div class="card timer-editor"><label class="field">Sarjan nimi<input type="text" maxlength="60" placeholder="${esc(placeholder)}" value="${esc(d.name)}" data-tf="name" data-key="tf-name"><small class="muted">Jos nimeä ei anneta, käytetään nimeä ${esc(placeholder)}.</small></label>
    <label class="field">Kierrosten määrä<input type="number" inputmode="numeric" min="1" max="99" step="1" value="${esc(d.repeats)}" data-tf="repeats" data-key="tf-repeats"></label></div>
    ${intervals}
    <div class="timer-add-row">${preset('work')}<button class="btn secondary" data-action="timeraddint" data-key="timer-add" ${full}>${icon('plus')} Lisää intervalli</button>${preset('rest')}</div>
    ${error}
    <div class="timer-controls"><button class="btn" data-action="timercancel" data-key="timer-cancel">Peruuta</button><button class="btn primary" data-action="timersave" data-key="timer-save">Tallenna sarja</button></div>`);
}

function timerRunSnapshot(timer) {
  const phase = phaseAt(timer, runElapsed(timerRun, Date.now()));
  const hasNext = !phase.done && (phase.index < timer.intervals.length - 1 || phase.round < timer.repeats);
  return {
    phase,
    round: `Kierros ${phase.round}/${timer.repeats}`,
    time: formatClock(phase.remainingMs),
    label: intervalLabel(timer, phase.index),
    step: `(${phase.index + 1}/${timer.intervals.length})`,
    next: hasNext ? `Seuraavaksi - ${intervalLabel(timer, (phase.index + 1) % timer.intervals.length)}` : '',
  };
}

function timerRunView(timer) {
  const snap = timerRunSnapshot(timer);
  const done = snap.phase.done;
  const body = done
    ? `<section class="card timer-card" aria-label="Ajastin valmis"><span class="eyebrow accent">${icon('check')} Valmis</span><p class="timer-label">${timer.repeats} ${timer.repeats === 1 ? 'kierros' : 'kierrosta'} tehty</p><p class="muted">${esc(timer.name)} · yhteensä ${formatLength(totalSeconds(timer))}</p></section>
      <div class="timer-controls"><button class="btn" data-action="timerstop" data-key="timer-close">Sulje</button><button class="btn primary" data-action="timerstart" data-id="${esc(timer.id)}" data-key="timer-again">Aloita alusta</button></div>`
    : `<section class="card timer-card" aria-label="Ajastin käynnissä"><span class="timer-round" id="trun-round">${snap.round}</span><strong class="timer-clock" id="trun-time">${snap.time}</strong><p class="timer-label"><span id="trun-label">${esc(snap.label)}</span> <span class="timer-step" id="trun-step">${snap.step}</span></p><p class="timer-next muted" id="trun-next" ${snap.next ? '' : 'hidden'}>${esc(snap.next)}</p></section>
      <div class="timer-controls timer-run-controls"><button class="btn" data-action="timerstop" data-key="timer-stop">${icon('stop')}Lopeta</button>${timerRun.pausedAt ? `<button class="btn primary" data-action="timerresume" data-key="timer-pause">${icon('play')}Jatka</button>` : `<button class="btn primary" data-action="timerpause" data-key="timer-pause">${icon('pause')}Tauko</button>`}<button class="btn" data-action="timerskip" data-key="timer-skip">${icon('arrow')}Ohita</button></div>`;
  return timerChrome('', `<div class="stat-heading"><h1 tabindex="-1">${esc(timer.name)}</h1></div>${body}`);
}

function timerView() {
  const timers = state.timers ?? [];
  if (timerRun) {
    const timer = timers.find((t) => t.id === timerRun.id);
    if (timer) return timerRunView(timer);
    timerRun = null; rememberTimerRun();
  }
  return timerDraft ? timerEditorView(timers) : timerListView(timers);
}

function rememberTimerRun() {
  try {
    if (timerRun) sessionStorage.setItem(TIMER_RUN_KEY, JSON.stringify({ id: timerRun.id, startedAt: timerRun.startedAt, pausedAt: timerRun.pausedAt, pausedMs: timerRun.pausedMs }));
    else sessionStorage.removeItem(TIMER_RUN_KEY);
  } catch { /* The run still works until the tab closes. */ }
}

// Browsers only allow sound after a tap, so the audio context is created from the start/resume tap.
function prepareAudio() {
  try { audioContext ??= new (window.AudioContext || window.webkitAudioContext)(); void audioContext.resume(); } catch { audioContext = null; }
}
function beep(count, { hz = count > 1 ? 1175 : 880, length = 0.22 } = {}) {
  if (!audioContext) return;
  try {
    const t0 = audioContext.currentTime + 0.02;
    for (let n = 0; n < count; n++) {
      const osc = audioContext.createOscillator(), gain = audioContext.createGain(), at = t0 + n * (length + 0.08);
      osc.frequency.value = hz;
      osc.connect(gain); gain.connect(audioContext.destination);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.4, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
      osc.start(at); osc.stop(at + length + 0.03);
    }
  } catch { /* Vibration and the announcement still happen. */ }
}

// Called every tick: updates the running timer in place and cues each interval change once.
function paintTimer() {
  if (view !== 'timer' || !timerRun) return;
  const timer = (state.timers ?? []).find((t) => t.id === timerRun.id);
  if (!timer) return;
  const snap = timerRunSnapshot(timer);
  if (snap.phase.done !== !!timerRun.done) {
    timerRun.done = snap.phase.done; render();
    return;
  }
  if (!snap.phase.done) {
    for (const [id, value] of [['trun-round', snap.round], ['trun-time', snap.time], ['trun-label', snap.label], ['trun-step', snap.step], ['trun-next', snap.next]]) {
      const el = document.getElementById(id);
      if (el && el.textContent !== value) el.textContent = value;
    }
    const next = document.getElementById('trun-next');
    if (next) next.hidden = !snap.next;
  }
  const key = snap.phase.done ? 'done' : `${snap.phase.round}:${snap.phase.index}`;
  if (timerCue === key) return;
  const restored = timerCue === null;
  timerCue = key;
  if (restored) return;
  if (snap.phase.done) { navigator.vibrate?.([300, 100, 300, 100, 300]); beep(3); announce(`Ajastin valmis. ${timer.repeats} kierrosta tehty.`); }
  else {
    navigator.vibrate?.([200, 100, 200]); beep(1);
    announce(`${snap.round.replace('/', ' / ')}. ${snap.label} ${snap.step.replace('/', ' / ')}, ${formatLength(timer.intervals[snap.phase.index].seconds)}.${snap.next ? ` ${snap.next}.` : ''}`);
  }
}

// WOD clock sounds: short ticks for the last three seconds, a long high tone when work starts,
// a low double tone when rest starts and three tones at the end.
const CLOCK_SOUNDS = {
  tick: () => { navigator.vibrate?.(60); beep(1); },
  go: () => { navigator.vibrate?.([400]); beep(1, { hz: 1175, length: 0.6 }); },
  rest: () => { navigator.vibrate?.([200, 100, 200]); beep(2, { hz: 660 }); },
  done: () => { navigator.vibrate?.([300, 100, 300, 100, 300]); beep(3); },
};

// Called every tick, in every view: updates the clock screen and the WOD card status in place,
// ends a clock whose time is up and cues each change of one clock once.
function paintClock() {
  const wods = state.session?.wods;
  if (!wods) return;
  const now = Date.now(), cued = wods.find((w) => w.id === clockWodId && w.clock && !w.clock.endedAt) ?? runningClock();
  let due = false;
  wods.forEach((w, wi) => {
    if (!w.clock || w.clock.endedAt) return;
    const face = clockFace(w, w.clock, now);
    due ||= face.phase === 'done';
    const mini = document.getElementById(`wc-mini-${wi}`);
    if (mini) { const text = clockStatus(face); if (mini.textContent !== text) mini.textContent = text; }
    if (view === 'wod' && w.id === clockWodId) paintClockScreen(face);
    if (w === cued) cueClock(w, face);
  });
  if (due) settleClocks();
}

function paintClockScreen(face) {
  const parts = clockParts(face);
  for (const [id, value] of [['wc-label', parts.label], ['wc-time', parts.time], ['wc-target', parts.target], ['wc-detail', parts.detail]]) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.textContent !== value) el.textContent = value;
    el.hidden = !value;
  }
  document.getElementById('wc-time')?.classList.toggle('long', face.time.length > 5);
  const card = document.getElementById('wod-clock');
  if (card) { card.dataset.phase = face.phase; card.dataset.segment = face.segment; }
  const idle = String(face.phase !== 'run' || face.paused);
  const lap = document.querySelector('button[data-action="clocklap"]');
  if (lap && lap.getAttribute('aria-disabled') !== idle) lap.setAttribute('aria-disabled', idle);
  const done = document.querySelector('[data-action="clockdone"]'), preroll = String(face.phase === 'preroll');
  if (done && done.getAttribute('aria-disabled') !== preroll) done.setAttribute('aria-disabled', preroll);
}

function cueClock(w, face) {
  const key = `${w.id}|${face.cue}`;
  if (wodCue === key) return;
  const restored = wodCue === null;
  wodCue = key;
  if (restored || face.paused) return;
  if (face.sound) CLOCK_SOUNDS[face.sound]();
  if (face.say) announce(face.say);
}

// Ends every clock whose time is up, at the planned moment. Once at a time, and not while saving is
// blocked: a refused save would otherwise be retried, and the view redrawn, on every tick.
function settleClocks() {
  if (clockSettling || locked() || updateBusy || saveConflict) return;
  clockSettling = true;
  enqueueAction(async () => {
    try {
      const ok = await mutate((next) => {
        let changed = false;
        for (const w of next.session?.wods ?? []) changed = settleClock(w, Date.now()) || changed;
        if (!changed) return false;
      }, sessionOptions());
      if (!ok) render();
      // The running controls are gone; keep keyboard and screen-reader users on the next step.
      else if (view === 'wod' && (!document.activeElement || document.activeElement === document.body)) document.querySelector('[data-key="clocklog"]')?.focus({ preventScroll: true });
    } finally { clockSettling = false; }
  });
}

// The WOD part whose clock screen is open, by index in the workout.
const clockIndex = () => state.session?.wods?.findIndex((w) => w.id === clockWodId) ?? -1;

// Pause or resume the open clock. A clock whose time is already up ends instead.
async function clockChange(change, message) {
  let changed = false;
  await mutate((next) => {
    const w = next.session?.wods?.find((x) => x.id === clockWodId);
    if (!w?.clock) { announce(CHANGED_ELSEWHERE); render(); return false; }
    const now = Date.now();
    if (settleClock(w, now)) return;
    if (!change(w, now)) return false;
    changed = true;
  }, sessionOptions());
  if (changed) announce(message);
}

// "Valmis" (For Time finished) or "Lopeta". Stopping during the pre-roll cancels the clock: nothing was timed yet.
async function endClock(finish) {
  const w = state.session?.wods?.find((x) => x.id === clockWodId);
  if (!w?.clock || w.clock.endedAt) { render(); return; }
  const face = clockFace(w, w.clock, Date.now());
  if (finish && face.phase === 'preroll') { announce('Aika alkaa vasta valmistautumisen jälkeen.'); return; }
  if (!finish && face.phase === 'run' && !await askConfirm('Lopetetaanko kello nyt? Mitattu aika säilyy, ja voit kirjata tuloksen.', 'Lopeta')) return;
  let ended = null, cancelled = false;
  await mutate((next) => {
    const x = next.session?.wods?.find((y) => y.id === clockWodId);
    const outcome = x?.clock ? stopClock(x, Date.now()) : 'none';
    if (outcome === 'none') { render(); return false; }
    cancelled = outcome === 'cancelled';
    if (cancelled) view = 'workout';
    ended = x;
  }, sessionOptions());
  if (!ended) return;
  if (cancelled) {
    announce('Kello peruttu.');
    showCurrentExercise({ wod: state.session.wods.findIndex((x) => x.id === ended.id), focus: true, instant: true });
    return;
  }
  announce(clockFace(ended, ended.clock).say);
  document.querySelector('[data-key="clocklog"]')?.focus({ preventScroll: true });
}

function homeView() {
  const s = state.session;
  const totalSets = state.history.reduce((n, h) => n + h.setsDone, 0);
  const periodStart = new Date(); periodStart.setHours(0, 0, 0, 0);
  if (homePeriod === 'week') periodStart.setDate(periodStart.getDate() - ((periodStart.getDay() + 6) % 7));
  else if (homePeriod === 'month') periodStart.setDate(1);
  else periodStart.setMonth(0, 1);
  const thisWeek = state.history.filter((h) => h.endedAt >= +periodStart).length;
  const periodLabel = { week: 'tällä viikolla', month: 'tässä kuussa', year: 'tänä vuonna' }[homePeriod];
  const resumeProgress = s && core.progress(s);
  const resumeDone = !s ? '' : isFunctional(s) ? [resumeProgress.total ? `${resumeProgress.done}/${resumeProgress.total} sarjaa` : '', resumeProgress.wodsTotal ? `${resumeProgress.wodsDone}/${resumeProgress.wodsTotal} WOD` : ''].filter(Boolean).join(' · ') : `${resumeProgress.done}/${resumeProgress.total} sarjaa`;
  const resume = s ? `<section class="resume card"><div class="row"><span class="eyebrow accent"><span class="pulse" aria-hidden="true"></span> HARJOITUS KESKEN</span><span class="badge now">${resumeProgress.pct}%</span></div><h2>${esc(s.name)}</h2><p class="muted">${resumeDone} tehty · Jatka siitä, mihin jäit.</p>${progressBar(resumeProgress)}<button class="btn primary big" data-action="resume" data-key="resume">Jatka harjoitusta ${icon('arrow')}</button></section>` : '';
  const routines = state.routines.map((r, i) => {
    const functional = isFunctionalRoutine(r), strength = r.exercises.length > 0;
    const pills = routineWodPills(r) + r.exercises.map((e) => `<li class="pill">${esc(e.name)} <b>${e.setReps ? esc(e.setReps.join(' / ')) : `${e.sets}×${esc(e.reps)}`}${e.weight ? ` @ ${esc(e.weight)}` : ''}</b></li>`).join('');
    const meta = functional
      ? `<span class="badge">Toiminnallinen</span> <span><b>${r.wods.length}</b> WOD</span>${strength ? ` <span><b>${r.exercises.reduce((n, e) => n + e.sets, 0)}</b> sarjaa</span>` : ''}`
      : `<span><b>${r.exercises.length}</b> liikettä</span> <span><b>${r.exercises.reduce((n, e) => n + e.sets, 0)}</b> sarjaa</span>`;
    const lightNote = functional ? 'Voima -15 %, WOD skaalattuna' : 'Toistot ja painot -15 %';
    const variants = !functional || strength ? `<div class="routine-variants"><button class="btn secondary variant-light" data-action="start" data-mode="light" data-key="start-light-${esc(r.id)}" data-id="${esc(r.id)}" aria-label="Kevennetty ${lightNote}: ${esc(r.name)}"><span class="variant-title">${icon('feather')}Kevennetty</span> <span class="variant-note">${lightNote}</span></button>`
      + `<button class="btn secondary variant-super" data-action="start" data-mode="super" data-key="start-super-${esc(r.id)}" data-id="${esc(r.id)}" aria-label="Super Lisäsarja liikkeisiin: ${esc(r.name)}"><span class="variant-title">${icon('flame')}Super</span> <span class="variant-note">Lisäsarja liikkeisiin</span></button></div>` : '';
    return `<li class="card routine" data-tone="${[...r.id].reduce((n, c) => n + c.charCodeAt(0), 0) % 3}">
      <button class="quick-start" data-action="start" data-key="quick-${esc(r.id)}" data-id="${esc(r.id)}" aria-label="Aloita: ${esc(r.name)}">${icon('play')} <span>Aloita</span></button>
      <details class="routine-details" data-routine-panel="${esc(r.id)}" ${openRoutines.has(r.id) ? 'open' : ''}>
        <summary><h2>${esc(r.name)}</h2>
          <span class="routine-meta">${meta}</span>
          ${routineMuscles(r)}
        </summary>
        <div class="routine-body">${routineLastResults(r, state.history)}<ul class="routine-pills" aria-label="${functional ? 'Sisältö' : 'Liikkeet'}: ${esc(r.name)}">${pills}</ul><div class="routine-actions"><button class="btn ${i === 0 ? 'primary' : 'secondary'} big" data-action="start" data-key="start-${esc(r.id)}" data-id="${esc(r.id)}">Aloita harjoitus ${icon('arrow')}</button><button class="btn secondary icon-button" data-action="edit" data-key="edit-${esc(r.id)}" data-id="${esc(r.id)}" aria-label="Muokkaa: ${esc(r.name)}">${icon('edit')}</button></div>${variants}${strength || !functional ? progressionControls(r) : ''}</div>
      </details></li>`;
  }).join('');
  const ios = (/iPad|iPhone|iPod/.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) && !navigator.standalone;
  const hint = ios ? '<p class="install-hint" id="ios-hint">Lisää sovellus aloitusnäyttöön: Jaa → Lisää Koti-valikkoon. Tiedot säilyvät tällä laitteella. Selaintietojen tyhjentäminen voi poistaa ne.</p>' : '';
  return `${brand()}${warn()}${savedCard()}${resume}<h1 class="sr-only" tabindex="-1">Treenipäiväkirja</h1>
    <div class="stats"><button type="button" class="stat-tile" data-action="homeperiod" data-key="homeperiod"><strong>${thisWeek}</strong> <span>${periodLabel}</span></button><div><strong>${totalSets}</strong><span>kirjattua sarjaa</span></div><div><strong>${state.history.length}</strong><span>valmista treeniä</span></div></div>
    <div class="stats-links"><button class="btn secondary stats-launch" data-action="showhistory" data-key="history-top">Historia</button><button class="btn secondary stats-launch" data-action="timer" data-key="timer-top">${icon('stopwatch')} Ajastin</button><button class="btn secondary stats-launch" data-action="records" data-key="records-top">Ennätykset</button></div>
    <div class="home-grid"><section class="home-programs" aria-label="Ohjelmat"><ul class="list routine-list">${routines}</ul><button class="btn secondary add-workout" data-action="new" data-key="new">${icon('plus')} Luo treeniohjelma</button></section>
    <div class="home-aside">
    <details class="settings card" ${settingsOpen ? 'open' : ''}><summary>${icon('settings')}<h2>Asetukset</h2>${backupFlag()}<span class="settings-chevron" aria-hidden="true">⌄</span></summary>
      <div class="settings-body">
        ${appearanceSection()}
        <div class="rest-settings">
          <label class="check"><span>Automaattinen lepoajastin<small>Laskee tieteellisen lepoajan (45–180 s) automaattisesti liikkeen ja sarjan mukaan, ellet aseta omaa aikaa</small></span><input type="checkbox" role="switch" data-action="autorest" data-key="autorest" ${state.settings.autoRest ? 'checked' : ''} aria-label="Käynnistä lepoajastin sarjan jälkeen"></label>
          <p class="muted small-copy">Automaattinen lepoaika: moninivelliikkeissä 120–180 s, eristävissä liikkeissä 75–120 s ja keskivartalo-/liikkuvuusliikkeissä 45–60 s. Lisätoistot ja tiukat sarjat pidentävät palautusta automaattisesti.</p>
          ${state.settings.autoRest ? `<label class="check"><span>Oma lepoaika sarjojen välillä<small>Pois päältä: aika lasketaan liikkeen mukaan. Päällä: sama aika jokaisen sarjan jälkeen.</small></span><input type="checkbox" role="switch" data-action="restfixed" data-key="restfixed" ${state.settings.restMode === 'fixed' ? 'checked' : ''} aria-label="Käytä omaa lepoaikaa sarjojen välillä"></label>${state.settings.restMode === 'fixed' ? `<label class="field">Lepoaika sarjojen välillä (sekuntia, 10–600)<input type="number" inputmode="numeric" min="10" max="600" step="5" value="${state.settings.restSeconds}" data-action="restsecs" data-key="restsecs"></label>` : ''}` : ''}
        </div>
        <label class="check"><span>Kuormittavuuden kirjaus<small>Näyttää liikkeissä valinnaiset kentät: toteutuneet toistot, sarjan tyyppi ja kipu. RIR kirjataan aina liikkeen sarjojen alla. Tilastojen kehitysindeksi tarvitsee nämä tiedot.</small></span><input type="checkbox" role="switch" data-action="advancedlogging" data-key="advancedlogging" ${state.settings.advancedLogging ? 'checked' : ''} aria-label="Näytä kuormittavuuden kirjaus harjoituksen aikana"></label>
        <label class="check"><span>Ruotsalaiset kannustukset<small>Näyttää sarjan kirjaamisen tai WOD-ennätyksen jälkeen lyhyen ruotsinkielisen kannustuksen.</small></span><input type="checkbox" role="switch" data-action="cheers" data-key="cheers" ${state.settings.cheers !== false ? 'checked' : ''} aria-label="Näytä ruotsalaiset kannustukset"></label>
        ${hrSettings()}${backupCompact()}
        <section class="share"><button class="btn secondary" data-action="share" data-key="share">${icon('arrow')} Jaa sovellus (kopioi linkki)</button>${shareMessage ? `<p class="small-copy" id="share-status" role="status">${esc(shareMessage)}</p>` : ''}<p class="small-copy" id="build-number">${buildNumber ? `Versio ${esc(buildNumber)}` : ''}</p></section>
      </div>
    </details></div></div>${hint}<footer>${icon('shield')} Vain tällä laitteella. Ei tiliä. Ei seurantaa.<span>Tietosi pysyvät laitteellasi. Muista varmuuskopio.</span>${updateReady ? '<p>Päivitys on valmis. Sulje sovelluksen välilehdet ja avaa uudelleen.</p>' : ''}</footer>`;
}

function stepper({ kind, cls, ei, si, e, value, unit, group, down, up, canDown, canUp }) {
  const button = (delta, label, enabled, glyph) => `<button class="step-btn" data-action="adjust${kind}" data-e="${ei}" data-s="${si}" data-delta="${delta}" data-key="${kind}-${delta < 0 ? 'minus' : 'plus'}-${ei}-${si}" aria-label="${label}: ${esc(e.name)}, sarja ${si + 1}" ${enabled ? '' : 'disabled'}>${icon(glyph)}</button>`;
  const label = `${esc(value)}${unit ? ` ${unit}` : ''}, kirjoita ${group}: ${esc(e.name)}, sarja ${si + 1}`;
  return `<div class="stepper ${cls}" role="group" aria-label="${esc(e.name)}, sarja ${si + 1}: ${group}">${button(-1, down, canDown, 'minus')}<button class="step-value" data-action="edit${kind}" data-e="${ei}" data-s="${si}" data-key="${kind}-value-${ei}-${si}" aria-label="${label}"><b>${esc(value)}</b>${unit ? ` <small>${unit}</small>` : ''}</button>${button(1, up, canUp, 'plus')}</div>`;
}

function setEntry(e, ei, si, nextSi) {
  const set = e.sets[si];
  const target = core.setTargetLabel(set.reps ?? e.reps, e.weight);
  const count = core.setRepCount(e, set);
  const logged = (count !== null && set.actualReps !== undefined) || !!set.actualWeight;
  const range = set.actualReps === undefined && core.isRepRange(e, set);
  const value = core.setTargetLabel(range ? set.reps ?? e.reps : count ?? set.reps ?? e.reps, set.actualWeight || e.weight);
  const showTarget = logged || value !== target;
  const status = set.done ? 'Tehty!' : 'Klikkaa tehdyksi';
  const weight = core.setWeightValue(e, set);
  const step = String(core.weightStepFor(e)).replace('.', ',');
  const adjustment = `<div class="set-steppers">${count === null ? '' : stepper({ kind: 'reps', cls: 'rep-adjust', ei, si, e, value: count, unit: 'toistoa', group: 'toteutuneet toistot', down: 'Vähennä toisto', up: 'Lisää toisto', canDown: count > 0, canUp: count < core.MAX_REPS })}${stepper({ kind: 'weight', cls: 'weight-adjust', ei, si, e, value: weight === null ? set.actualWeight || e.weight : String(weight).replace('.', ','), unit: weight === null ? '' : 'kg', group: 'toteutunut paino', down: `Vähennä painoa ${step} kg`, up: `Lisää painoa ${step} kg`, canDown: weight > 0, canUp: weight !== null && weight < 10000 })}</div>`;
  return `<div class="set-entry"><button class="set ${set.done ? 'done' : ''} ${si === nextSi ? 'next' : ''}" data-action="set" data-e="${ei}" data-s="${si}" data-key="s${ei}-${si}" aria-pressed="${set.done}" aria-label="Sarja ${si + 1} ${esc(status)}. ${esc(value)}${showTarget ? ` Tavoite: ${esc(target)}` : ''}. ${esc(e.name)}, sarja ${si + 1}/${e.sets.length}">${set.done ? `<span class="set-complete" aria-hidden="true">${icon('check')}</span><span class="set-label">Sarja ${si + 1}</span>` : '<span class="set-foot set-foot-idle">Klikkaa<br>tehdyksi</span>'}</button>${adjustment}</div>`;
}

// One RIR per movement: the reps left in reserve after its hardest (last) set.
function exerciseRir(e, ei) {
  const choices = [0, 1, 2, 3, 4, 5].map((n) => `<button class="rir-btn" data-action="exrir" data-e="${ei}" data-value="${n}" data-key="rir-btn-${ei}-${n}" aria-pressed="${String(e.rir ?? '') === String(n)}" aria-label="${esc(e.name)}: RIR ${n}">${n}</button>`).join('');
  return `<div class="exercise-rir" data-rir-box="${ei}"><span class="exercise-rir-label"><b>RIR</b> – montako toistoa jäi vielä vaikeimman sarjan jälkeen? (5 = vähintään 5)</span><div class="exercise-rir-controls"><div class="rir-row" role="group" aria-label="${esc(e.name)}: RIR, varatoistot vaikeimman sarjan jälkeen">${choices}</div><div class="exercise-footer" role="group" aria-label="${esc(e.name)}: sarjojen määrä"><div class="mini"><button class="btn ghost" data-action="rmset" data-key="r${ei}" data-e="${ei}" ${e.sets.length < 2 ? 'disabled' : ''} aria-label="Poista sarja: ${esc(e.name)}"><span class="set-control-label">Sarja</span> <span class="set-control-sign">−</span></button><button class="btn ghost" data-action="addset" data-key="a${ei}" data-e="${ei}" ${e.sets.length >= core.MAX_SETS ? 'disabled' : ''} aria-label="Lisää sarja: ${esc(e.name)}"><span class="set-control-label">Sarja</span> <span class="set-control-sign">+</span></button></div></div></div></div>`;
}

function patchExerciseRir(ei) {
  document.getElementById('log-error')?.remove();
  const e = state.session?.exercises[ei];
  const box = e && document.querySelector(`[data-rir-box="${ei}"]`);
  if (!box) return;
  const focusedKey = box.contains(document.activeElement) ? document.activeElement.dataset.key : null;
  box.outerHTML = exerciseRir(e, ei);
  if (focusedKey) document.querySelector(`[data-key="${CSS.escape(focusedKey)}"]`)?.focus({ preventScroll: true });
}

// Updates the one set a log field affects without touching the field being typed in.
function patchLoggedSet(ei, si) {
  document.getElementById('log-error')?.remove();
  const e = state.session?.exercises[ei];
  const entry = e?.sets[si] && document.querySelector(`[data-key="s${ei}-${si}"]`)?.closest('.set-entry');
  if (!entry) return;
  const nextSi = ei === core.currentExercise(state.session) ? e.sets.findIndex((set) => !set.done) : -1;
  const focusedKey = entry.contains(document.activeElement) ? document.activeElement.dataset.key : null;
  entry.outerHTML = setEntry(e, ei, si, nextSi);
  if (focusedKey) document.querySelector(`[data-key="${CSS.escape(focusedKey)}"]`)?.focus({ preventScroll: true });
}

// Asked once per weighted exercise whose load meaning is unknown; without it no 1RM estimate is possible.
function loadPrompt(e, ei) {
  const weighted = String(e.weight ?? '').trim() !== '' || e.sets.some((set) => set.actualWeight);
  if (!weighted || (e.tracking?.loadType ?? 'unknown') !== 'unknown') return '';
  const options = Object.entries(LOAD_TYPES).filter(([value]) => value !== 'unknown').map(([value, label]) => `<label class="choice-option"><input type="radio" name="sload-${ei}" data-sessionload="1" data-e="${ei}" data-key="sload-${ei}-${value}" value="${value}"><span>${esc(label)}</span></label>`).join('');
  return `<details class="choice-menu load-prompt"><summary data-key="sload-${ei}">Mitä paino tarkoittaa? Valitse 1RM-arviota varten</summary><fieldset><legend>${esc(e.name)}: kuorman merkitys</legend><p class="muted small-copy">Valinta tallentuu tähän treeniin ja ohjelmaan. Vanhoja treenejä ei muuteta.</p>${options}</fieldset></details>`;
}

function exerciseLog(e, ei) {
  const rows = e.sets.map((set, si) => {
    const timed = /^\d+(?:[.,]\d+)?\s*(?:s\b|sek|min)/i.test(set.reps ?? e.reps);
    return `<fieldset class="set-stat-log"><legend>Sarja ${si + 1}: tilastot</legend><div class="stat-filter-grid"><label class="field">${timed ? 'Toteutunut kesto (s)' : 'Toteutuneet toistot'}<input type="number" min="0" max="${timed ? 86400 : core.MAX_REPS}" step="1" inputmode="numeric" value="${esc(timed ? set.actualSeconds ?? '' : set.actualReps ?? '')}" data-log="${timed ? 'actualSeconds' : 'actualReps'}" data-e="${ei}" data-s="${si}" data-key="stat-result-${ei}-${si}" aria-label="${esc(e.name)}, sarja ${si + 1}: ${timed ? 'toteutunut kesto' : 'toteutuneet toistot'}"></label></div><fieldset class="set-kind-options"><legend>Sarjan tyyppi</legend>${[['', 'Luokittelematon'], ['working', 'Työsarja'], ['warmup', 'Lämmittely']].map(([value, label]) => `<label class="choice-option"><input type="radio" name="set-kind-${ei}-${si}" data-log="kind" data-e="${ei}" data-s="${si}" value="${value}" ${(set.kind ?? '') === value ? 'checked' : ''}><span>${label}</span></label>`).join('')}</fieldset></fieldset>`;
  }).join('');
  return `<details class="exercise-log" data-log-panel="${esc(e.id)}" ${openLogs.has(e.id) ? 'open' : ''}><summary>Kuormittavuus (valinnainen)</summary><p class="muted small-copy">Toistot ja painot kirjataan myös sarjojen − / + -painikkeilla. Tilastojen suoritusarvio vaatii toteutuneet toistot, tunnetun kg-kuorman, työsarjamerkinnän ja liikkeen RIR:n, joka lasketaan viimeiselle työsarjalle. Tyhjä tulos on tuntematon.</p>${rows}<label class="check"><span>Tunsin kipua<small>Älä jatka kipua aiheuttavaa liikettä. Kuormaa ei nosteta.</small></span><input type="checkbox" data-log="pain" data-e="${ei}" data-key="pain-${ei}" aria-label="${esc(e.name)}: kipua" ${e.pain ? 'checked' : ''}></label></details>`;
}

function recoveryNote(s) {
  if (!s.fatigued) return '';
  const light = s.exercises.some((e) => e.deload);
  const lightText = s.wods?.length
    ? 'Kevennetty treeni: voimaosan toistot ja painot ovat noin 15 % pienemmät ja WOD on valmiiksi Skaalattu-versiolla. Ohjelma ei muutu, eikä tämän treenin tulos muuta tavoitteita. Lopeta, jos olo huononee.'
    : 'Kevennetty treeni: toistot ja painot ovat noin 15 % pienemmät. Ohjelma ei muutu, eikä tämän treenin tulos muuta tavoitteita. Lopeta, jos olo huononee.';
  return `<p class="notice" role="status">${light ? lightText : 'Palautuminen on merkitty heikoksi. Tätä treeniä ei ole kevennetty automaattisesti: valitse kuormat itse ja lopeta, jos olo huononee.'}</p>`;
}

// Only the largest muscle groups get a rail graphic; whole-body, cardio, mobility and unknown moves stay plain.
const RAIL_MUSCLE = { Etureidet: 'legs', Takareidet: 'legs', Pakarat: 'legs', Pohkeet: 'legs', Selkä: 'back', Rinta: 'chest', Hartiat: 'shoulders', Hauis: 'arms', Ojentajat: 'arms', Keskivartalo: 'core' };
const MUSCLE_GLYPHS = {
  legs: 'M6 2h12l-.6 7L16 20h1.5a1.2 1.2 0 0 1 0 2.4h-3.7L12.6 11h-1.2l-1.2 11.4H6.5a1.2 1.2 0 0 1 0-2.4H8L6.6 9 6 2z',
  back: 'M3.5 3.5h17l-3.3 9.5-1.6 7.5H8.4L6.8 13 3.5 3.5zM11.3 6v12h1.4V6h-1.4z',
  chest: 'M2.5 6.5c3-2.4 6.3-2.6 8.8-1V15c-2.6 1.8-6.2 1.6-8.2-.9-1.1-1.7-1.2-5.6-.6-7.6zM21.5 6.5c-3-2.4-6.3-2.6-8.8-1V15c2.6 1.8 6.2 1.6 8.2-.9 1.1-1.7 1.2-5.6.6-7.6z',
  shoulders: 'M12 1.5a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4zM2.5 19c0-6.5 2.7-10 6.5-10h6c3.8 0 6.5 3.5 6.5 10v3h-3.3v-4.5c0-1-.4-2-1.2-2.6V22H7V14.9c-.8.6-1.2 1.6-1.2 2.6V22H2.5v-3z',
  arms: 'M2 21v-6c0-4 3-6 6.5-6 2.5 0 4 1 5 2.5l.5-3.5-.8-2c-.6-1.6.4-3 2-3H18c1.3 0 2 1 1.8 2.2l-.5 2.3c1.7 3.5 2.2 7.5 1.2 10.5-.7 2-2.5 3-4.5 3H2z',
  core: 'M6.5 3.5h5v5h-5zM12.5 3.5h5v5h-5zM6.5 9.5h5v5h-5zM12.5 9.5h5v5h-5zM6.5 15.5h5v5h-5zM12.5 15.5h5v5h-5z',
};
const railMuscle = (e) => RAIL_MUSCLE[core.sessionExerciseCategory(e, state.customExercises)] || '';
const MUSCLE_LABELS = { legs: 'Jalat', back: 'Selkä', chest: 'Rinta', shoulders: 'Hartiat', arms: 'Kädet', core: 'Keskivartalo' };

function muscleGlyph(muscle, className) {
  return `<svg class="${className}" viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd" aria-hidden="true" focusable="false"><path d="${MUSCLE_GLYPHS[muscle]}"/></svg>`;
}

function routineMuscles(routine) {
  const counts = new Map();
  const movements = [...routine.exercises, ...(routine.wods ?? []).flatMap((w) => w.movements)];
  for (const movement of movements) {
    const muscle = railMuscle(movement);
    if (muscle) counts.set(muscle, (counts.get(muscle) ?? 0) + 1);
  }
  if (!counts.size) return '';
  return `<span class="routine-muscles">${[...counts].map(([muscle, count]) => {
    const label = `${MUSCLE_LABELS[muscle]}: ${count} ${count === 1 ? 'liike' : 'liikettä'}`;
    return `<span class="routine-muscle" data-muscle="${muscle}" role="img" aria-label="${label}" title="${label}">${muscleGlyph(muscle, 'muscle-icon')}<b aria-hidden="true">${count}</b></span>`;
  }).join('')}</span>`;
}

// A functional workout's WOD part is next once every exercise before it is done.
function isFunctional(s) { return s?.type === 'functional' || !!s?.wods?.length; }
function nextWodIndex(s) { return core.currentExercise(s) < 0 ? (s.wods ?? []).findIndex((w) => !w.result) : -1; }

function trackRail(s, cur) {
  const boxes = s.exercises.map((e, ei) => {
    const done = core.exerciseDone(e);
    const status = done ? 'tehty' : ei === cur ? 'vuorossa' : 'kesken';
    const muscle = railMuscle(e);
    const glyph = muscle ? muscleGlyph(muscle, 'track-muscle') : '';
    return `<li><button class="track-box${done ? ' done' : ''}${ei === cur ? ' current' : ''}" data-action="jumpto" data-e="${ei}" data-key="track-${ei}" ${muscle ? `data-muscle="${muscle}"` : ''} ${ei === cur ? 'aria-current="step"' : ''} aria-label="Liike ${ei + 1}: ${esc(e.name)}, ${e.sets.length} sarjaa, ${status}">${glyph}<span class="track-num">${e.sets.length}</span></button></li>`;
  }).join('');
  const next = nextWodIndex(s);
  const wods = (s.wods ?? []).map((w, wi) => {
    const status = w.result ? 'kirjattu' : wi === next ? 'vuorossa' : 'kesken';
    return `<li><button class="track-box track-wod${w.result ? ' done' : ''}${wi === next ? ' current' : ''}" data-action="jumpwod" data-w="${wi}" data-key="track-wod-${wi}" ${wi === next ? 'aria-current="step"' : ''} aria-label="${wodPartLabel(wi, s.wods.length)}: ${esc(wodTitle(w))}, ${status}">${icon('board')}</button></li>`;
  }).join('');
  return `<nav class="track-rail" aria-label="Harjoituksen eteneminen"><ol>${boxes}${wods}</ol></nav>`;
}

// The newest finished sets of the same movement, memoized per history snapshot.
const lastTimeCache = new WeakMap();
function lastTime(e) {
  let byName = lastTimeCache.get(state.history);
  if (!byName) lastTimeCache.set(state.history, byName = new Map());
  const key = normalizeSearch(e.name);
  if (!byName.has(key)) {
    let best = null;
    for (const h of state.history) {
      const match = h.exercises?.find((x) => normalizeSearch(x.name) === key && x.sets.some((set) => set.done));
      if (match && (!best || h.endedAt > best.at)) best = { at: h.endedAt, exercise: match };
    }
    byName.set(key, best && `Viimeksi ${new Date(best.at).toLocaleDateString('fi-FI', { day: 'numeric', month: 'numeric' })}: ${best.exercise.sets.filter((set) => set.done).slice(0, 8).map((set) => {
      const reps = set.actualReps ?? core.setRepCount(best.exercise, set) ?? set.reps ?? best.exercise.reps;
      const weight = set.actualWeight || best.exercise.weight;
      return `${reps}${weight ? ` × ${/^[\d.,]+$/.test(weight) ? `${weight} kg` : weight}` : ''}`;
    }).join(' / ')}`);
  }
  return byName.get(key);
}

// Changes only this workout; the saved program stays as it is.
function exerciseActions(e, count) {
  return `<details class="exercise-actions" data-actions-panel="${esc(e.id)}" ${openExerciseActions.has(e.id) ? 'open' : ''}><summary>Vaihda tai poista liike</summary><p class="muted small-copy">Muutos koskee vain tätä treeniä.</p><div class="exercise-actions-row"><button class="btn secondary" data-action="swapex" data-id="${esc(e.id)}" data-key="swap-${esc(e.id)}" aria-label="Vaihda liike: ${esc(e.name)}">Vaihda liike</button><button class="btn ghost danger-text" data-action="rmsessionex" data-id="${esc(e.id)}" data-key="rmex-${esc(e.id)}" ${count < 2 ? 'disabled' : ''} aria-label="Poista liike: ${esc(e.name)}">Poista liike</button></div></details>`;
}

function workoutView() {
  const s = state.session, p = core.progress(s), cur = core.currentExercise(s);
  const exercises = s.exercises.map((e, ei) => {
    const done = core.exerciseDone(e);
    const completed = e.sets.filter((set) => set.done).length;
    const nextSi = ei === cur ? e.sets.findIndex((set) => !set.done) : -1;
    const cheerAt = cheer && cheer.sessionId === s.id && cheer.exerciseId === e.id && p.done < p.total ? cheer.after : null;
    const cheerHtml = cheerAt === null ? '' : `<p class="cheer">${esc(cheer.text)}</p>`;
    const sets = (cheerAt === -1 ? cheerHtml : '') + e.sets.map((set, si) => setEntry(e, ei, si, nextSi) + (cheerAt === si ? cheerHtml : '')).join('');
    const individual = e.sets.some((set) => set.reps);
    const targets = individual ? e.sets.map((set) => core.targetLabel(set.reps ?? e.reps)).join(' / ') : core.targetLabel(e.reps);
    const restLabel = core.formatDuration(core.restFor(state.settings, e, nextSi >= 0 ? nextSi : 0) * 1000);
    return `<li class="card ex ${done ? 'complete' : ''} ${ei === cur ? 'current' : ''}" id="exercise-${ei}"><div class="exercise-heading"><span class="exercise-index">${String(ei + 1).padStart(2, '0')}</span><div class="grow"><h2>${esc(e.name)}</h2>${lastTime(e) ? `<p class="last-time muted small-copy">${esc(lastTime(e))}</p>` : ''}</div>${done ? '<span class="badge done-badge">Tehty</span>' : ei === cur ? '' : `<span class="badge">${completed}/${e.sets.length}</span>`}</div><div class="sets">${sets}</div>${exerciseRir(e, ei)}${loadPrompt(e, ei)}${exerciseActions(e, s.exercises.length + (s.wods?.length ?? 0))}${state.settings.advancedLogging ? exerciseLog(e, ei) : ''}</li>`;
  }).join('');
  const error = logError ? `<p class="banner" id="log-error" role="alert">${esc(logError)}</p>` : '';
  const add = `<button class="btn secondary add-ex-btn" data-action="addsessionex" data-key="addsessionex" ${s.exercises.length >= core.SESSION_EXERCISE_LIMIT ? 'disabled' : ''}>${icon('plus')} Lisää liike tähän treeniin</button>`;
  if (isFunctional(s)) return functionalWorkout(s, p, cur, exercises, error, add);
  return `${sessionHeader()}<section class="session-intro card"><div class="row"><p class="eyebrow accent">${p.done === p.total ? 'KAIKKI SARJAT KIRJATTU' : 'HARJOITUS KÄYNNISSÄ'}</p><span class="session-stat">${p.done}/${p.total} sarjaa · ${p.pct}%</span></div><h1 tabindex="-1">${esc(s.name)}</h1>${progressBar(p)}<div class="session-summary"><p class="session-guide">${cur < 0 ? 'Hienoa työtä! Tallenna harjoitus lopettamalla.' : 'Napauta sarjaa kirjataksesi. Uusi napautus peruu.'} Muuta toteutuneita toistoja ja painoa sarjan − / + -painikkeilla.</p><span class="muted">${s.exercises.filter(core.exerciseDone).length}/${s.exercises.length} liikettä</span></div>${cur > 0 ? `<button class="btn secondary jump" data-action="jump" data-key="jump">Jatka liikkeestä: ${esc(s.exercises[cur].name)} ${icon('arrow')}</button>` : ''}</section>${recoveryNote(s)}${error}<ul class="list exercise-list">${exercises}</ul>${add}${sessionEnd(p.done === p.total)}${trackRail(s, cur)}`;
}

function sessionHeader(back = `<button class="btn ghost back" data-action="home" data-key="back" aria-label="Takaisin harjoituksiin">${icon('back')} Harjoituksiin</button>`) {
  return `<header class="session-header">${back}<span class="session-metrics">${hrBadge()}<span class="session-time">${icon('clock')}<span id="elapsed">0:00</span></span></span></header>${warn()}`;
}

// The full-screen clock of one WOD part. render() falls back to the workout when that clock is gone.
function wodClockView() {
  const s = state.session, wi = s.wods.findIndex((w) => w.id === clockWodId);
  return `${sessionHeader(`<button class="btn ghost back" data-action="clockback" data-key="clockback" aria-label="Takaisin harjoitukseen">${icon('back')} Harjoitukseen</button>`)}${clockScreen(s.wods[wi], wi, { count: s.wods.length, history: state.history, icon })}`;
}

function sessionEnd(complete) {
  return `<div class="session-end"><button class="btn ${complete ? 'primary' : 'secondary'} big" data-action="finish" data-key="finish">${complete ? 'Tallenna harjoitus' : 'Lopeta kesken'} ${icon('check')}</button><button class="btn danger" data-action="discard" data-key="discard">Hylkää harjoitus</button><p class="small-copy muted">${storageOk ? 'Edistyminen tallennettu tälle laitteelle.' : 'Edistymistä ei ole tallennettu. Pidä välilehti auki.'}</p></div><div id="rest" class="rest" hidden></div>`;
}

// In class order: warm-up, strength or skill exercises, WOD parts, cool-down. Progress counts sets and WOD results.
function functionalWorkout(s, p, cur, exercises, error, add) {
  const wods = s.wods ?? [], next = nextWodIndex(s);
  const setsLeft = p.done < p.total, wodsLeft = p.wodsDone < p.wodsTotal, complete = !setsLeft && !wodsLeft;
  // A count stays with its unit, so a narrow screen breaks the line only at the separators.
  const stat = [p.total ? `${p.done}/${p.total}&nbsp;sarjaa` : '', p.wodsTotal ? `${p.wodsDone}/${p.wodsTotal}&nbsp;WOD` : '', `${p.pct}%`].filter(Boolean).join(' · ');
  const guide = complete ? 'Hienoa työtä! Tallenna harjoitus lopettamalla.' : [
    setsLeft ? 'Napauta sarjaa kirjataksesi. Uusi napautus peruu. Muuta toteutuneita toistoja ja painoa sarjan − / + -painikkeilla.' : '',
    wodsLeft ? (p.wodsTotal > 1 ? 'Käynnistä kello WOD-osan kortista tai kirjaa tulos aina, kun osa on tehty.' : 'Käynnistä kello WOD-kortista tai kirjaa tulos, kun WOD on tehty.') : '',
  ].filter(Boolean).join(' ');
  const jump = cur > 0 ? `<button class="btn secondary jump" data-action="jump" data-key="jump">Jatka liikkeestä: ${esc(s.exercises[cur].name)} ${icon('arrow')}</button>`
    : cur < 0 && s.exercises.length && next >= 0 ? `<button class="btn secondary jump" data-action="jump" data-key="jump">Siirry WOD-osaan: ${esc(wodTitle(wods[next]))} ${icon('arrow')}</button>` : '';
  const cards = wods.map((w, wi) => {
    const open = resultDraft?.sessionId === s.id && resultDraft.wodId === w.id;
    return sessionWodCard(w, wi, {
      count: wods.length, history: state.history, current: wi === next, form: open ? resultDraft.fields : null, error: open ? resultError : '',
      cheer: wodCheer?.sessionId === s.id && wodCheer.wodId === w.id ? wodCheer.text : '', advanced: state.settings.advancedLogging, icon,
    });
  }).join('');
  const intro = `<section class="session-intro card"><div class="row"><p class="eyebrow accent">${complete ? 'KAIKKI OSAT KIRJATTU' : 'HARJOITUS KÄYNNISSÄ'}</p><span class="session-stat">${stat}</span></div><h1 tabindex="-1">${esc(s.name)}</h1>${progressBar({ done: p.done + p.wodsDone, total: p.total + p.wodsTotal, pct: p.pct })}<div class="session-summary"><p class="session-guide">${guide}</p>${s.exercises.length ? `<span class="muted">${s.exercises.filter(core.exerciseDone).length}/${s.exercises.length} liikettä</span>` : ''}</div>${jump}</section>`;
  return `${sessionHeader()}${intro}${recoveryNote(s)}${error}${s.warmup ? sessionBlock('warmup', s.warmup, icon) : ''}${s.exercises.length ? `<ul class="list exercise-list">${exercises}</ul>` : ''}${add}<ul class="list wod-list">${cards}</ul>${s.cooldown ? sessionBlock('cooldown', s.cooldown, icon) : ''}${sessionEnd(complete)}${trackRail(s, cur)}`;
}

function progressionEditor(e, i) {
  const config = progressionConfig(e);
  const savedRange = e.progression?.minReps !== undefined && e.progression?.maxReps !== undefined;
  const restSecs = core.restFor(state.settings, e);
  const restOwn = state.settings.restMode === 'fixed';
  return `<details class="progression-editor"><summary>Automaattinen kehitys: ${config.minReps}–${config.maxReps} toistoa · askel ${config.weightStep} kg · lepo ${restSecs} s</summary><p class="muted small-copy">${savedRange ? 'Tallennettu kehitysalue säilytetään.' : esc(progressionRange(e).reason)} Sovellus laskee toistot, kuorman noston tai kevennyksen ja lisäsarjojen vaikutuksen automaattisesti ilman käsin säätämistä. Lepoaika (${restSecs} s) ${restOwn ? 'on Asetuksissa määrittämäsi oma aika.' : 'lasketaan automaattisesti.'}</p><button class="btn secondary" data-action="autorange" data-i="${i}" data-key="autorange-${esc(e.id)}">Valitse toistoalue automaattisesti</button><div class="grid3"><label class="field">Alaraja (toistoa)<input type="number" min="1" max="30" step="1" inputmode="numeric" value="${esc(e.progression?.minReps ?? config.minReps)}" data-progression="minReps" data-i="${i}" data-key="minReps-${esc(e.id)}"></label><label class="field">Yläraja (toistoa)<input type="number" min="1" max="30" step="1" inputmode="numeric" value="${esc(e.progression?.maxReps ?? config.maxReps)}" data-progression="maxReps" data-i="${i}" data-key="maxReps-${esc(e.id)}"></label><label class="field">Pienin painoaskel (kg)<input type="number" min="0.01" max="100" step="0.01" inputmode="decimal" value="${esc(e.progression?.weightStep ?? config.weightStep)}" data-progression="weightStep" data-i="${i}" data-key="weightStep-${esc(e.id)}"></label></div><label class="check"><span>Paino on ulkoinen kg-kuorma<small>Poista valinta avustetuille liikkeille tai muille kuormayksiköille: paino muuttuu silloin vain käsin.</small></span><input type="checkbox" data-progression="autoLoad" data-i="${i}" data-key="autoLoad-${esc(e.id)}" ${config.autoLoad ? 'checked' : ''}></label></details>${trackingEditor(e, i)}`;
}

function setTargetFields(e, i) {
  return Array.from({ length: core.clampInt(e.sets, 1, core.MAX_SETS, 3) }, (_, si) => `<label class="field">Sarja ${si + 1}: toistot / aika<input type="text" maxlength="20" value="${esc(e.setReps[si] ?? e.reps)}" data-f="setReps" data-i="${i}" data-s="${si}" data-key="setReps-${esc(e.id)}-${si}" placeholder="8–12 / 30 s"></label>`).join('');
}

function exerciseRows() {
  return draft.exercises.map((e, i) => {
    const individual = Array.isArray(e.setReps);
    const targets = individual ? setTargetFields(e, i) : '';
    return `<li class="card edit"><div class="row editor-row"><span class="eyebrow exercise-tag">LIIKE ${String(i + 1).padStart(2, '0')}</span><div class="mini"><button class="btn ghost icon-button" data-action="up" data-i="${i}" data-key="up-${esc(e.id)}" ${i === 0 ? 'disabled' : ''} aria-label="Siirrä ylös">↑</button><button class="btn ghost icon-button" data-action="down" data-i="${i}" data-key="down-${esc(e.id)}" ${i === draft.exercises.length - 1 ? 'disabled' : ''} aria-label="Siirrä alas">↓</button><button class="btn ghost danger-text" data-action="rmex" data-i="${i}" data-key="remove-${esc(e.id)}" aria-label="Poista liike ${i + 1}">Poista</button></div></div><div class="name-picker-row"><label class="field grow">Liikkeen nimi<input type="text" maxlength="60" value="${esc(e.name)}" data-f="name" data-i="${i}" data-key="name-${esc(e.id)}" autocomplete="off" placeholder="Esim. maljakyykky"></label><button class="btn secondary pick-exercise" data-action="pickex" data-id="${esc(e.id)}" data-key="pick-${esc(e.id)}">Valitse kirjastosta</button></div><div class="grid3"><label class="field">Sarjat<input type="number" inputmode="numeric" min="1" max="20" step="1" value="${esc(e.sets)}" data-f="sets" data-i="${i}" data-key="sets-${esc(e.id)}"></label><label class="field">${individual ? 'Oletustoistot / aika' : 'Toistot / aika'}<input type="text" maxlength="20" value="${esc(e.reps)}" data-f="reps" data-i="${i}" data-key="reps-${esc(e.id)}" placeholder="8–12 / 30 s"></label><label class="field">Paino <span class="optional">valinnainen</span><input type="text" maxlength="20" value="${esc(e.weight)}" data-f="weight" data-i="${i}" data-key="weight-${esc(e.id)}" placeholder="20 kg"></label></div><label class="check per-set-toggle"><span>Määritä toistot sarjakohtaisesti<small>${individual ? 'Uudet sarjat käyttävät oletustoistoja. Poista valinta käyttääksesi samaa tavoitetta kaikissa sarjoissa.' : 'Aseta jokaiselle sarjalle oma toistotavoite tai kesto.'}</small></span><input type="checkbox" data-f="individualReps" data-i="${i}" data-key="individualReps-${esc(e.id)}" ${individual ? 'checked' : ''}></label>${individual ? `<div class="set-targets">${targets}</div>` : ''}${progressionEditor(e, i)}</li>`;
  }).join('');
}
function editorHeader() {
  return `<header class="editor-header"><button class="btn ghost back" data-action="home" data-key="cancel">${icon('back')} Peruuta</button><span class="eyebrow" id="draft-status" role="status">${draftOk ? 'LUONNOS SÄILYY TÄSSÄ VÄLILEHDESSÄ' : 'LUONNOS EI TALLENTUNUT — pidä välilehti auki'}</span></header>${warn()}`;
}
function editorFooter() {
  return `<p id="err" class="banner" role="alert" tabindex="-1" ${editError ? '' : 'hidden'}>${esc(editError)}</p><div class="editor-save"><button class="btn primary big" data-action="save" data-key="save">Tallenna harjoitus ${icon('check')}</button></div>${draft.isNew ? '' : '<button class="btn danger" data-action="delroutine" data-key="delroutine">Poista harjoitus</button>'}`;
}
const editorTitle = () => `<h1 tabindex="-1">${draft.isNew ? 'Uusi harjoitus' : 'Muokkaa harjoitusta'}</h1>`;
const nameField = (placeholder) => `<label class="field name-field">Harjoituksen nimi<input type="text" maxlength="60" value="${esc(draft.name)}" data-f="rname" data-key="rname" autocomplete="off" placeholder="${placeholder}"></label>`;

function editView() {
  if (draft.type === 'functional') return functionalEditView();
  return `${editorHeader()}<div class="editor-top"><p class="eyebrow accent">SUUNNITTELE HARJOITUKSESI</p>${editorTitle()}<p class="editor-copy">Valitse ${EXERCISES.length} liikkeestä tai lisää omasi. Aseta tavoitteet oman tasosi mukaan.</p></div>${nameField('Esim. ylävartalo A')}<ul class="list editor-list">${exerciseRows()}</ul><button class="btn secondary add-ex-btn" data-action="addex" data-key="addex" ${draft.exercises.length >= 60 ? 'disabled' : ''}>${icon('plus')} Lisää liike</button>${editorFooter()}`;
}

// Fixed class order: warm-up, strength/skill (the gym exercise rows), 1–3 scored WOD parts, cool-down.
function functionalEditView() {
  const count = draft.wods.length;
  const strength = `<section class="editor-section"><div class="section-head"><h2>Voima / taito</h2><span class="eyebrow">Valinnainen</span></div><p class="editor-copy">Esim. takakyykky 5 × 3 tai käsilläseisonnan harjoittelu. Sarjat kirjataan kuten kuntosalitreenissä.</p>${draft.exercises.length ? `<ul class="list editor-list">${exerciseRows()}</ul>` : ''}<button class="btn secondary add-ex-btn" data-action="addex" data-key="addex" ${draft.exercises.length >= 60 ? 'disabled' : ''}>${icon('plus')} Lisää voima- tai taitoliike</button></section>`;
  return `${editorHeader()}<div class="editor-top"><p class="eyebrow accent">Toiminnallinen treeni</p>${editorTitle()}<p class="editor-copy">Rakenna tunti lämmittelystä loppuverryttelyyn. Vain WOD on pakollinen, muut osat ovat valinnaisia.</p></div>${nameField('Esim. Perjantain WOD')}${wodGuide(guideOpen)}${blockSection('warmup', draft.warmup, icon)}${strength}${draft.wods.map((w, wi) => wodEditor(w, wi, count, { icon, openScaled })).join('')}${count < MAX_WODS ? `<button class="btn secondary add-ex-btn" data-action="addwod" data-key="addwod">${icon('plus')} Lisää WOD-osa</button>` : ''}${blockSection('cooldown', draft.cooldown, icon)}${editorFooter()}`;
}

function newTypeView() {
  return `<header class="editor-header"><button class="btn ghost back" data-action="home" data-key="newtype-back">${icon('back')} Peruuta</button></header>${warn()}<div class="editor-top"><p class="eyebrow accent">Uusi treeniohjelma</p><h1 tabindex="-1">Millainen ohjelma?</h1><p class="editor-copy">Kumpikin ohjelmatyyppi tallentuu, näkyy historiassa ja kulkee varmuuskopiossa samalla tavalla.</p></div>${typeChoices(icon)}`;
}

function gymGalleryView() {
  return `<header class="editor-header"><button class="btn ghost back" data-action="galleryback" data-key="gallery-back">${icon('back')} Takaisin</button></header>${warn()}<div class="editor-top"><p class="eyebrow accent">Valmis kuntosaliohjelma</p><h1 tabindex="-1">Valitse ohjelma</h1><p class="editor-copy">Yleisiä perusohjelmia aloittelijalle. Lisää painot itse ja muokkaa liikkeet ennen tallennusta.</p></div>${gymProgramGallery(icon)}`;
}

function galleryView() {
  return `<header class="editor-header"><button class="btn ghost back" data-action="galleryback" data-key="gallery-back">${icon('back')} Takaisin</button></header>${warn()}<div class="editor-top"><p class="eyebrow accent">Aloita mallista</p><h1 tabindex="-1">Valitse malli</h1><p class="editor-copy">Malli avautuu toiminnallisena treeninä, jossa on valmiina lämmittely ja loppuverryttely. Voit muuttaa kaiken ennen tallennusta.</p></div>${templateGallery(galleryGroup, templateSex, icon)}`;
}

// Disclosure + native radios avoid mobile WebKit's CSP-blocked select shadow styles.
function choiceMenu(id, label, values, selected, all = '', custom = false) {
  const choices = all ? ['', ...values] : values;
  const field = id.endsWith('category') ? 'category' : 'equipment';
  return `<div class="field"><span id="${id}-label">${label}</span><details class="choice-menu" id="${id}"><summary data-key="${id}" aria-labelledby="${id}-label ${id}-value"><span id="${id}-value">${esc(selected || all)}</span><span aria-hidden="true">⌄</span></summary><fieldset><legend class="sr">${label}</legend>${choices.map((value, i) => `<label class="choice-option"><input type="radio" name="${id}" value="${esc(value)}" ${custom ? `data-custom="${field}"` : `data-filter="${field}"`} data-key="${id}-${i}" ${value === selected ? 'checked' : ''}><span>${esc(value || all)}</span></label>`).join('')}</fieldset></details></div>`;
}
function libraryMatches() { return findExercises(picker.query, { ...picker, custom: state.customExercises }); }
function hasLibraryFilters() { return !!(picker.query || picker.category || picker.equipment || picker.customOnly); }
function libraryResults(rows) {
  return rows.slice(0, picker.limit).map((e) => {
    const added = picker.added.includes(e.id);
    return `<li><button class="exercise-choice" data-action="chooseex" data-id="${esc(e.id)}" data-key="choice-${esc(e.id)}" ${added ? 'aria-disabled="true"' : ''}><span class="choice-icon">${icon('weight')}</span><span class="grow"><span class="sr">${added ? `Lisätty ${picker.mode === 'wod' ? 'WOD-osaan' : 'harjoitukseen'}: ` : 'Valitse liike: '}</span><strong>${esc(e.name)}</strong><span class="choice-meta">${added ? 'Lisätty · ' : ''}${esc(e.category)} · ${esc(e.equipment)}${e.custom ? ' · Oma liike' : ''}</span></span>${icon(added ? 'check' : 'plus')}</button></li>`;
  }).join('');
}
function libraryView() {
  const rows = libraryMatches(), own = customEntry();
  return `<header class="editor-header"><button class="btn ghost back" data-action="backedit" data-key="backedit">${icon('back')} ${picker.mode === 'session' ? 'Takaisin treeniin' : 'Takaisin harjoitukseen'}</button><span class="eyebrow">${EXERCISES.length} + ${state.customExercises.length} OMAA</span></header>${warn()}<div class="library-top"><h1 tabindex="-1">Liikekirjasto</h1><p class="editor-copy">${picker.mode === 'session' ? (picker.target ? 'Valitse liike, joka korvaa nykyisen vain tässä treenissä. Ohjelma ei muutu. Sarjamäärä ja toistotavoitteet säilyvät, paino tyhjenee.' : 'Valitse treeniin lisättävä liike. Se tulee nykyisen liikkeen jälkeen eikä muuta ohjelmaa.') : picker.mode === 'wod' ? (!picker.adding ? 'Valitse liike tähän kohtaan. Määrä ja kuorma säilyvät.' : picker.keepOpen ? 'Napauta liikkeitä lisätäksesi ne WOD-osaan. Palaa lopuksi harjoitukseen.' : 'Valitse WOD-osaan lisättävä liike.') : !picker.adding ? 'Valitse liike tähän kohtaan. Tavoitteet säilyvät.' : picker.keepOpen ? 'Napauta liikkeitä lisätäksesi ne. Palaa lopuksi harjoitukseen.' : 'Valitse harjoitukseen lisättävä liike.'} Haku toimii myös englanniksi.</p>${picker.adding && picker.mode !== 'session' ? `<button class="btn library-multi" data-action="multiex" data-key="multiex" aria-pressed="${picker.keepOpen}">${icon(picker.keepOpen ? 'check' : 'plus')} Lisää useita peräkkäin</button>` : ''}</div>
    <div role="search" aria-label="Liikkeiden haku" class="library-filters card"><label class="field">Hae liikettä<input type="search" id="exercise-search" data-key="exercise-search" maxlength="120" value="${esc(picker.query)}" placeholder="Esim. kyykky, ylätalja tai bench press" aria-controls="library-results" autocomplete="off"></label><div class="filter-grid">${choiceMenu('library-category', 'Lihasryhmä', CATEGORIES, picker.category, 'Kaikki lihasryhmät')}${choiceMenu('library-equipment', 'Väline', EQUIPMENT, picker.equipment, 'Kaikki välineet')}</div><label class="check library-own"><span>Vain omat liikkeet</span><input type="checkbox" id="library-own" data-key="library-own" ${picker.customOnly ? 'checked' : ''}></label><button class="btn secondary library-reset" data-action="resetfilters" data-key="resetfilters" ${hasLibraryFilters() ? '' : 'hidden'}>Tyhjennä haku ja suodattimet</button></div>
    <details class="custom-exercise card" ${customOpen ? 'open' : ''}><summary>Lisää oma liike ${icon('plus')}</summary><p class="small-copy muted">Oma liike tallentuu kirjastoon ja varmuuskopioon. Voit valita sen myöhemmin uudelleen.</p><form id="custom-exercise-form" novalidate><label class="field">Oman liikkeen nimi<input type="text" data-custom="name" data-key="custom-name" maxlength="60" value="${esc(own.name)}" required autocomplete="off"></label><div class="filter-grid">${choiceMenu('custom-category', 'Oman liikkeen lihasryhmä', CATEGORIES, own.category, '', true)}${choiceMenu('custom-equipment', 'Oman liikkeen väline', EQUIPMENT, own.equipment, '', true)}</div><label class="field">Oletustoistot / aika<input type="text" data-custom="reps" data-key="custom-reps" maxlength="20" value="${esc(own.reps)}" required></label><p id="custom-error" role="alert" tabindex="-1" class="banner" ${customError ? '' : 'hidden'}>${esc(customError)}</p><button type="submit" class="btn primary big">${picker.mode === 'session' ? 'Tallenna ja valitse' : picker.mode === 'wod' ? 'Tallenna ja lisää WOD-osaan' : 'Tallenna ja lisää harjoitukseen'} ${icon('plus')}</button></form></details>
    <div class="section-head library-count"><h2>Liikkeet</h2><span id="library-count" class="muted small-copy" role="status">${rows.length} hakutulosta</span></div><ul id="library-results" class="list library-results">${libraryResults(rows)}</ul><div id="library-empty" class="empty-state" ${rows.length ? 'hidden' : ''}><h3>Liikettä ei löytynyt</h3><p>Kokeile toista hakusanaa tai lisää oma liike.</p><button class="btn secondary" data-action="newcustom" data-key="newcustom">Lisää haettu nimi omana liikkeenä</button></div><button class="btn secondary library-more" data-action="moreex" data-key="moreex" ${rows.length <= picker.limit ? 'hidden' : ''}>Näytä lisää liikkeitä</button>${picker.keepOpen ? `<div class="library-done"><p class="small-copy muted" role="status">${picker.added.length} lisätty ${picker.mode === 'wod' ? 'WOD-osaan' : 'harjoitukseen'}${draftOk ? '' : ' · Luonnos ei tallentunut. Pidä välilehti auki.'}</p><button class="btn primary big" data-action="backedit" data-key="library-done">Valmis · takaisin harjoitukseen ${icon('check')}</button></div>` : ''}`;
}
function updateLibraryResults() {
  const rows = libraryMatches();
  document.getElementById('library-results').innerHTML = libraryResults(rows);
  document.getElementById('library-count').textContent = `${rows.length} hakutulosta`;
  document.getElementById('library-empty').hidden = rows.length > 0;
  document.querySelector('[data-action="moreex"]').hidden = rows.length <= picker.limit;
  document.querySelector('[data-action="resetfilters"]').hidden = !hasLibraryFilters();
}
function openLibrary(target = null, adding = true, wod = null) {
  picker = { query: '', category: '', equipment: '', customOnly: false, limit: 40, target, adding, keepOpen: false, added: [], mode: wod ? 'wod' : 'draft', wod };
  customOpen = false; customError = ''; view = 'library'; rememberDraft(); render();
}
// Swap (target = exercise id) starts filtered to the muscle group of the exercise being replaced.
function openSessionLibrary(target = null) {
  if (!state.session) return;
  const current = target && state.session.exercises.find((e) => e.id === target);
  if (target && !current) { announce(CHANGED_ELSEWHERE); render(); return; }
  const category = current ? core.sessionExerciseCategory(current, state.customExercises) : '';
  picker = { query: '', category, equipment: '', customOnly: false, limit: 40, target, adding: !target, keepOpen: false, added: [], mode: 'session', sessionId: state.session.id };
  sessionCustom = null; customOpen = false; customError = ''; view = 'library'; render();
}
async function chooseSessionExercise(entry) {
  const target = picker.target, sessionId = picker.sessionId;
  readLatest();
  if (!entry || state.session?.id !== sessionId) { announce(CHANGED_ELSEWHERE); render(); return; }
  let confirmedLogged = 0;
  if (target) {
    const shown = state.session.exercises.find((e) => e.id === target);
    confirmedLogged = core.loggedSetCount(shown);
    if (confirmedLogged && !await askConfirm(`Liikkeessä on ${confirmedLogged} kirjattua sarjaa. Vaihdossa ne poistuvat myös historiasta. Jos haluat säilyttää ne, lisää uusi liike ja jätä tämä kesken. Vaihdetaanko silti?`, 'Vaihda ja poista sarjat')) return;
  }
  let result;
  const ok = await mutate((next) => {
    const existing = target && next.session?.exercises.find((e) => e.id === target);
    if (target && (!existing || core.loggedSetCount(existing) > confirmedLogged)) { announce(CHANGED_ELSEWHERE); render(); return false; }
    result = target ? core.replaceSessionExercise(next.session, target, entry) : core.insertSessionExercise(next.session, entry);
    if (!result.ok) { logError = result.error; announce(result.error); render(); return false; }
    logError = '';
  }, sessionOptions());
  if (!ok || !result?.ok) return;
  sessionCustom = null; view = 'workout'; render();
  showCurrentExercise({ index: result.index, instant: true });
  announce(target ? `Liike vaihdettu: ${entry.name}. Ohjelma ei muuttunut.` : `${entry.name} lisätty treeniin. Ohjelma ei muuttunut.`);
}
function chooseExercise(exercise) {
  if (picker.mode === 'session') return chooseSessionExercise(exercise);
  if (picker.mode === 'wod') return chooseWodMovement(exercise);
  if (!exercise || !draft || picker.added.includes(exercise.id)) return;
  let row = picker.target && draft.exercises.find((e) => e.id === picker.target);
  if (!row) {
    if (draft.exercises.length >= 60) { announce('Harjoituksessa voi olla enintään 60 liikettä.'); return; }
    row = blankEx(); draft.exercises.push(row);
  }
  if (!row.name.trim()) row.reps = exercise.reps;
  row.name = exercise.name;
  row.tracking = libraryTracking(exercise);
  delete draft.customEntry;
  picker.added.push(exercise.id);
  if (picker.keepOpen) { picker.target = null; customOpen = false; }
  else view = 'edit';
  rememberDraft(); render();
  if (picker.keepOpen) {
    // Creating a custom exercise closes its form; keep keyboard focus in the flow.
    const target = document.querySelector(`[data-key="choice-${CSS.escape(exercise.id)}"]`) || document.querySelector('[data-key="library-done"]');
    target?.focus({ preventScroll: true });
  } else document.querySelector(`[data-key="name-${CSS.escape(row.id)}"]`)?.focus();
  announce(`${exercise.name} lisätty harjoitukseen.`);
}
// A library pick names a WOD movement; its amount, load and scaled version stay as they were.
function chooseWodMovement(exercise) {
  if (!exercise || !draft || picker.added.includes(exercise.id)) return;
  const w = draft.wods?.find((x) => x.id === picker.wod);
  if (!w) { view = 'edit'; render(); return; }
  let m = picker.target && w.movements.find((x) => x.id === picker.target);
  if (!m) {
    if (w.movements.length >= MAX_MOVEMENTS) { announce(`WOD-osassa voi olla enintään ${MAX_MOVEMENTS} liikettä.`); return; }
    m = editorMovement({}); w.movements.push(m);
  }
  m.name = exercise.name;
  m.sourceId = exercise.id;
  delete draft.customEntry;
  picker.added.push(exercise.id);
  if (picker.keepOpen) { picker.target = null; customOpen = false; }
  else view = 'edit';
  rememberDraft(); render();
  if (picker.keepOpen) {
    const target = document.querySelector(`[data-key="choice-${CSS.escape(exercise.id)}"]`) || document.querySelector('[data-key="library-done"]');
    target?.focus({ preventScroll: true });
  } else document.querySelector(`[data-key="mamount-${CSS.escape(m.id)}"]`)?.focus();
  announce(`${exercise.name} lisätty WOD-osaan.`);
}

function render() {
  const previous = document.activeElement;
  const key = previous?.dataset?.key;
  const selection = previous?.tagName === 'INPUT' && previous.type === 'text' ? [previous.selectionStart, previous.selectionEnd] : null;
  const scroll = window.scrollY;
  // Keep the tapped workout control where it was, so content added or removed above it cannot move the screen.
  // Safari does not focus tapped buttons, so the action's own control is the fallback anchor.
  const anchorKey = view === 'workout' ? key || actionAnchor : null;
  const anchorTop = anchorKey ? document.querySelector(`[data-key="${CSS.escape(anchorKey)}"]`)?.getBoundingClientRect().top : undefined;
  if (view === 'workout' && !state.session) view = 'home';
  if (view === 'wod' && !state.session?.wods?.some((w) => w.id === clockWodId && w.clock)) view = state.session ? 'workout' : 'home';
  if (view === 'library' && !(picker.mode === 'session' ? state.session : draft)) view = 'home';
  const changed = renderedView !== view;
  $app.className = `view-${view}`;
  $app.toggleAttribute('data-entering', changed);
  $app.innerHTML = view === 'history' ? `${brand()}${warn()}<button class="btn ghost back" data-action="home" data-key="history-back">${icon('back')} Harjoituksiin</button><div class="statistics-content">${historyView()}</div>` : view === 'records' ? `${brand()}${warn()}<button class="btn ghost back" data-action="home" data-key="records-back">${icon('back')} Harjoituksiin</button><div class="statistics-content">${recordsView(state)}</div>` : view === 'statistics' ? `${brand()}${warn()}<button class="btn ghost back" data-action="showhistory" data-key="statistics-back">${icon('back')} Historiaan</button><div class="statistics-content">${statisticsView(state, statisticsFilters)}</div>` : view === 'timer' ? timerView() : view === 'workout' ? workoutView() : view === 'wod' ? wodClockView() : view === 'library' ? libraryView() : view === 'edit' && draft ? editView() : view === 'newtype' ? newTypeView() : view === 'gallery' ? galleryView() : view === 'gymgallery' ? gymGalleryView() : homeView();
  const target = key && document.querySelector(`[data-key="${CSS.escape(key)}"]`);
  if (!changed && target) {
    target.focus({ preventScroll: true });
    if (selection) target.setSelectionRange(...selection);
  } else if (changed && renderedView) document.querySelector('h1')?.focus({ preventScroll: true });
  window.scrollTo(0, changed ? 0 : scroll);
  const anchor = !changed && anchorTop !== undefined && document.querySelector(`[data-key="${CSS.escape(anchorKey)}"]`);
  const shift = anchor ? anchor.getBoundingClientRect().top - anchorTop : 0;
  if (shift) window.scrollTo(0, window.scrollY + shift);
  renderedView = view;
  const rail = document.querySelector('.track-rail'), box = rail?.querySelector('.current');
  if (box) rail.scrollTop = box.offsetTop - (rail.clientHeight - box.offsetHeight) / 2;
  renderUpdateNotice();
  tick(); syncWakeLock();
}

// Center within usable space, not behind the sticky header or floating timer.
// Oversized exercises show the next set and its steppers instead of centering an unreadable card;
// an oversized warm-up or WOD card starts at the top. Before anything is logged, an undone warm-up comes first.
function showCurrentExercise({ focus = false, instant = false, index = null, wod = null } = {}) {
  const auto = index === null && wod === null;
  if (view !== 'workout' || !state.session || document.hidden || (auto && !storageOk)) return;
  const s = state.session;
  const warmup = auto && s.warmup && !s.warmup.done && !core.sessionHasWork(s);
  index ??= wod === null ? core.currentExercise(s) : -1;
  wod ??= index < 0 ? nextWodIndex(s) : -1;
  const id = warmup ? 'block-warmup' : index >= 0 ? `exercise-${index}` : wod >= 0 ? `wod-${wod}` : '';
  const card = id ? document.getElementById(id) : null;
  const nextSet = id.startsWith('exercise-') ? card?.querySelector('.set.next') || card?.querySelector('.set') : null;
  const viewport = window.visualViewport;
  const top = (viewport?.offsetTop ?? 0) + (document.querySelector('.session-header')?.getBoundingClientRect().height ?? 0) + 12;
  const viewportBottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight);
  const rest = document.getElementById('rest');
  const bottom = Math.min(viewportBottom, rest && !rest.hidden ? rest.getBoundingClientRect().top : viewportBottom) - 12;
  const height = Math.max(0, bottom - top);
  const target = !card ? document.querySelector('[data-action="finish"]') : card.getBoundingClientRect().height <= height || !nextSet ? card : nextSet.closest('.set-entry') || nextSet;
  if (!target || height < 48) return;
  const rect = target.getBoundingClientRect();
  if (focus) (nextSet || card?.querySelector('[data-action="blockdone"], [data-action="clockopen"], [data-action="clockstart"], [data-action="openresult"]') || firstResultField(card) || target).focus({ preventScroll: true });
  window.scrollTo({ top: Math.max(0, window.scrollY + rect.top - top - Math.max(0, (height - rect.height) / 2)), behavior: instant || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}

// The result input to type first: a time field hidden by the time cap (or a choice) never is.
function firstResultField(root) {
  return [...root?.querySelectorAll('.result-form [data-rf="min"], .result-form [data-rf="rounds"], .result-form [data-rf="reps"], .result-form [data-rf="value"]') ?? []].find((el) => !el.closest('[hidden]')) ?? null;
}

let exerciseScroll;
let scrollInteraction = 0;
function cancelExerciseScroll() { clearTimeout(exerciseScroll); scrollInteraction++; }
function scheduleExerciseScroll(sessionId, index) {
  cancelExerciseScroll();
  // Leave time to undo a mistaken last-set tap. Any new interaction cancels it.
  exerciseScroll = setTimeout(() => {
    if (state.session?.id !== sessionId || core.currentExercise(state.session) !== index) return;
    if (index < 0) {
      if (view !== 'workout' || document.hidden) return;
      if (nextWodIndex(state.session) >= 0) showCurrentExercise({ index: -1 });
      else window.scrollTo({ top: document.documentElement.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    } else showCurrentExercise();
  }, 350);
}
for (const event of ['pointerdown', 'touchstart', 'wheel', 'keydown']) {
  document.addEventListener(event, cancelExerciseScroll, { passive: true });
}

let lastRestBeep = 0;
// Transient, never persisted.
let cheer = null;
let lastCheer = '';
let actionAnchor = null;
// The open WOD result form ({ sessionId, wodId, fields } as typed), what to fix in it, and a record cheer.
let resultDraft = null;
let resultError = '';
let wodCheer = null;
const REST_NOTICE_MS = 5000;
function tick() {
  paintHr();
  paintTimer();
  paintClock();
  const elapsed = document.getElementById('elapsed');
  if (elapsed && state.session) elapsed.textContent = core.formatDuration(Date.now() - state.session.startedAt);
  const rest = document.getElementById('rest');
  if (!rest) return;
  if (!state.restEnd) { rest.hidden = true; rest.dataset.state = ''; return; }
  const left = state.restEnd - Date.now();
  // The "rest is over" notice dismisses itself after 5 seconds.
  if (left <= -REST_NOTICE_MS) { rest.hidden = true; rest.dataset.state = 'gone'; return; }
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
  const want = () => document.visibilityState === 'visible' && ((view === 'workout' || view === 'wod') && state.session || view === 'timer' && timerRun && !timerRun.done);
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
// What "unsaved changes" compares. Gym drafts compare exactly what they always have.
const draftSnapshot = (d) => JSON.stringify(d.type === 'functional'
  ? { name: d.name, exercises: d.exercises, warmup: d.warmup, wods: d.wods, cooldown: d.cooldown }
  : { name: d.name, exercises: d.exercises });
function openDraft(r, isNew) {
  draft = { ...clone(r), isNew, base: isNew ? null : JSON.stringify(r) };
  if (draft.type === 'functional') normalizeFunctionalDraft(draft);
  draft.initial = draftSnapshot(draft);
  openScaled.clear();
  view = 'edit'; editError = ''; rememberDraft(); render();
}
function swap(i, direction) {
  const target = i + direction;
  if (target < 0 || target >= draft.exercises.length) return;
  [draft.exercises[i], draft.exercises[target]] = [draft.exercises[target], draft.exercises[i]];
  rememberDraft(); render(); announce(`Liike siirretty kohtaan ${target + 1}.`);
}
function moveMovement(t, direction) {
  const w = draft?.wods?.[+t.dataset.w], i = +t.dataset.m, target = i + direction;
  if (!w || target < 0 || target >= w.movements.length) return;
  const id = w.movements[i].id, hadFocus = document.activeElement === t;
  [w.movements[i], w.movements[target]] = [w.movements[target], w.movements[i]];
  rememberDraft(); render();
  // At the first or last place the pressed arrow turns disabled; keep focus on the moved movement.
  const pressed = document.querySelector(`[data-key="${CSS.escape(`${direction < 0 ? 'mup' : 'mdown'}-${id}`)}"]`);
  if (hadFocus && pressed?.disabled) document.querySelector(`[data-key="${CSS.escape(`${direction < 0 ? 'mdown' : 'mup'}-${id}`)}"]`)?.focus();
  announce(`Liike siirretty kohtaan ${target + 1}.`);
}
function sessionOptions() { return { sessionId: state.session?.id }; }

async function changeRevision(id, undo = false) {
  let result;
  const ok = await mutate((next) => {
    result = undo ? undoRevision(next, id) : reviseRoutine(next, id);
    return result.ok;
  }, { critical: true });
  const message = ok || !result?.ok ? result?.message : 'Tarkistusta ei voitu tallentaa. Edelliset tavoitteet säilyvät; yritä uudelleen.';
  revisionMessages.set(id, message || 'Tarkistus ei onnistunut. Tarkista tallennuksen tila.');
  openRoutines.add(id);
  render(); announce(revisionMessages.get(id));
}

function logInput(t) {
  const field = t.dataset.log;
  const value = t.type === 'checkbox' ? t.checked : t.value.trim();
  const numericLimit = ({ rir: 5, setRir: 5, actualReps: core.MAX_REPS, actualSeconds: 86400 })[field];
  const valid = !t.validity.badInput && (numericLimit === undefined || value === '' ||
    (/^\d+$/.test(value) && Number(value) <= numericLimit)) &&
    (field !== 'kind' || ['', 'working', 'warmup'].includes(value));
  if (!valid) {
    logError = 'Tarkista sarjan tiedot: toistot 0–9999, RIR 0–5 ja kesto 0–86400 sekuntia kokonaislukuina. Tyhjä tarkoittaa tuntematonta.';
    announce(logError); render(); return;
  }
  const options = sessionOptions(), ei = +t.dataset.e, si = +t.dataset.s;
  enqueueAction(async () => {
    logError = '';
    await mutate((next) => {
      const target = ['rir', 'pain'].includes(field) ? next.session?.exercises[ei] : next.session?.exercises[ei]?.sets[si];
      if (!target) { announce('Kirjattavaa sarjaa ei enää löytynyt. Tarkista harjoitus.'); return false; }
      if (value === '' || value === false) delete target[field];
      else target[field] = value;
    }, { ...options, patch: () => patchLoggedSet(ei, si) });
  });
}

// Typing a value replaces the stepper's readout in place; Enter or leaving the field saves it.
function openStepInput(button, kind) {
  const numeric = kind === 'reps' || !!button.querySelector('small');
  const input = document.createElement('input');
  input.type = 'text'; input.className = 'step-input';
  input.inputMode = kind === 'weight' ? 'decimal' : 'numeric';
  input.maxLength = 12;
  input.value = numeric ? button.querySelector('b').textContent : '';
  input.defaultValue = input.value;
  Object.assign(input.dataset, { stepInput: kind, e: button.dataset.e, s: button.dataset.s, key: button.dataset.key });
  input.setAttribute('aria-label', button.getAttribute('aria-label'));
  button.replaceWith(input);
  input.focus(); input.select();
}

function commitStepInput(input, cancel = false) {
  if (input.dataset.committed) return;
  input.dataset.committed = '1';
  const kind = input.dataset.stepInput, ei = +input.dataset.e, si = +input.dataset.s, value = input.value;
  if (cancel || value.trim() === input.defaultValue.trim()) { patchLoggedSet(ei, si); return; }
  const options = sessionOptions();
  enqueueAction(() => mutate((next) => {
    const result = kind === 'weight' ? core.setSetWeight(next.session, ei, si, value) : core.setSetReps(next.session, ei, si, value);
    if (!result.ok) { logError = result.error; announce(logError); render(); return false; }
    logError = '';
    const name = next.session.exercises[ei].name;
    announce(kind === 'weight' ? `${name}, sarja ${si + 1}: ${String(result.weight).replace('.', ',')} kg. Tavoite s\u00e4ilyy ennallaan.` : `${name}, sarja ${si + 1}: ${result.reps} toteutunutta toistoa. Tavoite s\u00e4ilyy ennallaan.`);
  }, { ...options, patch: () => patchLoggedSet(ei, si) }));
}
document.addEventListener('keydown', (e) => {
  if (!e.target.dataset?.stepInput) return;
  if (e.key === 'Enter') { e.preventDefault(); commitStepInput(e.target); }
  else if (e.key === 'Escape') { e.preventDefault(); commitStepInput(e.target, true); }
});
document.addEventListener('focusout', (e) => { if (e.target.dataset?.stepInput) commitStepInput(e.target); });

function downloadBackup(text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })), a = document.createElement('a');
  a.href = url; a.download = core.backupFileName(); a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return true;
}

// Installed iOS apps often drop blob downloads silently, so use the share sheet there.
// Returns true (shared), false (cancelled), or null (use a normal download instead).
async function shareBackup(text) {
  const installed = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone;
  if (!installed || !/iPad|iPhone|iPod/.test(navigator.userAgent) && !(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return null;
  try {
    const file = new File([text], core.backupFileName(), { type: 'application/json' });
    if (!navigator.canShare?.({ files: [file] })) return null;
    await navigator.share({ files: [file], title: 'Treenipäiväkirjan varmuuskopio' });
    return true;
  } catch (error) { return error?.name === 'AbortError' ? false : null; }
}

// Työ / Lepo quick-add: a named interval with the saved (or factory) duration for that kind.
function addPresetInterval(kind) {
  if (!timerDraft || timerDraft.intervals.length >= TIMER_MAX_INTERVALS) return;
  const { label } = TIMER_PRESETS[kind], seconds = presetSeconds(state.timerDefaults, kind);
  timerDraft.intervals.push(newInterval(label, seconds));
  render();
  document.querySelector(`[data-key="timer-${kind}"]`)?.scrollIntoView({ block: 'nearest' });
  announce(`${label}-intervalli lisätty, ${formatLength(seconds)}.`);
}

const actions = {
  async autobackupgrant() {
    const ab = autoBackup;
    if (!ab.handle) return;
    ab.permission = await autobackup.permission(ab.handle, true);
    paintAutoBackup();
    if (ab.permission === 'granted') void runAutoBackup();
  },
  autobackupfolder() { return chooseAutoFolder(); },
  statistics() { readLatest(); view = 'statistics'; render(); },
  showhistory() { readLatest(); view = 'history'; render(); },
  timer() { readLatest(); timerDraft = null; timerError = ''; view = 'timer'; render(); },
  timernew() {
    timerDraft = { id: null, name: '', repeats: '1', intervals: [newInterval()] }; timerError = '';
    render(); window.scrollTo(0, 0); document.querySelector('h1')?.focus({ preventScroll: true });
  },
  timeredit(t) {
    readLatest();
    const timer = (state.timers ?? []).find((x) => x.id === t.dataset.id);
    if (!timer) { render(); announce('Sarjaa ei löytynyt. Näkymä on päivitetty.'); return; }
    timerDraft = draftFrom(timer); timerError = '';
    render(); window.scrollTo(0, 0); document.querySelector('h1')?.focus({ preventScroll: true });
  },
  timeraddint() {
    if (!timerDraft || timerDraft.intervals.length >= TIMER_MAX_INTERVALS) return;
    timerDraft.intervals.push(newInterval()); render();
    document.querySelector(`[data-key="tl-${timerDraft.intervals.length - 1}"]`)?.focus();
  },
  timeraddwork() { addPresetInterval('work'); },
  timeraddrest() { addPresetInterval('rest'); },
  async timerdefault(t) {
    if (!timerDraft) return;
    const n = +t.dataset.i, kind = presetKind(timerDraft.intervals[n]?.label);
    if (!kind) return;
    timerError = '';
    const parsed = intervalSeconds(timerDraft.intervals[n], n);
    let failed = parsed.error ?? '';
    if (!failed && !await mutate((next) => { next.timerDefaults = { ...next.timerDefaults, [kind]: parsed.seconds }; }, { critical: true })) {
      failed = 'Oletusta ei voitu tallentaa. Tarkista tallennuksen tila ja yritä uudelleen.';
    }
    timerError = failed;
    render();
    if (failed) { document.getElementById('timer-err')?.focus(); return; }
    announce(`${kind === 'work' ? 'Työn' : 'Levon'} oletuskesto on nyt ${formatLength(parsed.seconds)}.`);
  },
  timerdelint(t) {
    if (!timerDraft || timerDraft.intervals.length < 2) return;
    timerDraft.intervals.splice(+t.dataset.i, 1); render();
    document.querySelector('[data-key="timer-add"]')?.focus({ preventScroll: true });
    announce('Intervalli poistettu.');
  },
  timercancel() {
    timerDraft = null; timerError = ''; render(); window.scrollTo(0, 0); document.querySelector('h1')?.focus({ preventScroll: true });
  },
  async timersave() {
    if (!timerDraft) return;
    timerError = '';
    let saved = null;
    const ok = await mutate((next) => {
      const list = next.timers ?? [];
      const result = buildTimer(timerDraft, list);
      if (result.error) { timerError = result.error; return false; }
      const index = list.findIndex((x) => x.id === result.timer.id);
      if (index >= 0) list[index] = result.timer;
      else if (list.length >= TIMER_MAX_SEQUENCES) { timerError = `Sarjoja voi olla enintään ${TIMER_MAX_SEQUENCES}. Poista ensin jokin sarja.`; return false; }
      else list.push(result.timer);
      next.timers = list; saved = result.timer;
    }, { critical: true });
    if (ok && saved) {
      timerDraft = null; render(); window.scrollTo(0, 0); document.querySelector('h1')?.focus({ preventScroll: true });
      announce(`Sarja ${saved.name} tallennettu.`);
    } else {
      timerError ||= 'Sarjaa ei voitu tallentaa. Tarkista tallennuksen tila ja yritä uudelleen.';
      render(); document.getElementById('timer-err')?.focus();
    }
  },
  async timerdelete(t) {
    readLatest();
    const timer = (state.timers ?? []).find((x) => x.id === t.dataset.id);
    if (!timer) { render(); return; }
    if (!await askConfirm(`Poistetaanko ajastinsarja "${timer.name}"?`, 'Poista')) return;
    const ok = await mutate((next) => { next.timers = (next.timers ?? []).filter((x) => x.id !== timer.id); }, { critical: true });
    render();
    if (ok) { announce(`Sarja ${timer.name} poistettu.`); document.querySelector('[data-key="timernew"]')?.focus({ preventScroll: true }); }
  },
  timerstart(t) {
    readLatest();
    const timer = (state.timers ?? []).find((x) => x.id === t.dataset.id);
    if (!timer) { render(); announce('Sarjaa ei löytynyt. Näkymä on päivitetty.'); return; }
    prepareAudio();
    timerRun = { id: timer.id, startedAt: Date.now(), pausedAt: null, pausedMs: 0, done: false };
    timerCue = ''; rememberTimerRun();
    render(); window.scrollTo(0, 0); document.querySelector('h1')?.focus({ preventScroll: true });
  },
  timerpause() {
    if (!timerRun || timerRun.pausedAt) return;
    timerRun.pausedAt = Date.now(); rememberTimerRun(); render(); announce('Ajastin tauolla.');
  },
  timerresume() {
    if (!timerRun?.pausedAt) return;
    prepareAudio();
    timerRun.pausedMs += Date.now() - timerRun.pausedAt; timerRun.pausedAt = null; rememberTimerRun(); render(); announce('Ajastin jatkuu.');
  },
  timerskip() {
    const timer = timerRun && (state.timers ?? []).find((x) => x.id === timerRun.id);
    if (!timer) return;
    const phase = phaseAt(timer, runElapsed(timerRun, Date.now()));
    if (phase.done) return;
    timerRun.startedAt -= phase.remainingMs; rememberTimerRun(); render();
    announce('Siirryttiin seuraavaan intervalliin.');
  },
  async timerstop() {
    if (timerRun && !timerRun.done && !await askConfirm('Lopetetaanko ajastin?', 'Lopeta')) return;
    timerRun = null; rememberTimerRun(); render();
    window.scrollTo(0, 0); document.querySelector('h1')?.focus({ preventScroll: true });
  },
  records() { readLatest(); view = 'records'; render(); },
  homeperiod() {
    homePeriod = HOME_PERIODS[(HOME_PERIODS.indexOf(homePeriod) + 1) % HOME_PERIODS.length];
    try { localStorage.setItem(HOME_PERIOD_KEY, homePeriod); } catch { /* Display preference only. */ }
    render();
  },
  statrange(t) { statisticsFilters.range = t.dataset.range; statisticsFilters.page = 0; render(); },
  statpage(t) { statisticsFilters.page = Math.max(0, Number(t.dataset.page)); render(); },
  statexercise(t) {
    statisticsFilters.exerciseKey = t.dataset.id; statisticsFilters.page = 0; render();
    document.querySelector('.stat-filters')?.scrollIntoView({ block: 'start' });
  },
  indexsettings() {
    const panel = document.getElementById('index-settings');
    if (panel) { panel.open = true; panel.querySelector('summary').focus(); panel.scrollIntoView({ block: 'start' }); }
  },
  async saveindex() {
    const keys = [...document.querySelectorAll('input[name="benchmark"]:checked')].map((t) => t.value);
    if (state.statistics && !await askConfirm('Aloitetaanko uusi indeksivertailu nykyisistä tuloksista? Vanha indeksin lähtötaso korvataan. Harjoitushistoria säilyy.', 'Aloita uusi')) return;
    let message = '';
    const ok = await mutate((next) => {
      const result = configureIndex(buildStatistics(next.history), keys);
      if (!result.ok) { message = result.error; return false; }
      next.statistics = result.index;
    }, { critical: true });
    announce(ok ? 'Kehitysindeksin lähtötaso tallennettu. Harjoitushistoria säilyy.' : message || 'Indeksiä ei voitu tallentaa. Tarkista tallennuksen tila.');
  },
  async installupdate() { await installUpdate(); },
  laterupdate() { updateDismissed = true; renderUpdateNotice(); announce('Päivitys siirretty myöhemmäksi.'); },
  async checkupdates() {
    updateError = ''; updateDismissed = false;
    if (!navigator.onLine) updateFailed('Yhdistä verkkoon päivitysten tarkistamiseksi. Voit jatkaa nykyisen version käyttöä.');
    else await registerUpdates();
  },
  autorange(t) {
    const exercise = draft.exercises[+t.dataset.i];
    const config = progressionConfig(exercise);
    exercise.progression = { weightStep: config.weightStep, autoLoad: config.autoLoad };
    const range = progressionConfig(exercise);
    rememberDraft();
    render();
    const button = document.querySelector(`[data-key="autorange-${CSS.escape(exercise.id)}"]`);
    button.closest('.progression-editor').open = true;
    button.focus({ preventScroll: true });
    const message = `Toistoalue valittu automaattisesti: ${range.minReps}–${range.maxReps} toistoa. Paina "Tallenna harjoitus" tallentaaksesi muutoksen.`;
    const note = document.createElement('p');
    note.className = 'notice small-copy';
    note.textContent = message;
    button.after(note);
    announce(message);
  },
  async revise(t) { await changeRevision(t.dataset.id); },
  async undorevision(t) { await changeRevision(t.dataset.id, true); },
  async start(t) {
    // Ask before taking the cross-tab write lock so a dialog cannot block other tabs.
    readLatest();
    const mode = ['light', 'super'].includes(t.dataset.mode) ? t.dataset.mode : 'normal';
    let confirmed = false;
    if (state.session) {
      if (!await askConfirm('Korvataanko keskeneräinen harjoitus? Sen kirjaukset menetetään.', 'Korvaa')) return;
      confirmed = true;
    }
    await mutate((next) => {
      if (next.session && !confirmed) { announce(CHANGED_ELSEWHERE); render(); return false; }
      const session = core.startSession(byId(t.dataset.id, next), Date.now(), { mode, history: next.history });
      if (!session) { announce('Lisää ensin vähintään yksi liike.'); return false; }
      next.session = session; next.restEnd = null;
    });
    if (state.session) { view = 'workout'; savedId = null; resultDraft = null; resultError = ''; wodCheer = null; clockWodId = null; wodCue = null; render(); }
  },
  resume() {
    const running = runningClock();
    if (running) { prepareAudio(); clockWodId = running.id; view = 'wod'; render(); return; }
    view = 'workout'; render(); showCurrentExercise({ focus: true });
  },
  morehistory() { historyLimit += 20; render(); },
  edithistory(t) {
    historyEditing = historyEditing === t.dataset.id ? null : t.dataset.id;
    historyMessage = ''; render();
  },
  async confirmhistoryreps(t) {
    readLatest();
    const id = t.dataset.id, ei = +t.dataset.e, exercise = state.history.find((h) => h.id === id)?.exercises?.[ei];
    const suggestions = core.historyRepSuggestions(exercise), before = JSON.stringify(exercise);
    if (!suggestions.length) { render(); return; }
    if (!await askConfirm(`${exercise.name}: ${suggestions.map(({ si, reps }) => `sarja ${si + 1}: ${reps} toistoa`).join(', ')}. Vahvista vain, jos teit nämä toistot. Muut tulokset ja tekemättömät sarjat säilyvät.`, 'Vahvista toistot')) return;
    const ok = await mutate((next) => {
      if (JSON.stringify(next.history.find((h) => h.id === id)?.exercises?.[ei]) !== before) { historyMessage = CHANGED_ELSEWHERE; return false; }
      const result = core.confirmHistoryReps(next, id, ei);
      if (!result.ok) historyMessage = result.error;
      return result.ok;
    }, { critical: true });
    if (ok) historyMessage = 'Toteutuneet toistot vahvistettu. Muut harjoitustiedot säilyvät.';
    render();
  },
  async clearhistorywod(t) {
    readLatest();
    const id = t.dataset.id, wi = +t.dataset.w, w = state.history.find((h) => h.id === id)?.wods?.[wi];
    if (!w) { announce('WOD-osaa ei löytynyt. Näkymä on päivitetty.'); render(); return; }
    if (!await askConfirm(`Poistetaanko WOD-tulos "${w.name}" historiasta? Se poistuu myös ennätyksistä. Muut kirjaukset säilyvät.`, 'Poista tulos')) return;
    let result = null;
    const ok = await mutate((next) => {
      result = core.editHistoryWod(next, id, wi, null);
      if (!result.ok) return false;
    }, { critical: true });
    historyMessage = ok && result?.ok ? '' : result?.error ?? 'Muutosta ei voitu tallentaa. Yritä uudelleen.';
    render();
    announce(historyMessage || 'Tulos poistettu.');
    document.querySelector(`[data-key^="hwod-${wi}-"]`)?.focus({ preventScroll: true });
  },
  fixsaved() {
    historyEditing = savedId; savedId = null; historyMessage = ''; view = 'history';
    render(); document.querySelector(`[data-hist="${CSS.escape(historyEditing)}"]`)?.scrollIntoView({ block: 'center' });
    document.querySelector(`[data-key="hedit-${CSS.escape(historyEditing)}"]`)?.focus({ preventScroll: true });
  },
  closesaved() { savedId = null; render(); },
  async delhistory(t) {
    readLatest();
    const h = state.history.find((x) => x.id === t.dataset.id);
    if (!h) { announce('Harjoitusta ei löytynyt. Näkymä on päivitetty.'); render(); return; }
    if (!await askConfirm(`Poistetaanko harjoitus "${h.name}" (${historyDate(h.endedAt)}) historiasta? Se poistuu myös tilastoista. Voit perua poiston heti sen jälkeen.`, 'Poista')) return;
    let removed = null;
    const ok = await mutate((next) => {
      const result = core.deleteHistoryEntry(next, h.id);
      if (!result.ok) { announce(result.error); return false; }
      removed = result;
    }, { critical: true });
    if (!ok || !removed) { render(); return; }
    lastDeleted = { entry: removed.entry, index: removed.index };
    if (historyEditing === h.id) historyEditing = null;
    if (savedId === h.id) savedId = null;
    historyMessage = ''; render(); announce(`Harjoitus "${h.name}" poistettu. Voit perua poiston.`);
    document.querySelector('[data-key="undodelete"]')?.focus({ preventScroll: true });
  },
  async undodelete() {
    if (!lastDeleted) return;
    const { entry, index } = lastDeleted;
    let result;
    const ok = await mutate((next) => { result = core.restoreHistoryEntry(next, entry, index); return result.ok; }, { critical: true });
    if (ok) { lastDeleted = null; historyLimit = Math.max(historyLimit, index + 1); historyMessage = ''; announce('Poisto peruttu.'); }
    else historyMessage = result?.error ?? 'Poistoa ei voitu perua. Yritä uudelleen.';
    render();
  },
  async home() {
    if (timerRun && !timerRun.done && !await askConfirm('Pysäytetäänkö ajastin?', 'Pysäytä')) return;
    timerRun = null; timerDraft = null; timerError = ''; rememberTimerRun();
    if (draft && draftSnapshot(draft) !== draft.initial && !await askConfirm('Hylätäänkö harjoituksen tallentamattomat muutokset?', 'Hylkää')) return;
    clearDraft(); view = 'home'; render();
  },
  async retry() {
    // Keep pending in-memory progress; the write lock prevents another simultaneous write.
    await mutate(() => {}, { critical: true });
    if (storageOk) announce('Edistyminen tallennettu.');
  },
  async reloadsaved() {
    if (!await askConfirm('Korvataanko tämän välilehden tallentamattomat muutokset tallennetulla versiolla? Vie muutokset ensin talteen, jos haluat säilyttää molemmat.', 'Lataa tallennettu')) return;
    dirty = false; saveConflict = false; storageOk = true; readLatest(); render();
  },
  async set(t) {
    let advance = null, logged = false;
    const interaction = scrollInteraction;
    const target = { e: t.dataset.e, s: t.dataset.s };
    const ok = await mutate((next) => {
      const ei = +t.dataset.e, si = +t.dataset.s, ex = next.session?.exercises[ei];
      if (!ex?.sets[si]) return false;
      const current = core.currentExercise(next.session);
      const done = core.toggleSet(next.session, ei, si, { logReps: true });
      logged = done;
      const restSeconds = core.restFor(next.settings, ex, si);
      cheer = null;
      if (done) {
        navigator.vibrate?.(15);
        const p = core.progress(next.session);
        next.restEnd = next.settings.autoRest && p.done < p.total ? Date.now() + restSeconds * 1000 : null;
        const following = core.currentExercise(next.session);
        if (ei === current && following > current) advance = { sessionId: next.session.id, index: following };
        else if (p.done === p.total) advance = { sessionId: next.session.id, index: -1 };
        // Show the cheer where the user looks next: right below the tapped set, or above the sets of the exercise the view advances to.
        const text = next.settings.cheers === false ? '' : pickCheer(p.done, p.total, lastCheer);
        if (text) { cheer = { sessionId: next.session.id, exerciseId: next.session.exercises[advance && advance.index >= 0 ? advance.index : ei].id, after: advance && advance.index >= 0 ? -1 : si, text }; lastCheer = text; }
      }
      announce(`${ex.name}, sarja ${si + 1} ${done ? 'tehty' : 'kirjaus peruttu'}.${done && next.restEnd ? ` Lepoajastin käynnistyi, ${restSeconds} sekuntia.` : ''}${cheer ? ` ${cheer.text}` : ''}`);
    }, sessionOptions());
    // Lets an alternate look play a one-shot confirmation on the set the user just logged (never on later redraws).
    if (ok && logged) document.querySelector(`[data-action="set"][data-e="${target.e}"][data-s="${target.s}"]`)?.classList.add('just-logged');
    if (ok && advance && storageOk && interaction === scrollInteraction) scheduleExerciseScroll(advance.sessionId, advance.index);
  },
  async adjustreps(t) {
    await mutate((next) => {
      const ei = +t.dataset.e, si = +t.dataset.s;
      const result = core.adjustSetReps(next.session, ei, si, +t.dataset.delta);
      if (!result.ok) { logError = result.error; announce(logError); render(); return false; }
      logError = '';
      announce(`${next.session.exercises[ei].name}, sarja ${si + 1}: ${result.reps} toteutunutta toistoa. Tavoite säilyy ennallaan.`);
    }, sessionOptions());
  },
  async adjustweight(t) {
    await mutate((next) => {
      const ei = +t.dataset.e, si = +t.dataset.s;
      const result = core.adjustSetWeight(next.session, ei, si, +t.dataset.delta);
      if (!result.ok) { logError = result.error; announce(logError); render(); return false; }
      logError = '';
      announce(`${next.session.exercises[ei].name}, sarja ${si + 1}: ${String(result.weight).replace('.', ',')} kg. Tavoite säilyy ennallaan.`);
    }, sessionOptions());
  },
  async exrir(t) {
    const ei = +t.dataset.e, value = t.dataset.value;
    await mutate((next) => {
      const exercise = next.session?.exercises[ei];
      if (!exercise) { announce('Kirjattavaa liikettä ei enää löytynyt. Tarkista harjoitus.'); return false; }
      logError = '';
      // Tapping the chosen value again clears it; empty means unknown.
      if (exercise.rir === value) { delete exercise.rir; announce(`${exercise.name}: RIR tyhjennetty.`); }
      else { exercise.rir = value; announce(`${exercise.name}: RIR ${value}.`); }
    }, { ...sessionOptions(), patch: () => patchExerciseRir(ei) });
  },
  editreps(t) { openStepInput(t, 'reps'); },
  editweight(t) { openStepInput(t, 'weight'); },
  async addset(t) { await mutate((next) => core.addSet(next.session, +t.dataset.e), sessionOptions()); },
  async rmset(t) {
    readLatest();
    const shown = state.session?.exercises[+t.dataset.e];
    let confirmed = false;
    if (shown?.sets.length > 1 && shown.sets.at(-1).done) {
      if (!await askConfirm('Poistetaanko tehty sarja? Myös sen suoritusmerkintä poistuu.', 'Poista')) return;
      confirmed = true;
    }
    await mutate((next) => {
      const ex = next.session?.exercises[+t.dataset.e];
      if (!ex || ex.sets.length < 2) return false;
      if (ex.sets.at(-1).done && !confirmed) { announce(CHANGED_ELSEWHERE); render(); return false; }
      core.removeSet(next.session, +t.dataset.e);
      const p = core.progress(next.session); if (p.done === p.total) next.restEnd = null;
    }, sessionOptions());
  },
  async skiprest() { await mutate((next) => { next.restEnd = null; }, sessionOptions()); },
  async plus() { await mutate((next) => { next.restEnd = Math.max(next.restEnd || 0, Date.now()) + 30000; }, sessionOptions()); },
  async finish() {
    let revisionResult, routineId, newId = null;
    readLatest();
    let confirmed = false;
    if (state.session) {
      const shown = core.progress(state.session), sets = shown.total - shown.done, wods = shown.wodsTotal - shown.wodsDone;
      if (sets || wods) {
        const none = !core.sessionHasWork(state.session);
        const message = !isFunctional(state.session)
          ? none ? 'Yhtään sarjaa ei ole kirjattu, joten harjoitusta ei tallenneta historiaan. Lopetetaanko ilman tallennusta?' : `${sets} sarjaa on tekemättä. Lopetetaanko silti?`
          : none ? 'Mitään ei ole vielä kirjattu, joten harjoitusta ei tallenneta historiaan. Lopetetaanko ilman tallennusta?'
            : `Kirjaamatta: ${[sets ? (sets === 1 ? '1 sarja' : `${sets} sarjaa`) : '', wods ? (wods === 1 ? '1 WOD-osa' : `${wods} WOD-osaa`) : ''].filter(Boolean).join(' ja ')}. Lopetetaanko silti?`;
        if (!await askConfirm(message, none ? 'Lopeta tallentamatta' : 'Lopeta')) return;
        confirmed = true;
      }
    }
    const ok = await mutate((next) => {
      if (!next.session) return false;
      const p = core.progress(next.session);
      if ((p.done < p.total || p.wodsDone < p.wodsTotal) && !confirmed) { announce(CHANGED_ELSEWHERE); render(); return false; }
      routineId = next.session.routineId;
      if (core.sessionHasWork(next.session)) { const summary = core.summarize(next.session, Date.now(), hrAcc.id === next.session.id ? summarizeHr(hrAcc) : null); newId = summary.id; next.history.unshift(summary); }
      next.history = next.history.slice(0, core.MAX_HISTORY); next.session = null; next.restEnd = null;
      if (p.done && byId(routineId, next)?.autoProgress) revisionResult = reviseRoutine(next, routineId);
    }, { ...sessionOptions(), critical: true });
    if (ok) {
      resetHr();
      resultDraft = null; resultError = ''; wodCheer = null; clockWodId = null; wodCue = null;
      if (revisionResult) { revisionMessages.set(routineId, revisionResult.message); openRoutines.add(routineId); }
      view = 'home'; savedId = newId; historyEditing = null; historyMessage = ''; render();
      announce(newId ? `Harjoitus tallennettu. Hienoa työtä! ${revisionResult?.message ?? ''}` : 'Harjoitus lopetettu. Mitään ei tallennettu historiaan.');
    }
  },
  async discard() {
    if (!await askConfirm('Hylätäänkö harjoitus? Suoritusmerkinnät menetetään.', 'Hylkää')) return;
    if (await mutate((next) => { next.session = null; next.restEnd = null; }, { ...sessionOptions(), critical: true })) { resetHr(); resultDraft = null; resultError = ''; wodCheer = null; clockWodId = null; wodCue = null; view = 'home'; render(); }
  },
  hrconnect() { void hr.connect(); },
  hrdisconnect() {
    try { localStorage.removeItem(HR_DEVICE_KEY); } catch { /* Auto-reconnect is optional. */ }
    void hr.disconnect();
  },
  new() { view = 'newtype'; editError = ''; render(); },
  newgym() { openDraft({ id: core.uid(), name: '', exercises: [blankEx()] }, true); },
  newfunctional() { openDraft({ id: core.uid(), name: '', type: 'functional', exercises: [], warmup: null, wods: [newEditorWod()], cooldown: null }, true); },
  newtemplate() { view = 'gallery'; render(); },
  newgymprogram() { view = 'gymgallery'; render(); },
  usegymprogram(t) {
    const program = gymProgramById(t.dataset.program);
    if (program) openDraft(core.sanitizeRoutine(gymProgramRoutine(program, core.uid)), true);
  },
  galleryback() { const gym = view === 'gymgallery'; view = 'newtype'; render(); document.querySelector(`[data-key="${gym ? 'newgymprogram' : 'newtemplate'}"]`)?.focus(); },
  templategroup(t) {
    if (!isTemplateGroup(t.dataset.group) || t.dataset.group === galleryGroup) return;
    galleryGroup = t.dataset.group; render();
    // Safari does not focus tapped buttons, so keep keyboard and screen-reader users on the toggle they pressed.
    document.querySelector(`[data-key="${CSS.escape(t.dataset.key)}"]`)?.focus({ preventScroll: true });
    announce(`${TEMPLATE_GROUPS[galleryGroup]}: ${TEMPLATES.filter((x) => x.group === galleryGroup).length} mallia.`);
  },
  templatesex(t) {
    if (!isSex(t.dataset.sex) || t.dataset.sex === templateSex) return;
    templateSex = t.dataset.sex;
    try { localStorage.setItem(TEMPLATE_SEX_KEY, templateSex); } catch { /* Display preference only. */ }
    render();
    document.querySelector(`[data-key="${CSS.escape(t.dataset.key)}"]`)?.focus({ preventScroll: true });
    announce(`Kuormat päivitetty: ${SEXES[templateSex]}.`);
  },
  usetemplate(t) {
    const template = templateById(t.dataset.template);
    if (template) openDraft(core.sanitizeRoutine(templateRoutine(template, templateSex)), true);
  },
  edit(t) { const r = byId(t.dataset.id); if (r) openDraft(r, false); },
  addex() { if (draft.exercises.length >= 60) return; openLibrary(draft.exercises.find((e) => !e.name.trim())?.id ?? null); },
  pickex(t) { openLibrary(t.dataset.id, false); },
  backedit() {
    if (picker.mode === 'session') {
      const target = picker.target;
      view = 'workout'; render();
      if (target) { const index = state.session?.exercises.findIndex((e) => e.id === target); if (index >= 0) showCurrentExercise({ index, instant: true }); }
      return;
    }
    view = 'edit'; render();
    if (picker.mode === 'wod') {
      const w = draft?.wods?.find((x) => x.id === picker.wod), last = w?.movements.at(-1);
      const back = picker.target && w?.movements.some((m) => m.id === picker.target) ? `pickmove-${picker.target}` : `addmovelib-${picker.wod}`;
      (document.querySelector(`[data-key="${CSS.escape(back)}"]:not(:disabled)`) ?? (last && document.querySelector(`[data-key="${CSS.escape(`pickmove-${last.id}`)}"]`)))?.focus();
      return;
    }
    document.querySelector(picker.target ? `[data-key="pick-${CSS.escape(picker.target)}"]` : '[data-key="addex"]')?.focus(); },
  addwod() {
    if (draft?.type !== 'functional' || draft.wods.length >= MAX_WODS) return;
    const w = newEditorWod();
    draft.wods.push(w);
    rememberDraft(); render();
    document.querySelector(`[data-key="${CSS.escape(`wodformat-${w.id}-${w.format}`)}"]`)?.focus();
    announce(`${wodPartLabel(draft.wods.length - 1, draft.wods.length)} lisätty. Valitse muoto.`);
  },
  async rmwod(t) {
    const w = draft?.wods?.[+t.dataset.w];
    if (!w || draft.wods.length < 2) return;
    const label = wodPartLabel(draft.wods.indexOf(w), draft.wods.length);
    if (w.movements.some((m) => m.name.trim()) && !await askConfirm(`Poistetaanko ${label} liikkeineen?`, 'Poista')) return;
    const at = draft?.wods?.indexOf(w) ?? -1;
    if (at < 0) return;
    draft.wods.splice(at, 1);
    for (const m of w.movements) openScaled.delete(m.id);
    rememberDraft(); render();
    document.querySelector('[data-key="addwod"]')?.focus();
    announce(`${label} poistettu.`);
  },
  addmove(t) {
    const w = draft?.wods?.[+t.dataset.w];
    if (!w || w.movements.length >= MAX_MOVEMENTS) return;
    const m = editorMovement({});
    w.movements.push(m);
    rememberDraft(); render();
    document.querySelector(`[data-key="${CSS.escape(`mname-${m.id}`)}"]`)?.focus();
  },
  addmovelib(t) {
    const w = draft?.wods?.[+t.dataset.w];
    if (w) openLibrary(w.movements.find((m) => !m.name.trim())?.id ?? null, true, w.id);
  },
  pickmove(t) {
    const w = draft?.wods?.[+t.dataset.w];
    if (w?.movements.some((m) => m.id === t.dataset.id)) openLibrary(t.dataset.id, false, w.id);
  },
  rmmove(t) {
    const w = draft?.wods?.[+t.dataset.w], m = w?.movements[+t.dataset.m];
    if (!m) return;
    w.movements.splice(+t.dataset.m, 1);
    openScaled.delete(m.id);
    rememberDraft(); render();
    document.querySelector(`[data-key="${CSS.escape(`addmove-${w.id}`)}"]`)?.focus();
    announce(`Liike ${+t.dataset.m + 1} poistettu.`);
  },
  moveup(t) { moveMovement(t, -1); },
  movedown(t) { moveMovement(t, 1); },
  scheme(t) {
    const w = draft?.wods?.[+t.dataset.w];
    if (w?.format !== 'fortime') return;
    const chosen = t.dataset.scheme, same = (parseScheme(w.scheme) ?? []).join('-') === chosen;
    w.scheme = same ? '' : chosen;
    rememberDraft(); render();
    announce(same ? 'Toistokaava poistettu.' : `Toistokaava ${chosen}: ${parseScheme(chosen).length} kierrosta.`);
  },
  tabata(t) {
    const w = draft?.wods?.[+t.dataset.w];
    if (w?.format !== 'intervals') return;
    Object.assign(w, { work: '20', rest: '10', rounds: '8' });
    rememberDraft(); render();
    announce('Tabata asetettu: 8 kierrosta, 20 s työtä ja 10 s lepoa.');
  },
  addblock(t) {
    const kind = t.dataset.block;
    if (draft?.type !== 'functional' || !BLOCK_KINDS.includes(kind) || draft[kind]) return;
    draft[kind] = newBlock(kind);
    rememberDraft(); render();
    document.querySelector(`[data-key="btext-${kind}"]`)?.focus();
  },
  rmblock(t) {
    const kind = t.dataset.block;
    if (draft?.type !== 'functional' || !BLOCK_KINDS.includes(kind)) return;
    draft[kind] = null;
    rememberDraft(); render();
    document.querySelector(`[data-key="addblock-${kind}"]`)?.focus();
    announce(kind === 'warmup' ? 'Lämmittely poistettu.' : 'Loppuverryttely poistettu.');
  },
  chooseex(t) { return chooseExercise([...EXERCISES, ...state.customExercises].find((e) => e.id === t.dataset.id)); },
  swapex(t) { openSessionLibrary(t.dataset.id); },
  addsessionex() { openSessionLibrary(null); },
  async rmsessionex(t) {
    readLatest();
    const id = t.dataset.id;
    const shown = state.session?.exercises.find((e) => e.id === id);
    if (!shown) { announce(CHANGED_ELSEWHERE); render(); return; }
    const confirmedLogged = core.loggedSetCount(shown);
    if (confirmedLogged && !await askConfirm(`Poistetaanko ${shown.name}? Sen ${confirmedLogged} kirjattua sarjaa poistuvat myös historiasta. Ohjelma ei muutu.`, 'Poista liike')) return;
    let result;
    await mutate((next) => {
      const existing = next.session?.exercises.find((e) => e.id === id);
      if (!existing || core.loggedSetCount(existing) > confirmedLogged) { announce(CHANGED_ELSEWHERE); render(); return false; }
      result = core.removeSessionExercise(next.session, id);
      if (!result.ok) { logError = result.error; announce(result.error); render(); return false; }
      logError = '';
      const p = core.progress(next.session); if (p.done === p.total) next.restEnd = null;
    }, sessionOptions());
    if (result?.ok) announce(`${shown.name} poistettu tästä treenistä. Ohjelma ei muuttunut.`);
  },
  multiex() { if (!picker.adding) return; picker.keepOpen = !picker.keepOpen; render(); },
  resetfilters() {
    Object.assign(picker, { query: '', category: '', equipment: '', customOnly: false, limit: 40 });
    render(); document.getElementById('exercise-search')?.focus();
    announce('Haku ja suodattimet tyhjennetty.');
  },
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
      for (const exercise of r.exercises) {
        const previous = existing?.exercises.find((e) => e.id === exercise.id);
        if (previous && (previous.name !== exercise.name ||
          JSON.stringify(prescription(previous)) !== JSON.stringify(prescription(exercise)) ||
          JSON.stringify(progressionConfig(previous)) !== JSON.stringify(progressionConfig(exercise)))) delete exercise.recoveryBase;
      }
      const i = next.routines.findIndex((x) => x.id === r.id);
      if (i < 0) next.routines.push(r); else next.routines[i] = r;
    }, { critical: true });
    if (ok) { clearDraft(); view = 'home'; render(); announce('Harjoitus tallennettu.'); }
  },
  async delroutine() {
    if (!await askConfirm('Poistetaanko harjoitusohjelma? Keskeneräinen harjoitus ei muutu.', 'Poista')) return;
    const ok = await mutate((next) => {
      if (next.routines.length < 2) { editorError('Säilytä vähintään yksi harjoitus. Luo ensin uusi ohjelma.'); return false; }
      if (JSON.stringify(byId(draft.id, next)) !== draft.base) { editorError('Harjoitus muuttui toisessa välilehdessä. Peruuta ja avaa se uudelleen ennen poistamista.'); return false; }
      next.routines = next.routines.filter((r) => r.id !== draft.id);
    }, { critical: true });
    if (ok) { clearDraft(); view = 'home'; render(); }
  },
  jump() { showCurrentExercise({ focus: true }); },
  jumpto(t) { showCurrentExercise({ index: +t.dataset.e }); },
  jumpwod(t) { showCurrentExercise({ wod: +t.dataset.w }); },
  // "Valmis" on a warm-up or cool-down is a reminder for this workout only; history keeps sets and WOD results.
  async blockdone(t) {
    const kind = t.dataset.block;
    if (!BLOCK_KINDS.includes(kind)) return;
    await mutate((next) => {
      const block = next.session?.[kind];
      if (!block) { announce(CHANGED_ELSEWHERE); render(); return false; }
      block.done = !block.done;
      const title = kind === 'warmup' ? 'Lämmittely' : 'Loppuverryttely';
      announce(block.done ? `${title} tehty.` : `${title}: merkintä peruttu.`);
    }, sessionOptions());
    // Safari does not focus a tapped button, so keep the toggle focused for the next tap or key press.
    document.querySelector(`[data-key="blockdone-${kind}"]`)?.focus({ preventScroll: true });
  },
  // Which version (Rx or scaled) the whiteboard shows. The result form keeps its own choice in step.
  async wodversion(t) {
    const wi = +t.dataset.w, division = t.dataset.division, key = t.dataset.key;
    if (!Object.hasOwn(DIVISIONS, division)) return;
    await mutate((next) => {
      const w = next.session?.wods?.[wi];
      if (!w) { announce(CHANGED_ELSEWHERE); render(); return false; }
      if (w.division === division) return false;
      w.division = division;
      if (resultDraft?.wodId === w.id) resultDraft.fields.division = division;
      announce(`${wodTitle(w)}: ${division === 'scaled' ? 'skaalattu versio' : 'Rx-versio'}.`);
    }, sessionOptions());
    document.querySelector(`[data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
  },
  openresult(t) {
    const s = state.session, wi = +t.dataset.w, w = s?.wods?.[wi];
    if (!w) return;
    resultDraft = { sessionId: s.id, wodId: w.id, fields: resultFields(w) };
    resultError = ''; wodCheer = null;
    render();
    const form = document.getElementById(`result-form-${wi}`);
    (firstResultField(form?.closest('.wod-card')) || form?.querySelector('[data-action="saveresult"]'))?.focus();
  },
  cancelresult() {
    const id = resultDraft?.wodId;
    resultDraft = null; resultError = ''; render();
    if (id) document.querySelector(`[data-key="openresult-${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  },
  async saveresult(t) {
    readLatest();
    const wi = +t.dataset.w, shown = state.session?.wods?.[wi], fields = resultDraft?.fields;
    if (!shown || !resultDraft || resultDraft.sessionId !== state.session.id || resultDraft.wodId !== shown.id) {
      resultDraft = null; resultError = ''; announce(CHANGED_ELSEWHERE); render(); return;
    }
    const built = buildResult(shown, fields);
    if (!built.ok) {
      resultError = built.error; render();
      document.getElementById(`result-error-${wi}`)?.focus();
      return;
    }
    let saved = null, record = false, cheerText = '';
    await mutate((next) => {
      const w = next.session?.wods?.[wi];
      if (w?.id !== shown.id) { resultDraft = null; resultError = ''; announce(CHANGED_ELSEWHERE); render(); return false; }
      // Compared with finished workouts only: this workout is not in history yet.
      record = isPersonalRecord(next.history, w.key, built.result);
      if (w.clock && !w.clock.endedAt) stopClock(w, Date.now());
      w.result = built.result; w.division = built.result.division; saved = w;
      resultDraft = null; resultError = ''; wodCheer = null;
      cheerText = record && next.settings.cheers !== false ? pickRecordCheer(lastCheer) : '';
      if (cheerText) { lastCheer = cheerText; wodCheer = { sessionId: next.session.id, wodId: w.id, text: cheerText }; }
    }, sessionOptions());
    if (!saved) return;
    announce(`Tulos tallennettu: ${wodTitle(saved)}, ${resultLabel(saved.result, { long: true })}.${record ? ' Uusi ennätys!' : ''}${cheerText ? ` ${cheerText}` : ''}`);
    document.querySelector(`[data-key="openresult-${CSS.escape(saved.id)}"]`)?.focus({ preventScroll: true });
  },
  async clearresult(t) {
    const wi = +t.dataset.w, id = state.session?.wods?.[wi]?.id;
    if (!id || !await askConfirm('Poistetaanko tämän WOD-osan tulos? Muut kirjaukset säilyvät.', 'Poista tulos')) return;
    let cleared = false;
    await mutate((next) => {
      const w = next.session?.wods?.[wi];
      if (w?.id !== id) { announce(CHANGED_ELSEWHERE); render(); return false; }
      delete w.result;
      resultDraft = null; resultError = ''; wodCheer = null; cleared = true;
    }, sessionOptions());
    if (!cleared) return;
    announce('Tulos poistettu.');
    document.querySelector(`[data-key="openresult-${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  },
  // Starts the WOD clock with a 10 s pre-roll. One clock runs at a time, and never next to the interval timer.
  async clockstart(t) {
    prepareAudio();
    readLatest();
    const wi = +t.dataset.w, shown = state.session?.wods?.[wi];
    if (!shown) { render(); return; }
    if (shown.clock && !shown.clock.endedAt) { clockWodId = shown.id; view = 'wod'; render(); return; }
    if (timerRun && !timerRun.done && !await askConfirm('Intervalliajastin on käynnissä. Lopetetaanko se?', 'Lopeta ajastin')) return;
    const other = runningClock();
    if (other && !await askConfirm(`Kello on käynnissä: ${wodTitle(other)}. Lopetetaanko se?`, 'Lopeta ja aloita')) return;
    if (shown.clock && !await askConfirm('Aloitetaanko kello alusta? Edellinen ajanotto korvataan.', 'Aloita alusta')) return;
    if (timerRun) { timerRun = null; rememberTimerRun(); }
    let started = null;
    await mutate((next) => {
      const w = next.session?.wods?.[wi];
      if (w?.id !== shown.id || w.result) { announce(CHANGED_ELSEWHERE); render(); return false; }
      const now = Date.now();
      for (const x of next.session.wods) if (x !== w && x.clock && !x.clock.endedAt) stopClock(x, now);
      startClock(w, now);
      next.restEnd = null;
      if (resultDraft?.wodId === w.id) { resultDraft = null; resultError = ''; }
      clockWodId = w.id; wodCue = ''; view = 'wod'; started = w;
    }, sessionOptions());
    if (started) announce(`Valmistaudu: ${wodTitle(started)} alkaa 10 sekunnin kuluttua.`);
  },
  clockopen(t) {
    prepareAudio();
    const w = state.session?.wods?.[+t.dataset.w];
    if (!w?.clock) { render(); return; }
    clockWodId = w.id; view = 'wod'; render();
  },
  clockback() {
    const wi = clockIndex();
    view = 'workout'; render();
    if (wi >= 0) showCurrentExercise({ wod: wi, focus: true, instant: true });
  },
  async clockpause() { await clockChange(pauseClock, 'Kello tauolla.'); },
  async clockresume() { prepareAudio(); await clockChange(resumeClock, 'Kello jatkuu.'); },
  // One tap per finished round. A second tap within a second is a double tap, not a round.
  async clocklap() {
    prepareAudio();
    const w = state.session?.wods?.[clockIndex()];
    if (!w?.clock || w.clock.endedAt) { render(); return; }
    const face = clockFace(w, w.clock, Date.now());
    if (face.phase !== 'run' || face.paused) { announce(face.paused ? 'Kello on tauolla. Jatka ensin.' : 'Kierroksia kirjataan, kun kello käy.'); return; }
    const last = w.clock.laps.at(-1);
    if (last !== undefined && face.workMs - last < 1000) return;
    let counted = null;
    await mutate((next) => {
      const x = next.session?.wods?.find((y) => y.id === clockWodId);
      if (!x?.clock || (x.format === 'fortime' && x.clock.laps.length >= x.rounds - 1) || !addLap(x, Date.now())) return false;
      counted = x;
    }, sessionOptions());
    if (!counted) return;
    navigator.vibrate?.(40);
    const n = counted.clock.laps.length, after = clockFace(counted, counted.clock, Date.now());
    const final = counted.format === 'fortime' && n >= counted.rounds - 1;
    announce(`${n === 1 ? '1 kierros' : `${n} kierrosta`} tehty.${final ? ' Viimeinen kierros.' : ''}${after.target ? ` ${after.target}.` : ''}`);
    if (final) document.querySelector('.clock-lap-final')?.focus({ preventScroll: true });
  },
  async clockundo() {
    let undone = false;
    await mutate((next) => {
      const x = next.session?.wods?.find((y) => y.id === clockWodId);
      if (!x?.clock || x.clock.endedAt || !undoLap(x)) return false;
      undone = true;
    }, sessionOptions());
    if (!undone) return;
    announce('Viimeisin kierros peruttu.');
    if (!document.querySelector('[data-key="clockundo"]')) document.querySelector('[data-key="clocklap"]')?.focus({ preventScroll: true });
  },
  async clockdone() { await endClock(true); },
  async clockstop() { await endClock(false); },
  // Opens the result form on the workout view, prefilled with what the clock measured.
  clocklog() {
    const s = state.session, wi = clockIndex(), w = s?.wods?.[wi];
    if (!w) { render(); return; }
    const measured = clone(w);
    settleClock(measured, Date.now());
    resultDraft = { sessionId: s.id, wodId: w.id, fields: resultFields(measured) };
    resultError = ''; wodCheer = null;
    view = 'workout'; render();
    showCurrentExercise({ wod: wi, focus: true, instant: true });
  },
  async export() {
    const text = locked() ? storage.getItem(core.STORAGE_KEY) : JSON.stringify(core.buildBackup(state), null, 2);
    const delivered = await shareBackup(text) ?? downloadBackup(text);
    if (!delivered) { announce('Varmuuskopiota ei jaettu.'); return; }
    if (!unreadable) try { localStorage.setItem(BACKUP_KEY, String(Date.now())); } catch { /* Reminder date is optional. */ }
    if (view === 'home') render();
    announce('Varmuuskopio valmis. Säilytä se turvallisessa paikassa.');
  },
  async resetunreadable() {
    if (!unreadable || !storage) return;
    if (!await askConfirm('Aloitetaanko tyhjästä? Vioittuneet tiedot siirretään talteen selaimen tallennustilaan, mutta sovellus ei enää näytä niitä. Vie ne ensin tiedostoksi, jos haluat säilyttää ne.', 'Aloita tyhjästä')) return;
    const run = async () => {
      const raw = storage.getItem(core.STORAGE_KEY);
      if (core.storageProblem(raw) !== 'unreadable') { checkProblem(raw); storageOk = !locked(); readLatest(); render(); return; }
      const rescueKey = `${core.STORAGE_KEY}-unreadable-${Date.now()}`;
      try {
        storage.setItem(rescueKey, raw);
        if (storage.getItem(rescueKey) !== raw) throw new Error('rescue copy mismatch');
        storage.removeItem(core.STORAGE_KEY);
      } catch {
        try { storage.removeItem(rescueKey); } catch { /* Nothing more can be done. */ }
        saveMessage = 'Vioittuneita tietoja ei voitu siirtää talteen. Mitään ei poistettu. Vapauta tilaa tai vie tiedot tiedostoksi.';
        render(); announce(saveMessage); return;
      }
      state = core.defaultState(); durableRaw = null; unreadable = false; storageOk = true; dirty = false; saveMessage = '';
      render(); announce(`Aloitettu tyhjästä. Vioittuneet tiedot on säilytetty selaimessa avaimella ${rescueKey}.`);
    };
    await (navigator.locks ? navigator.locks.request(`${core.STORAGE_KEY}:write`, run) : run());
  },
  async share() {
    const link = new URL('./', location.href).href;
    let ok = false;
    try { await navigator.clipboard.writeText(link); ok = true; } catch { /* Fall back to showing the link. */ }
    shareMessage = ok ? 'Linkki kopioitu leikepöydälle. Liitä se viestiin ja lähetä.' : `Kopiointi ei onnistunut. Linkki: ${link}`;
    if (view === 'home') render();
    announce(shareMessage);
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
  if (file.size > core.MAX_BACKUP_BYTES) return importDone('Varmuuskopio on liian suuri (enintään 50 Mt). Mitään ei muutettu.');
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
  if (!await askConfirm(question, mode === 'replace' ? 'Korvaa' : 'Yhdistä')) return importDone('Tuonti peruttu. Mitään ei muutettu.');
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
  if (updateBusy) { announce('Päivitys on käynnissä. Odota hetki.'); return; }
  cancelExerciseScroll();
  pendingActions++;
  $app.setAttribute('aria-busy', 'true');
  actionQueue = actionQueue.then(() => { cancelExerciseScroll(); return work(); }).catch(() => {
    announce('Muutosta ei voitu tehdä. Yritä uudelleen.');
  }).finally(() => {
    pendingActions--;
    $app.setAttribute('aria-busy', String(pendingActions > 0));
  });
}
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action]');
  if (!t || t.disabled || !Object.hasOwn(actions, t.dataset.action) || t.tagName === 'INPUT') return;
  e.preventDefault();
  const key = t.dataset.key ?? null;
  enqueueAction(async () => {
    actionAnchor = key;
    try { return await actions[t.dataset.action](t); } finally { actionAnchor = null; }
  });
});
// Holding a +/- stepper button repeats it until release. The first press still acts once on click, as before.
const HOLD_DELAY_MS = 500;
let holdTimer = null, holdRepeating = false, holdSuppressClick = false;
function stopHold() {
  clearTimeout(holdTimer); holdTimer = null;
  if (holdRepeating) { holdRepeating = false; holdSuppressClick = true; setTimeout(() => { holdSuppressClick = false; }, 100); }
}
document.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !e.isPrimary) return;
  const button = e.target.closest('.step-btn[data-action]');
  if (!button || button.disabled) return;
  stopHold();
  const key = button.dataset.key;
  const heldFrom = Date.now() + HOLD_DELAY_MS;
  // Repeats speed up the longer the button is held, so a large change (reps and kilos go up to 9999) stays reachable.
  const repeat = () => {
    // The view is redrawn after every step, so find the live button again and stop at its limit.
    const live = key && document.querySelector(`.step-btn[data-key="${key}"]`);
    if (!live || live.disabled) return;
    if (pendingActions === 0 && !updateBusy) {
      enqueueAction(async () => {
        actionAnchor = key;
        try { return await actions[live.dataset.action](live); } finally { actionAnchor = null; }
      });
    }
    const held = Date.now() - heldFrom;
    holdTimer = setTimeout(repeat, held > 4000 ? 30 : held > 2000 ? 60 : 120);
  };
  holdTimer = setTimeout(() => { holdRepeating = true; repeat(); }, HOLD_DELAY_MS);
});
for (const type of ['pointerup', 'pointercancel', 'blur']) (type === 'blur' ? window : document).addEventListener(type, stopHold);
document.addEventListener('contextmenu', (e) => { if (e.target.closest?.('.step-btn')) e.preventDefault(); });
document.addEventListener('click', (e) => {
  if (holdSuppressClick && e.target.closest?.('.step-btn')) { e.stopImmediatePropagation(); e.preventDefault(); holdSuppressClick = false; }
}, true);
document.addEventListener('submit', (e) => {
  // Enter in a result field clicks "Tallenna tulos", which the click handler runs; this catches any other submit.
  if (e.target.classList?.contains('result-form')) {
    e.preventDefault();
    const button = e.target.querySelector('[data-action="saveresult"]');
    if (button) enqueueAction(() => actions.saveresult(button));
    return;
  }
  if (e.target.id !== 'custom-exercise-form') return;
  e.preventDefault(); enqueueAction(() => actions.createcustom());
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.rf) {
    if (resultDraft && !['checkbox', 'radio'].includes(t.type) && Object.hasOwn(resultDraft.fields, t.dataset.rf)) resultDraft.fields[t.dataset.rf] = t.value;
    return;
  }
  if (t.dataset.tf && timerDraft) {
    const field = t.dataset.tf;
    if (['name', 'repeats'].includes(field)) timerDraft[field] = t.value;
    else if (['label', 'min', 'sec'].includes(field) && timerDraft.intervals[+t.dataset.ti]) {
      timerDraft.intervals[+t.dataset.ti][field] = t.value;
      if (field === 'label') t.closest('fieldset')?.querySelector('[data-action="timerdefault"]')?.toggleAttribute('hidden', !presetKind(t.value));
    }
    return;
  }
  if (t.dataset.tracking && draft && t.type !== 'radio') {
    const exercise = draft.exercises[+t.dataset.i];
    exercise.tracking = sanitizeTracking({ ...exercise.tracking, [t.dataset.tracking]: t.value });
    rememberDraft(); return;
  }
  if (t.dataset.log && !['checkbox', 'radio'].includes(t.type)) {
    // Keep valid edits durable before blur; unfinished input is validated on change.
    if (t.validity.valid) logInput(t);
    return;
  }
  if (t.id === 'exercise-search') { picker.query = t.value; picker.limit = 40; updateLibraryResults(); return; }
  if (t.dataset.custom && (draft || picker.mode === 'session')) { customEntry()[t.dataset.custom] = t.value; rememberDraft(); return; }
  if (t.dataset.progression && draft && t.type !== 'checkbox') {
    const exercise = draft.exercises[+t.dataset.i];
    const config = progressionConfig(exercise);
    if (['minReps', 'maxReps'].includes(t.dataset.progression)) exercise.progression = config;
    else exercise.progression ??= { weightStep: config.weightStep, autoLoad: config.autoLoad };
    exercise.progression[t.dataset.progression] = t.value;
    rememberDraft(); return;
  }
  if (draft?.type === 'functional' && (t.dataset.bf || t.dataset.mf || t.dataset.wf)) {
    if (t.dataset.bf) {
      const block = draft[t.dataset.block];
      if (block && ['text', 'minutes'].includes(t.dataset.bf)) { block[t.dataset.bf] = t.value; rememberDraft(); }
      return;
    }
    const wi = +t.dataset.w, w = draft.wods[wi];
    if (!w) return;
    if (t.dataset.mf) {
      const m = w.movements[+t.dataset.m], field = t.dataset.mf;
      if (!m) return;
      if (['name', 'amount', 'load'].includes(field)) m[field] = t.value;
      else if (['sname', 'samount', 'sload'].includes(field)) m.scaled[field.slice(1)] = t.value;
      // A retyped name no longer refers to the library movement it was picked from.
      if (field === 'name') delete m.sourceId;
    } else if (!['radio', 'checkbox'].includes(t.type) && WOD_TEXT_FIELDS.includes(t.dataset.wf) && Object.hasOwn(w, t.dataset.wf)) w[t.dataset.wf] = t.value;
    else return;
    rememberDraft(); paintWodEditor(w, wi);
    return;
  }
  if (!t.dataset.f || !draft) return;
  if (t.dataset.f === 'rname') draft.name = t.value;
  else if (t.dataset.f === 'setReps') draft.exercises[+t.dataset.i].setReps[+t.dataset.s] = t.value;
  else if (['name', 'sets', 'reps', 'weight'].includes(t.dataset.f)) draft.exercises[+t.dataset.i][t.dataset.f] = t.value;
  if (t.dataset.f === 'sets') {
    const exercise = draft.exercises[+t.dataset.i];
    if (Array.isArray(exercise.setReps)) {
      const count = core.clampInt(exercise.sets, 1, core.MAX_SETS, 3);
      while (exercise.setReps.length < count) exercise.setReps.push(exercise.reps);
      t.closest('.edit').querySelector('.set-targets').innerHTML = setTargetFields(exercise, +t.dataset.i);
    }
  }
  rememberDraft();
});
async function commitHistoryEdit(t) {
  const { hid: id, hedit: field } = t.dataset, ei = +t.dataset.e, si = +t.dataset.s;
  let result, sourceOf = null;
  const ok = await mutate((next) => {
    result = field === 'duration' ? core.shortenHistoryDuration(next, id, t.value) :
      field === 'loadType' ? core.editHistoryLoadType(next, id, ei, t.value) :
        core.editHistorySet(next, id, ei, si, field, field === 'done' ? t.checked : t.value);
    if (!result.ok) return false;
    sourceOf = next.routines.find((r) => r.revision?.sourceId === id && !r.revision.undone)?.id ?? null;
  }, { critical: true });
  historyMessage = ok && result?.ok ? '' : result?.error ?? 'Muutosta ei voitu tallentaa. Yritä uudelleen.';
  if (ok && sourceOf) {
    revisionMessages.set(sourceOf, 'Muokkasit harjoitusta, jonka perusteella tavoitteet päivitettiin. Paina "Tarkista seuraava treeni" laskeaksesi tavoitteet korjatuista tiedoista.');
    openRoutines.add(sourceOf);
  }
  render();
  if (historyMessage) announce(historyMessage);
}

// Corrects the logged score of one WOD part of a finished workout. Fields are read from the part's fieldset.
async function commitHistoryWod(t) {
  const { hid: id } = t.dataset, wi = +t.dataset.w, box = t.closest('.history-edit-wod');
  const w = state.history.find((h) => h.id === id)?.wods?.[wi];
  if (!box || !w) { render(); return; }
  const fields = { min: '', sec: '', reps: '', rounds: '', value: '', division: 'rx', notes: '', capped: w.result?.kind === 'time' && !!w.result.capped, rpe: w.result?.rpe === undefined ? '' : String(w.result.rpe) };
  for (const input of box.querySelectorAll('[data-hwod]')) {
    if (input.type !== 'radio') fields[input.dataset.hwod] = input.value;
    else if (input.checked) fields.division = input.value;
  }
  // A part that never had a score stays without one until a value is typed.
  if (!w.result && w.score !== 'none' && !['min', 'sec', 'reps', 'rounds', 'value'].some((k) => String(fields[k]).trim() !== '')) return;
  const built = buildResult({ score: w.score }, fields);
  let result = built;
  if (built.ok) {
    if (built.result.capped && w.result?.seconds) built.result.seconds = w.result.seconds;
    const ok = await mutate((next) => {
      result = core.editHistoryWod(next, id, wi, built.result);
      if (!result.ok) return false;
    }, { critical: true });
    if (!ok && result.ok) result = { ok: false, error: 'Muutosta ei voitu tallentaa. Yritä uudelleen.' };
  }
  historyMessage = result.ok ? '' : result.error;
  render();
  if (historyMessage) announce(historyMessage);
}

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.rf) {
    if (!resultDraft) return;
    if (t.dataset.rf === 'capped') {
      // Capped: the reps done by the cap replace the time. Toggled in place so focus stays on the switch.
      resultDraft.fields.capped = t.checked;
      const wi = t.closest('.result-form')?.dataset.w;
      document.getElementById(`rf-time-${wi}`)?.toggleAttribute('hidden', t.checked);
      document.getElementById(`rf-cap-${wi}`)?.toggleAttribute('hidden', !t.checked);
    } else if (t.type === 'radio' && t.checked && t.dataset.rf === 'division' && Object.hasOwn(DIVISIONS, t.value)) resultDraft.fields.division = t.value;
    return;
  }
  if (t.dataset.autobackup) { void (t.checked ? chooseAutoFolder() : disableAutoBackup()); return; }
  if (t.dataset.appearance) {
    window.TrackerAppearance?.set(t.dataset.appearance);
    appearanceMessage = 'Ulkoasu tallennettu tälle laitteelle.';
    paintAppearance();
    return;
  }
  if (t.dataset.hedit) { enqueueAction(() => commitHistoryEdit(t)); return; }
  if (t.dataset.hwod) { enqueueAction(() => commitHistoryWod(t)); return; }
  if (t.dataset.statFilter || t.dataset.statDate) {
    const field = t.dataset.statFilter || t.dataset.statDate;
    statisticsFilters[field] = t.value;
    statisticsFilters.page = 0;
    if (field === 'routineId') statisticsFilters.exerciseKey = '';
    render();
    document.querySelector(`[data-key="stat-${field}"]`)?.focus({ preventScroll: true });
    return;
  }
  if (t.dataset.tracking && draft && t.type === 'radio') {
    const exercise = draft.exercises[+t.dataset.i];
    if (t.dataset.tracking === 'loadType' && Object.hasOwn(LOAD_TYPES, t.value)) {
      exercise.tracking = sanitizeTracking({ ...exercise.tracking, loadType: t.value });
      rememberDraft();
    }
    return;
  }
  if (draft?.type === 'functional' && t.dataset.wf && ['radio', 'checkbox'].includes(t.type)) {
    const wi = +t.dataset.w, w = draft.wods[wi], field = t.dataset.wf;
    if (!w) return;
    if (field === 'format' && t.checked && WOD_FORMATS.includes(t.value) && t.value !== w.format) {
      draft.wods[wi] = switchFormat(w, t.value);
      rememberDraft(); render();
      announce(`${FORMAT_LABELS[t.value]}. ${FORMAT_HELP[t.value]}`);
    } else if (field === 'score' && t.checked && FORMAT_SCORES[w.format].includes(t.value)) {
      w.score = t.value;
      const menu = t.closest('.choice-menu');
      const value = menu && document.getElementById(`${menu.id}-value`);
      if (value) value.textContent = SCORE_LABELS[t.value];
      if (menu) { menu.open = false; menu.querySelector('summary').focus({ preventScroll: true }); }
      rememberDraft(); paintWodEditor(w, wi);
    } else if (['alternate', 'ascending'].includes(field) && w.format === 'emom') {
      w[field] = t.checked;
      rememberDraft(); paintWodEditor(w, wi);
    }
    return;
  }
  if (t.dataset.sessionload) {
    const ei = +t.dataset.e, value = t.value;
    enqueueAction(async () => {
      let result;
      const ok = await mutate((next) => { result = core.setSessionLoadType(next, ei, value); return result.ok; }, { ...sessionOptions(), critical: true });
      announce(ok ? 'Kuorman merkitys tallennettu.' : result?.error ?? 'Muutosta ei voitu tallentaa. Yritä uudelleen.');
    });
    return;
  }
  if (t.dataset.log) { logInput(t); return; }
  if (t.dataset.progression === 'autoLoad' && draft) {
    const exercise = draft.exercises[+t.dataset.i];
    const config = progressionConfig(exercise);
    exercise.progression ??= { weightStep: config.weightStep, autoLoad: config.autoLoad };
    exercise.progression.autoLoad = t.checked;
    rememberDraft();
  }
  if (t.dataset.action === 'autoprogress') {
    const checked = t.checked, id = t.dataset.id;
    enqueueAction(async () => {
      await mutate((next) => {
        const routine = byId(id, next);
        if (!routine) { announce('Harjoitusohjelmaa ei löytynyt.'); return false; }
        routine.autoProgress = checked;
      }, { critical: true });
    });
    return;
  }
  if (draft && t.dataset.f === 'individualReps') {
    const exercise = draft.exercises[+t.dataset.i];
    exercise.setReps = t.checked ? Array.from({ length: core.clampInt(exercise.sets, 1, core.MAX_SETS, 3) }, () => exercise.reps) : null;
    rememberDraft(); render();
  }
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
  if (t.dataset.action === 'advancedlogging') {
    const checked = t.checked;
    await mutate((next) => { next.settings.advancedLogging = checked; });
  }
  if (t.dataset.action === 'cheers') {
    const checked = t.checked;
    await mutate((next) => { next.settings.cheers = checked; });
  }
  if (t.dataset.action === 'restfixed') {
    const fixed = t.checked;
    await mutate((next) => { next.settings.restMode = fixed ? 'fixed' : 'auto'; });
  }
  if (t.dataset.action === 'restsecs') {
    const seconds = core.clampInt(t.value, 10, 600, 90);
    await mutate((next) => { next.settings.restSeconds = seconds; });
  }
});
document.addEventListener('toggle', (e) => {
  if (e.target.matches('.exercise-actions')) {
    if (e.target.open) openExerciseActions.add(e.target.dataset.actionsPanel);
    else openExerciseActions.delete(e.target.dataset.actionsPanel);
  }
  if (e.target.matches('.exercise-log')) {
    if (e.target.open) openLogs.add(e.target.dataset.logPanel);
    else openLogs.delete(e.target.dataset.logPanel);
  }
  if (e.target.matches('.routine-details')) {
    if (e.target.open) openRoutines.add(e.target.dataset.routinePanel);
    else openRoutines.delete(e.target.dataset.routinePanel);
  }
  if (e.target.matches('.settings')) settingsOpen = e.target.open;
  if (e.target.matches('.backup-group')) backupOpen = e.target.open;
  if (e.target.matches('.custom-exercise')) customOpen = e.target.open;
  if (e.target.matches('.move-scaled')) {
    if (e.target.open) openScaled.add(e.target.dataset.scaled);
    else openScaled.delete(e.target.dataset.scaled);
  }
  if (e.target.matches('.wod-guide')) guideOpen = e.target.open;
}, true);
window.addEventListener('storage', (e) => {
  if (e.key !== core.STORAGE_KEY && e.key !== null) return;
  cancelExerciseScroll();
  if (!dirty) {
    readLatest();
    // Avoid replacing a focused editor input while someone is typing.
    if (view !== 'edit' || locked()) render();
  } else announce('Toinen välilehti muutti tallennettua harjoitusta. Pidä tämä välilehti auki, kunnes muutokset ovat tallessa.');
});
document.addEventListener('visibilitychange', () => {
  cancelExerciseScroll();
  if (document.visibilityState === 'hidden') { persistHr(true); if (autoBackup.pending) scheduleAutoBackup(0); }
  if (document.visibilityState === 'visible') {
    if (autoBackupDue()) scheduleAutoBackup(1500);
    readLatest(); if (view !== 'edit') render();
    updateDismissed = false; syncUpdateState(); void checkForUpdates();
  }
  tick(); syncWakeLock();
});
window.addEventListener('pageshow', (e) => { if (e.persisted) { readLatest(); updateDismissed = false; render(); void checkForUpdates(); } });
for (const event of ['online', 'offline']) window.addEventListener(event, () => {
  const status = document.getElementById('connection'); if (status) status.textContent = connectionText();
  if (event === 'online') { updateDismissed = false; renderUpdateNotice(); void checkForUpdates(); }
});
if ('serviceWorker' in navigator) {
  let previousController = navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const controlled = !!previousController;
    previousController = navigator.serviceWorker.controller;
    if (controlled) reloadForNewVersion();
  });
  void registerUpdates();
}
render();
void hr.restore();
if (state.history.length && !locked()) void requestPersistence();
if (autoBackup.supported) {
  void autobackup.loadConfig().then(async (config) => {
    if (!config?.enabled || !config.handle) return;
    Object.assign(autoBackup, { enabled: true, handle: config.handle, lastAt: Number(config.lastAt) || 0, permission: await autobackup.permission(config.handle) });
    if (view === 'home') render(); else paintAutoBackup();
    if (autoBackupDue()) scheduleAutoBackup(1500);
  });
}
if (view === 'workout') showCurrentExercise({ instant: true });
