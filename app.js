import * as core from './core.js';
import { progressionConfig, progressionRange, prescription, parseWeight, reviseRoutine, undoRevision, canUndoRevision } from './progression.js';

import { EXERCISES, CATEGORIES, EQUIPMENT, findExercises, normalizeSearch } from './exercises.js';

// Views restore their own position; browser reload restoration must not undo it.
history.scrollRestoration = 'manual';
const $app = document.getElementById('app');
const $live = document.getElementById('live');
const DRAFT_KEY = 'gym-tracker-draft-v1';
const BACKUP_KEY = 'gym-tracker-last-backup';
const BACKUP_REMIND_DAYS = 7;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = (x) => JSON.parse(JSON.stringify(x));
const blankEx = () => ({ id: core.uid(), name: '', sets: 3, reps: '10', weight: '', setReps: null });
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
  }
} catch { /* Session storage is optional; the workout still works. */ }
let view = draft ? 'edit' : state.session ? 'workout' : 'home';
let renderedView;
let editError = '';
let settingsOpen = false;
let picker = { query: '', category: '', equipment: '', customOnly: false, limit: 40, target: null, adding: true, keepOpen: false, added: [] };
let customError = '';
let customOpen = false;
const customEntry = () => draft.customEntry ??= { name: '', category: 'Koko keho', equipment: 'Muu väline', reps: '10' };
let importMessage = '';
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
let reloadPending = false;
let wakeLock = null;
let wakePending = false;
let pendingActions = 0;
let actionQueue = Promise.resolve();
const revisionMessages = new Map();
const openLogs = new Set();
let logError = '';
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
    const saved = core.saveState(storage, next);
    const wasHealthy = storageOk && !saveMessage;
    storageOk = saved;
    if (saved) { durableRaw = JSON.stringify(next); saveConflict = false; }
    saveMessage = saved ? '' : critical ? 'Muutosta ei voitu tallentaa. Harjoitus on yhä tallessa tässä välilehdessä. Yritä uudelleen ennen sulkemista.' : 'Muutokset ovat vain tässä välilehdessä. Tallennus ei onnistu. Älä sulje välilehteä ennen tallentamista.';
    if (saved || !critical) { state = next; dirty = !saved; }
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
function lastBackupAt() {
  try { const t = Number(localStorage.getItem(BACKUP_KEY)); return Number.isFinite(t) && t > 0 ? t : 0; } catch { return 0; }
}
function backupCard() {
  const last = lastBackupAt();
  const days = last ? Math.max(0, Math.floor((Date.now() - last) / 86400000)) : null;
  const due = state.history.length > 0 && (days === null || days >= BACKUP_REMIND_DAYS);
  const status = days === null ? 'Et ole vielä tehnyt varmuuskopiota.'
    : `Viimeisin varmuuskopio: ${new Date(last).toLocaleDateString('fi-FI')} (${days === 0 ? 'tänään' : days === 1 ? 'eilen' : `${days} päivää sitten`}).`;
  const advice = due ? 'Tee varmuuskopio nyt. Tietosi ovat vain tällä laitteella ja katoavat, jos selaintiedot tyhjennetään tai sovellus poistetaan.'
    : `Tietosi ovat vain tällä laitteella. Tee varmuuskopio vähintään kerran viikossa ja tallenna tiedosto pilveen tai lähetä se itsellesi sähköpostilla.`;
  return `<section class="backup card${due ? ' due' : ''}" aria-labelledby="backup-title"><div class="row">${icon('shield')}<div class="grow"><span class="eyebrow${due ? ' accent' : ''}">${due ? 'MUISTUTUS' : 'TIETOJEN TURVA'}</span><h2 id="backup-title">Varmuuskopio</h2></div></div><p class="backup-status" id="backup-status">${status}</p><p class="muted small-copy">${advice}</p><button class="btn ${due ? 'primary' : 'secondary'} big" data-action="export" data-key="export">Vie varmuuskopio</button></section>`;
}
const sectionHead = (title, label = '') => `<div class="section-head"><h2>${title}</h2>${label ? `<span class="eyebrow">${label}</span>` : ''}</div>`;
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
  const html = `<h2 id="update-title">${updateBusy ? 'Päivitetään sovellusta…' : ready ? 'Uusi versio saatavilla' : 'Päivityksen tarkistus ei onnistunut'}</h2><p role="status">${esc(updateError || (updateBusy ? 'Odota hetki. Sovellus avautuu uudelleen päivittyneenä.' : 'Päivitä sovellus nyt tai myöhemmin. Tallennettu harjoitus, historia ja muokkausluonnos säilyvät. Sulje muut tämän sovelluksen ikkunat ennen päivittämistä.'))}</p><div class="update-actions">${ready ? `<button class="btn primary" data-action="installupdate" data-key="installupdate" ${updateBusy ? 'disabled' : ''}>Päivitä nyt</button>` : '<button class="btn" data-action="checkupdates" data-key="checkupdates">Yritä uudelleen</button>'}<button class="btn" data-action="laterupdate" data-key="laterupdate" ${updateBusy ? 'disabled' : ''}>Myöhemmin</button></div>`;
  if (notice.innerHTML !== html) notice.innerHTML = html;
}

function updateFailed(message) {
  clearTimeout(updateTimer);
  updateBusy = false; updateDismissed = false; updateError = message;
  renderUpdateNotice(); announce(message);
}

async function checkForUpdates() {
  if (updateBusy || updateCheck || !updateRegistration || !navigator.onLine) return;
  if (updateRegistration.installing && !updateRegistration.active) return;
  updateCheck = updateRegistration.update();
  try { await updateCheck; }
  catch { updateFailed('Uutta versiota ei voitu tarkistaa. Nykyinen sovellus ja tietosi säilyvät. Tarkista verkkoyhteys ja yritä uudelleen.'); }
  finally { updateCheck = null; renderUpdateNotice(); }
}

async function registerUpdates() {
  if (updateRegistration) { await checkForUpdates(); return; }
  try {
    const registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
    updateRegistration = registration;
    let offeredWorker = null;
    const refresh = () => {
      updateReady = !!registration.waiting && !!navigator.serviceWorker.controller;
      if (updateReady && offeredWorker !== registration.waiting) {
        offeredWorker = registration.waiting; updateDismissed = false; updateError = '';
        announce('Uusi sovellusversio on saatavilla. Voit päivittää nyt tai myöhemmin.');
      }
      renderUpdateNotice();
    };
    const watch = (worker) => worker?.addEventListener('statechange', () => {
      if (worker.state === 'redundant' && registration.active) updateFailed('Uuden version lataus ei valmistunut. Nykyinen versio ja tietosi säilyvät. Yritä uudelleen verkkoyhteydessä.');
      refresh();
    });
    registration.addEventListener('updatefound', () => watch(registration.installing));
    watch(registration.installing);
    refresh();
    navigator.serviceWorker.ready.then(() => {
      offlineReady = true;
      const status = document.getElementById('connection');
      if (status) status.textContent = connectionText();
    });
    await checkForUpdates();
  } catch {
    updateFailed('Päivityspalvelua ei voitu käynnistää. Nykyisiä tietoja ei muutettu. Tarkista verkkoyhteys ja selaimen sivusto-oikeudet, ja yritä uudelleen.');
  }
}

async function installUpdate() {
  if (pendingActions > 1) { updateFailed('Odota keskeneräisten kirjausten tallentumista ja yritä päivittämistä uudelleen.'); return; }
  if ((dirty || !storageOk) && !locked()) await mutate(() => {}, { critical: true });
  if (dirty || saveConflict || (!storageOk && !locked())) {
    updateFailed('Päivitystä ei aloitettu: kaikkia harjoitustietoja ei ole tallennettu. Käytä tallennuksen palautustoimintoja ja yritä uudelleen.'); return;
  }
  if (draft) rememberDraft();
  if (draft && !draftOk) { updateFailed('Muokkausluonnosta ei voitu tallentaa. Tallenna ohjelma tai korjaa luonnoksen tallennus ennen päivitystä.'); return; }
  if (logError) { updateFailed('Tarkista harjoituksen virheellinen kirjaus ennen päivitystä.'); return; }
  readLatest();
  if (!storageOk && !locked()) { updateFailed('Tallennettua harjoitusta ei voitu lukea. Korjaa tallennuksen tila ennen päivitystä.'); return; }
  if (reloadPending) { window.location.reload(); return; }
  const worker = updateRegistration?.waiting;
  if (!worker) { updateReady = false; updateFailed('Ladattua päivitystä ei enää löytynyt. Tarkista päivitykset uudelleen.'); return; }
  updateError = ''; updateBusy = true; renderUpdateNotice();
  const channel = new MessageChannel();
  updateTimer = setTimeout(() => {
    channel.port1.close();
    updateFailed('Päivitys ei valmistunut ajoissa. Tietojasi ei poistettu. Sulje muut sovelluksen ikkunat ja yritä uudelleen.');
  }, 12000);
  channel.port1.onmessage = ({ data }) => {
    channel.port1.close();
    if (!data?.ok) updateFailed(data?.reason === 'other-windows'
      ? 'Sulje muut tämän sovelluksen ikkunat ja selaimen välilehdet. Niiden harjoituksia ei keskeytetty. Yritä sitten uudelleen.'
      : 'Päivitystä ei voitu ottaa käyttöön. Nykyiset tiedot säilyvät. Yritä uudelleen.');
  };
  try { worker.postMessage({ type: 'APPLY_UPDATE' }, [channel.port2]); }
  catch { channel.port1.close(); updateFailed('Päivityspyyntö ei onnistunut. Tarkista päivitykset uudelleen; nykyiset tiedot säilyvät.'); }
}

function progressionControls(r) {
  const active = state.session?.routineId === r.id;
  const revision = r.revision;
  const report = revision ? `<div class="revision-report"><strong>${revision.undone ? 'Tarkistus peruttu – edelliset tavoitteet käytössä' : 'Viimeisin tarkistus'}</strong><ul>${revision.changes.map((change) => `<li><strong>${esc(change.name)}</strong><p>${esc(change.before)}${change.kind !== 'hold' ? ` → ${esc(change.after)}` : ' · ennallaan'}</p><p class="muted">${esc(change.reason)}</p></li>`).join('')}</ul>${canUndoRevision(r) ? `<button class="btn secondary" data-action="undorevision" data-id="${esc(r.id)}" data-key="undo-${esc(r.id)}" ${active ? 'disabled' : ''}>Peru tarkistus</button>` : ''}</div>` : '';
  return `<div class="progression-controls"><label class="check"><span>Tarkista seuraava treeni automaattisesti<small>Vain tämän ohjelman tallennuksen jälkeen. Muutokset voi perua.</small></span><input type="checkbox" role="switch" data-action="autoprogress" data-id="${esc(r.id)}" data-key="auto-${esc(r.id)}" aria-label="Tarkista automaattisesti: ${esc(r.name)}" ${r.autoProgress ? 'checked' : ''}></label><button class="btn secondary" data-action="revise" data-id="${esc(r.id)}" data-key="revise-${esc(r.id)}" ${active ? 'disabled' : ''}>Tarkista seuraava treeni</button>${active ? '<p class="muted small-copy">Keskeneräistä harjoitusta ei muuteta. Tarkista tavoitteet tallennuksen jälkeen.</p>' : ''}${revisionMessages.has(r.id) ? `<p class="small-copy" role="status">${esc(revisionMessages.get(r.id))}</p>` : ''}${report}</div>`;
}

function historyDetails(h) {
  if (!h.exercises?.length) return '';
  return `<details class="history-log"><summary>Toteutuneet sarjat: ${esc(h.name)}</summary><ul>${h.exercises.map((e) => `<li><strong>${esc(e.name)}</strong>: ${e.sets.map((set) => set.done ? `${esc(set.actualReps ?? '?')} toistoa${set.actualWeight || e.weight ? ` @ ${esc(set.actualWeight || e.weight)}` : ''}` : 'tekemättä').join(' / ')} · RIR ${esc(e.rir ?? '?')}${e.pain ? ' · kipua' : ''}</li>`).join('')}</ul>${h.fatigued ? '<p>Palautuminen oli heikkoa.</p>' : ''}</details>`;
}

function coachingGuide() {
  return `<details class="coaching-guide card"><summary>Miten tavoitteita tarkistetaan?</summary><div class="small-copy"><p>Yhtä parasta toistoaluetta ei ole. ACSM:n vuoden 2026 katsauksessa raskaammat kuormat tukivat maksimivoimaa ja suurempi viikkovolyymi lihaskasvua. Harjoita suuria lihasryhmiä säännöllisesti, yleensä vähintään kahdesti viikossa. Noin 10 sarjaa lihasryhmää kohti viikossa on hyödyllinen lihaskasvun suunnittelun vertailukohta, ei kaikille pakollinen vähimmäismäärä. Sovellus ei lisää sarjoja sokkona, koska se ei tunne koko viikkokuormitustasi.</p><p>Liikkeen nykyinen suunnitelma ja tunnistettava eristävä liike ohjaavat ehdotusta: esimerkiksi 3–6 toistoa jo voimapainotteiseen työhön, 6–12 yhdistettyyn voima-/massaharjoitteluun, 10–20 lihasmassapainotukseen tai 15–30 jo pitkille sarjoille. Nämä ovat käytännön valmennusvalintoja, eivät tutkimuksissa todistettuja liikekohtaisia optimeja. Tallennettu oma alue säilyy. Ensimmäisessä muutoksessa alue tallennetaan, jotta tavoiteraja ei karkaa aina toistoja lisättäessä. Muokkauksessa voit valita alueen itse tai laskea sen uudelleen.</p><p>Kirjaa toteutuneet toistot ja vaikeimman sarjan RIR: montako hyvää toistoa olisi vielä onnistunut (0–5; 5 = vähintään 5). Tyhjä paino tarkoittaa tavoitepainoa. Pelkkä sarjan kuittaus ei riitä nostoon. Kaikkien tavoitteiden onnistuminen vähintään RIR 2:lla sallii enintään yhden lisätoiston sarjaa kohti. Alueen ylärajan pitää onnistua kahdessa vertailukelpoisessa treenissä ennen yhtä painoaskelta (enintään 10 %); uudella painolla toistot vähenevät. Älä pakota tavoitetta tekniikan kustannuksella. Tarkat RIR- ja toistorajat ovat varovaisia ohjelmistosääntöjä, eivät yksilöllisesti validoitu malli.</p><p>Heikko palautuminen tai kaksi selvää alisuoriutumista voi keventää seuraavaa harjoituskertaa. Palautuneena onnistunut kevennys palauttaa aiemmat tavoitteet. Pakollista kalenteriviikkoa ei määrätä, ja joskus lepo on parempi vaihtoehto. Kipua ei käsitellä tavallisena väsymyksenä: lopeta kipua aiheuttava liike ja selvitä oire tarvittaessa ammattilaisen kanssa.</p><p>Lämmittele, lepää raskaissa moninivelliikkeissä yleensä 2–3 minuuttia tai pidempään ja muissa liikkeissä tarpeen mukaan. Uni, riittävä ravinto ja jatkuvuus tukevat kehitystä. Sovellus ei mittaa lihaskasvua tai tunne terveydentilaasi eikä voi taata tuloksia.</p><p>Tutkimuspohja:</p><ul class="sources"><li><a href="https://acsm.org/resistance-training-guidelines-update-2026/" target="_blank" rel="noopener noreferrer">ACSM 2026</a></li><li><a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC10579494/" target="_blank" rel="noopener noreferrer">Voima- ja hypertrofiaharjoittelun meta-analyysi 2023</a></li><li><a href="https://doi.org/10.47206/ijsc.v1i1.81" target="_blank" rel="noopener noreferrer">IUSCA 2021</a></li><li><a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC10511399/" target="_blank" rel="noopener noreferrer">Kevennyksen asiantuntijakonsensus</a></li></ul></div></details>`;
}

function homeView() {
  const s = state.session;
  const totalSets = state.history.reduce((n, h) => n + h.setsDone, 0);
  const weekStart = new Date(); weekStart.setHours(0, 0, 0, 0); weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const thisWeek = state.history.filter((h) => h.endedAt >= +weekStart).length;
  const resume = s ? `<section class="resume card"><div class="row"><span class="eyebrow accent"><span class="pulse" aria-hidden="true"></span> HARJOITUS KESKEN</span><span class="badge now">${core.progress(s).pct}%</span></div><h2>${esc(s.name)}</h2><p class="muted">${core.progress(s).done}/${core.progress(s).total} sarjaa tehty · Jatka siitä, mihin jäit.</p>${progressBar(core.progress(s))}<button class="btn primary big" data-action="resume" data-key="resume">Jatka harjoitusta ${icon('arrow')}</button></section>` : '';
  const routines = state.routines.map((r, i) => {
    const pills = r.exercises.slice(0, 4).map((e) => `<span class="pill">${esc(e.name)} <b>${e.setReps ? esc(e.setReps.join(' / ')) : `${e.sets}×${esc(e.reps)}`}${e.weight ? ` @ ${esc(e.weight)}` : ''}</b></span>`).join(' ') + (r.exercises.length > 4 ? ` <span class="pill pill-muted">+${r.exercises.length - 4} muuta</span>` : '');
    return `<li class="card routine"><div class="row routine-head"><span class="routine-icon">${icon('weight')}</span><div class="grow"><span class="eyebrow">OHJELMA ${String(i + 1).padStart(2, '0')}</span><h3>${esc(r.name)}</h3><p class="routine-meta">${r.exercises.length} liikettä <span>·</span> ${r.exercises.reduce((n, e) => n + e.sets, 0)} sarjaa</p></div><button class="btn ghost icon-button" data-action="edit" data-key="edit-${esc(r.id)}" data-id="${esc(r.id)}" aria-label="Muokkaa: ${esc(r.name)}">${icon('edit')}</button></div><div class="routine-pills">${pills}</div><button class="btn ${i === 0 ? 'primary' : 'secondary'} big" data-action="start" data-key="start-${esc(r.id)}" data-id="${esc(r.id)}">Aloita harjoitus ${icon('arrow')}</button>${progressionControls(r)}</li>`;
  }).join('');
  const history = state.history.slice(0, 10).map((h) => `<li><div class="hist"><span class="history-check">${icon('check')}</span><div class="grow"><h3>${esc(h.name)}</h3><span class="muted">${new Date(h.endedAt).toLocaleDateString('fi-FI', { month: 'short', day: 'numeric' })} · ${core.formatDuration(h.endedAt - h.startedAt)}</span></div><span class="history-sets">${h.setsDone}<span>/${h.setsTotal} sarjaa</span></span></div>${historyDetails(h)}</li>`).join('');
  const ios = (/iPad|iPhone|iPod/.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) && !navigator.standalone;
  const hint = ios ? '<p class="install-hint" id="ios-hint">Lisää sovellus aloitusnäyttöön: Jaa → Lisää Koti-valikkoon. Tiedot säilyvät tällä laitteella. Selaintietojen tyhjentäminen voi poistaa ne.</p>' : '';
  return `${brand()}${warn()}${resume}<section class="home-hero"><div><p class="eyebrow accent">OMA TREENISI · SARJA KERRALLAAN</p><h1 class="hero-title" tabindex="-1">Treenipäiväkirja</h1><p class="hero-copy">Suunnittele ohjelma ja kirjaa sarjat yhdellä napautuksella.</p></div><div class="hero-art" aria-hidden="true"><div class="art-weight">${icon('weight')}</div></div></section>
    <div class="stats"><div><strong>${thisWeek}</strong><span>tällä viikolla</span></div><div><strong>${totalSets}</strong><span>kirjattua sarjaa</span></div><div><strong>${state.history.length}</strong><span>valmista treeniä</span></div></div>
    <div class="home-grid"><section>${sectionHead('Harjoitukset', 'OMAT OHJELMASI')}<ul class="list routine-list">${routines}</ul><button class="btn secondary add-workout" data-action="new" data-key="new">${icon('plus')} Uusi harjoitus</button><p class="coaching-note">Liikekirjastossa on ${EXERCISES.length} liikettä. Valitse liikkeet harjoituksen muokkauksessa tai lisää omasi. Esimerkkiohjelma ei ole henkilökohtainen suositus. Lämmittele, valitse sopivat painot ja lepää tarpeeksi. Lopeta, jos tunnet kipua.</p>${backupCard()}${coachingGuide()}</section>
    <div class="home-aside"><section>${sectionHead('Historia', 'VIIMEISIMMÄT HARJOITUKSET')}${history ? `<ul class="list history-list">${history}</ul>` : `<div class="empty-state">${icon('clock')}<h3>Kehitys alkaa tästä</h3><p>Tallenna ensimmäinen harjoituksesi. Jokainen tehty sarja merkitsee.</p></div>`}</section>
    <details class="settings card" ${settingsOpen ? 'open' : ''}><summary>${icon('settings')}<h2>Asetukset</h2><span class="settings-chevron" aria-hidden="true">⌄</span></summary><div class="settings-body"><label class="check"><span>Automaattinen lepoajastin<small>Käynnistyy tehdyn sarjan jälkeen</small></span><input type="checkbox" role="switch" data-action="autorest" data-key="autorest" ${state.settings.autoRest ? 'checked' : ''} aria-label="Käynnistä lepoajastin sarjan jälkeen"></label><label class="field">Lepoaika sekunteina<input type="number" inputmode="numeric" min="10" max="600" value="${state.settings.restSeconds}" data-action="restsecs" data-key="restsecs"></label><p class="muted small-copy">10–600 sekuntia. Lepää tarvittaessa pidempään.</p><div class="settings-actions"><button class="btn secondary" data-action="import" data-key="import">Tuo varmuuskopio</button><button class="btn secondary" data-action="restore" data-key="restore">Palauta varmuuskopio</button></div><p class="muted small-copy">Tuonti yhdistää varmuuskopion nykyisiin tietoihin. Palautus korvaa ne. Keskeneräinen harjoitus säilyy aina.</p>${importMessage ? `<p class="small-copy" id="import-status" role="status">${esc(importMessage)}</p>` : ''}</div></details><section class="share"><button class="btn secondary" data-action="share" data-key="share">${icon('arrow')} Jaa sovellus (kopioi linkki)</button>${shareMessage ? `<p class="small-copy" id="share-status" role="status">${esc(shareMessage)}</p>` : ''}</section></div></div>${hint}<footer>${icon('shield')} Vain tällä laitteella. Ei tiliä. Ei seurantaa.<span>Tietosi pysyvät laitteellasi. Muista varmuuskopio.</span>${updateReady ? '<p>Päivitys on valmis. Sulje sovelluksen välilehdet ja avaa uudelleen.</p>' : ''}</footer>`;
}

function setEntry(e, ei, si, nextSi) {
  const set = e.sets[si];
  const target = core.setTargetLabel(set.reps ?? e.reps, e.weight);
  const count = core.setRepCount(e, set);
  const logged = count !== null && set.actualReps !== undefined;
  const value = logged ? core.setTargetLabel(count, set.actualWeight ?? e.weight) : target;
  const adjustment = count === null ? '' : `<div class="rep-adjust" role="group" aria-label="${esc(e.name)}, sarja ${si + 1}: muuta toteutuneita toistoja"><button class="btn" data-action="adjustreps" data-e="${ei}" data-s="${si}" data-delta="-1" data-key="reps-minus-${ei}-${si}" aria-label="Vähennä toisto: ${esc(e.name)}, sarja ${si + 1}" ${count === 0 ? 'disabled' : ''}>−</button><button class="btn" data-action="adjustreps" data-e="${ei}" data-s="${si}" data-delta="1" data-key="reps-plus-${ei}-${si}" aria-label="Lisää toisto: ${esc(e.name)}, sarja ${si + 1}" ${count === 100 ? 'disabled' : ''}>+</button></div>`;
  return `<div class="set-entry"><button class="set ${set.done ? 'done' : ''} ${si === nextSi ? 'next' : ''}" data-action="set" data-e="${ei}" data-s="${si}" data-key="s${ei}-${si}" aria-pressed="${set.done}" aria-label="Sarja ${si + 1} ${esc(value)}${logged ? ` Tavoite: ${esc(target)}` : ''} ${set.done ? 'Tehty' : 'Kirjaa'}. ${esc(e.name)}, sarja ${si + 1}/${e.sets.length}"><span class="set-label">SARJA ${si + 1}</span> <span class="set-value">${esc(value)}</span>${logged ? ` <span class="set-planned">Tavoite: ${esc(target)}</span>` : ''} <span class="set-foot">${set.done ? `${icon('check')} Tehty` : 'Kirjaa'}</span></button>${adjustment}</div>`;
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

function exerciseLog(e, ei) {
  const rows = e.sets.map((set, si) => `<div class="log-row"><span>Sarja ${si + 1}</span><label class="field">Toteutuneet toistot<input type="number" inputmode="numeric" min="0" max="100" step="1" value="${esc(set.actualReps ?? '')}" data-log="actualReps" data-e="${ei}" data-s="${si}" data-key="actual-${ei}-${si}" aria-label="${esc(e.name)}, sarja ${si + 1}: toteutuneet toistot" placeholder="Ei kirjattu"></label><label class="field">Toteutunut paino (kg)<input type="text" inputmode="decimal" maxlength="20" value="${esc(set.actualWeight ?? '')}" data-log="actualWeight" data-e="${ei}" data-s="${si}" data-key="load-${ei}-${si}" aria-label="${esc(e.name)}, sarja ${si + 1}: toteutunut paino" placeholder="${esc(e.weight || 'Ei lisäpainoa')}"></label></div>`).join('');
  return `<details class="exercise-log" data-log-panel="${esc(e.id)}" ${openLogs.has(e.id) ? 'open' : ''}><summary>Kirjaa tulokset ja kuormittavuus</summary><p class="muted small-copy">Kuittaa sarjat yllä ja kirjaa todelliset toistot tähän. Tyhjä paino tarkoittaa tavoitepainoa, tyhjistä toistoista ei päätellä tulosta.</p>${rows}<label class="field">RIR – vaikeimman sarjan jälkeen varastoon jääneet toistot<input type="number" inputmode="numeric" min="0" max="5" step="1" value="${esc(e.rir ?? '')}" data-log="rir" data-e="${ei}" data-key="rir-${ei}" placeholder="0–5 (5 = vähintään 5)" aria-label="${esc(e.name)}: RIR"></label><label class="check"><span>Tunsin kipua<small>Älä jatka kipua aiheuttavaa liikettä. Kuormaa ei nosteta.</small></span><input type="checkbox" data-log="pain" data-e="${ei}" data-key="pain-${ei}" aria-label="${esc(e.name)}: kipua" ${e.pain ? 'checked' : ''}></label></details>`;
}

function recoveryControls(s) {
  return `${logError ? `<p class="banner" id="log-error" role="alert">${esc(logError)}</p>` : ''}<label class="check recovery-check"><span>Palautuminen on heikkoa<small>Voi keventää seuraavaa treeniä. Harkitse myös lepoa.</small></span><input type="checkbox" data-log="fatigued" data-key="fatigued" ${s.fatigued ? 'checked' : ''}></label>`;
}

function workoutView() {
  const s = state.session, p = core.progress(s), cur = core.currentExercise(s);
  const exercises = s.exercises.map((e, ei) => {
    const done = core.exerciseDone(e);
    const completed = e.sets.filter((set) => set.done).length;
    const nextSi = ei === cur ? e.sets.findIndex((set) => !set.done) : -1;
    const sets = e.sets.map((set, si) => setEntry(e, ei, si, nextSi)).join('');
    const individual = e.sets.some((set) => set.reps);
    const targets = individual ? e.sets.map((set) => core.targetLabel(set.reps ?? e.reps)).join(' / ') : core.targetLabel(e.reps);
    return `<li class="card ex ${done ? 'complete' : ''} ${ei === cur ? 'current' : ''}" id="exercise-${ei}"><div class="exercise-heading"><span class="exercise-index">${String(ei + 1).padStart(2, '0')}</span><div class="grow"><h2>${esc(e.name)}</h2><p class="target">${e.sets.length} sarjaa <span>${individual ? '·' : '×'}</span> ${esc(targets)}${e.weight ? ` <span class="weight-pill">${esc(e.weight)}</span>` : ''}</p></div>${done ? '<span class="badge done-badge">Tehty</span>' : ei === cur ? '<span class="badge now">Vuorossa</span>' : `<span class="badge">${completed}/${e.sets.length}</span>`}</div><div class="sets">${sets}</div><div class="exercise-footer"><span class="muted">${completed}/${e.sets.length} kirjattu</span><div class="mini"><button class="btn ghost" data-action="rmset" data-key="r${ei}" data-e="${ei}" ${e.sets.length < 2 ? 'disabled' : ''} aria-label="Poista sarja: ${esc(e.name)}">− Sarja</button><button class="btn ghost" data-action="addset" data-key="a${ei}" data-e="${ei}" ${e.sets.length >= core.MAX_SETS ? 'disabled' : ''} aria-label="Lisää sarja: ${esc(e.name)}">+ Sarja</button></div></div>${exerciseLog(e, ei)}</li>`;
  }).join('');
  return `<header class="session-header"><button class="btn ghost back" data-action="home" data-key="back" aria-label="Takaisin harjoituksiin">${icon('back')} Harjoituksiin</button><span class="session-time">${icon('clock')}<span id="elapsed">0:00</span></span></header>${warn()}<section class="session-intro card"><div class="row"><p class="eyebrow accent">${p.done === p.total ? 'KAIKKI SARJAT KIRJATTU' : 'HARJOITUS KÄYNNISSÄ'}</p><span class="session-stat">${p.done}/${p.total} sarjaa · ${p.pct}%</span></div><h1 tabindex="-1">${esc(s.name)}</h1>${progressBar(p)}<div class="session-summary"><p class="session-guide">${cur < 0 ? 'Hienoa työtä! Tallenna harjoitus lopettamalla.' : 'Napauta sarjaa kirjataksesi. Uusi napautus peruu.'} Muuta toteutuneita toistoja sarjan − / + -painikkeilla.</p><span class="muted">${s.exercises.filter(core.exerciseDone).length}/${s.exercises.length} liikettä</span></div>${cur > 0 ? `<button class="btn secondary jump" data-action="jump" data-key="jump">Jatka liikkeestä: ${esc(s.exercises[cur].name)} ${icon('arrow')}</button>` : ''}</section>${recoveryControls(s)}<ul class="list exercise-list">${exercises}</ul><div class="session-end"><button class="btn ${p.done === p.total ? 'primary' : 'secondary'} big" data-action="finish" data-key="finish">${p.done === p.total ? 'Tallenna harjoitus' : 'Lopeta kesken'} ${icon('check')}</button><button class="btn danger" data-action="discard" data-key="discard">Hylkää harjoitus</button><p class="small-copy muted">${storageOk ? 'Edistyminen tallennettu tälle laitteelle.' : 'Edistymistä ei ole tallennettu. Pidä välilehti auki.'}</p></div><div id="rest" class="rest" hidden></div>`;
}

function progressionEditor(e, i) {
  const config = progressionConfig(e);
  const savedRange = e.progression?.minReps !== undefined && e.progression?.maxReps !== undefined;
  return `<details class="progression-editor"><summary>Kehitysalue ja painoaskel</summary><p class="muted small-copy">${savedRange ? 'Tallennettu kehitysalue säilytetään.' : esc(progressionRange(e).reason)} Ehdotus: ${config.minReps}–${config.maxReps} toistoa. Yleistä 8–15-oletusta ei käytetä. Paino tarkoittaa samaa kg-kuormaa kuin tavoitepainossa, esimerkiksi yhden käsipainon painoa.</p><button class="btn secondary" data-action="autorange" data-i="${i}" data-key="autorange-${esc(e.id)}">Laske kehitysalue uudelleen</button><div class="grid3"><label class="field">Alaraja (toistoa)<input type="number" min="1" max="30" step="1" inputmode="numeric" value="${esc(e.progression?.minReps ?? config.minReps)}" data-progression="minReps" data-i="${i}" data-key="minReps-${esc(e.id)}"></label><label class="field">Yläraja (toistoa)<input type="number" min="1" max="30" step="1" inputmode="numeric" value="${esc(e.progression?.maxReps ?? config.maxReps)}" data-progression="maxReps" data-i="${i}" data-key="maxReps-${esc(e.id)}"></label><label class="field">Pienin painoaskel (kg)<input type="number" min="0.01" max="100" step="0.01" inputmode="decimal" value="${esc(e.progression?.weightStep ?? config.weightStep)}" data-progression="weightStep" data-i="${i}" data-key="weightStep-${esc(e.id)}"></label></div><label class="check"><span>Paino on ulkoinen kg-kuorma<small>Poista valinta avustetuille liikkeille tai muille kuormayksiköille: paino muuttuu silloin vain käsin.</small></span><input type="checkbox" data-progression="autoLoad" data-i="${i}" data-key="autoLoad-${esc(e.id)}" ${config.autoLoad ? 'checked' : ''}></label></details>`;
}

function setTargetFields(e, i) {
  return Array.from({ length: core.clampInt(e.sets, 1, core.MAX_SETS, 3) }, (_, si) => `<label class="field">Sarja ${si + 1}: toistot / aika<input type="text" maxlength="20" value="${esc(e.setReps[si] ?? e.reps)}" data-f="setReps" data-i="${i}" data-s="${si}" data-key="setReps-${esc(e.id)}-${si}" placeholder="8–12 / 30 s"></label>`).join('');
}

function editView() {
  const rows = draft.exercises.map((e, i) => {
    const individual = Array.isArray(e.setReps);
    const targets = individual ? setTargetFields(e, i) : '';
    return `<li class="card edit"><div class="row editor-row"><span class="eyebrow exercise-tag">LIIKE ${String(i + 1).padStart(2, '0')}</span><div class="mini"><button class="btn ghost icon-button" data-action="up" data-i="${i}" data-key="up-${esc(e.id)}" ${i === 0 ? 'disabled' : ''} aria-label="Siirrä ylös">↑</button><button class="btn ghost icon-button" data-action="down" data-i="${i}" data-key="down-${esc(e.id)}" ${i === draft.exercises.length - 1 ? 'disabled' : ''} aria-label="Siirrä alas">↓</button><button class="btn ghost danger-text" data-action="rmex" data-i="${i}" data-key="remove-${esc(e.id)}" aria-label="Poista liike ${i + 1}">Poista</button></div></div><div class="name-picker-row"><label class="field grow">Liikkeen nimi<input type="text" maxlength="60" value="${esc(e.name)}" data-f="name" data-i="${i}" data-key="name-${esc(e.id)}" autocomplete="off" placeholder="Esim. maljakyykky"></label><button class="btn secondary pick-exercise" data-action="pickex" data-id="${esc(e.id)}" data-key="pick-${esc(e.id)}">Valitse kirjastosta</button></div><div class="grid3"><label class="field">Sarjat<input type="number" inputmode="numeric" min="1" max="20" step="1" value="${esc(e.sets)}" data-f="sets" data-i="${i}" data-key="sets-${esc(e.id)}"></label><label class="field">${individual ? 'Oletustoistot / aika' : 'Toistot / aika'}<input type="text" maxlength="20" value="${esc(e.reps)}" data-f="reps" data-i="${i}" data-key="reps-${esc(e.id)}" placeholder="8–12 / 30 s"></label><label class="field">Paino <span class="optional">valinnainen</span><input type="text" maxlength="20" value="${esc(e.weight)}" data-f="weight" data-i="${i}" data-key="weight-${esc(e.id)}" placeholder="20 kg"></label></div><label class="check per-set-toggle"><span>Määritä toistot sarjakohtaisesti<small>${individual ? 'Uudet sarjat käyttävät oletustoistoja. Poista valinta käyttääksesi samaa tavoitetta kaikissa sarjoissa.' : 'Aseta jokaiselle sarjalle oma toistotavoite tai kesto.'}</small></span><input type="checkbox" data-f="individualReps" data-i="${i}" data-key="individualReps-${esc(e.id)}" ${individual ? 'checked' : ''}></label>${individual ? `<div class="set-targets">${targets}</div>` : ''}${progressionEditor(e, i)}</li>`;
  }).join('');
  return `<header class="editor-header"><button class="btn ghost back" data-action="home" data-key="cancel">${icon('back')} Peruuta</button><span class="eyebrow" id="draft-status" role="status">${draftOk ? 'LUONNOS SÄILYY TÄSSÄ VÄLILEHDESSÄ' : 'LUONNOS EI TALLENTUNUT — pidä välilehti auki'}</span></header>${warn()}<div class="editor-top"><p class="eyebrow accent">SUUNNITTELE HARJOITUKSESI</p><h1 tabindex="-1">${draft.isNew ? 'Uusi harjoitus' : 'Muokkaa harjoitusta'}</h1><p class="editor-copy">Valitse ${EXERCISES.length} liikkeestä tai lisää omasi. Aseta tavoitteet oman tasosi mukaan.</p></div><label class="field name-field">Harjoituksen nimi<input type="text" maxlength="60" value="${esc(draft.name)}" data-f="rname" data-key="rname" autocomplete="off" placeholder="Esim. ylävartalo A"></label><ul class="list editor-list">${rows}</ul><button class="btn secondary add-ex-btn" data-action="addex" data-key="addex" ${draft.exercises.length >= 60 ? 'disabled' : ''}>${icon('plus')} Lisää liike</button><p id="err" class="banner" role="alert" tabindex="-1" ${editError ? '' : 'hidden'}>${esc(editError)}</p><div class="editor-save"><button class="btn primary big" data-action="save" data-key="save">Tallenna harjoitus ${icon('check')}</button></div>${draft.isNew ? '' : '<button class="btn danger" data-action="delroutine" data-key="delroutine">Poista harjoitus</button>'}`;
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
    return `<li><button class="exercise-choice" data-action="chooseex" data-id="${esc(e.id)}" data-key="choice-${esc(e.id)}" ${added ? 'aria-disabled="true"' : ''}><span class="choice-icon">${icon('weight')}</span><span class="grow"><span class="sr">${added ? 'Lisätty harjoitukseen: ' : 'Valitse liike: '}</span><strong>${esc(e.name)}</strong><span class="choice-meta">${added ? 'Lisätty · ' : ''}${esc(e.category)} · ${esc(e.equipment)}${e.custom ? ' · Oma liike' : ''}</span></span>${icon(added ? 'check' : 'plus')}</button></li>`;
  }).join('');
}
function libraryView() {
  const rows = libraryMatches(), own = customEntry();
  return `<header class="editor-header"><button class="btn ghost back" data-action="backedit" data-key="backedit">${icon('back')} Takaisin harjoitukseen</button><span class="eyebrow">${EXERCISES.length} + ${state.customExercises.length} OMAA</span></header>${warn()}<div class="library-top"><h1 tabindex="-1">Liikekirjasto</h1><p class="editor-copy">${!picker.adding ? 'Valitse liike tähän kohtaan. Tavoitteet säilyvät.' : picker.keepOpen ? 'Napauta liikkeitä lisätäksesi ne. Palaa lopuksi harjoitukseen.' : 'Valitse harjoitukseen lisättävä liike.'} Haku toimii myös englanniksi.</p>${picker.adding ? `<button class="btn library-multi" data-action="multiex" data-key="multiex" aria-pressed="${picker.keepOpen}">${icon(picker.keepOpen ? 'check' : 'plus')} Lisää useita peräkkäin</button>` : ''}</div>
    <div role="search" aria-label="Liikkeiden haku" class="library-filters card"><label class="field">Hae liikettä<input type="search" id="exercise-search" data-key="exercise-search" maxlength="120" value="${esc(picker.query)}" placeholder="Esim. kyykky, ylätalja tai bench press" aria-controls="library-results" autocomplete="off"></label><div class="filter-grid">${choiceMenu('library-category', 'Lihasryhmä', CATEGORIES, picker.category, 'Kaikki lihasryhmät')}${choiceMenu('library-equipment', 'Väline', EQUIPMENT, picker.equipment, 'Kaikki välineet')}</div><label class="check library-own"><span>Vain omat liikkeet</span><input type="checkbox" id="library-own" data-key="library-own" ${picker.customOnly ? 'checked' : ''}></label><button class="btn secondary library-reset" data-action="resetfilters" data-key="resetfilters" ${hasLibraryFilters() ? '' : 'hidden'}>Tyhjennä haku ja suodattimet</button></div>
    <details class="custom-exercise card" ${customOpen ? 'open' : ''}><summary>Lisää oma liike ${icon('plus')}</summary><p class="small-copy muted">Oma liike tallentuu kirjastoon ja varmuuskopioon. Voit valita sen myöhemmin uudelleen.</p><form id="custom-exercise-form" novalidate><label class="field">Oman liikkeen nimi<input type="text" data-custom="name" data-key="custom-name" maxlength="60" value="${esc(own.name)}" required autocomplete="off"></label><div class="filter-grid">${choiceMenu('custom-category', 'Oman liikkeen lihasryhmä', CATEGORIES, own.category, '', true)}${choiceMenu('custom-equipment', 'Oman liikkeen väline', EQUIPMENT, own.equipment, '', true)}</div><label class="field">Oletustoistot / aika<input type="text" data-custom="reps" data-key="custom-reps" maxlength="20" value="${esc(own.reps)}" required></label><p id="custom-error" role="alert" tabindex="-1" class="banner" ${customError ? '' : 'hidden'}>${esc(customError)}</p><button type="submit" class="btn primary big">Tallenna ja lisää harjoitukseen ${icon('plus')}</button></form></details>
    <div class="section-head library-count"><h2>Liikkeet</h2><span id="library-count" class="muted small-copy" role="status">${rows.length} hakutulosta</span></div><ul id="library-results" class="list library-results">${libraryResults(rows)}</ul><div id="library-empty" class="empty-state" ${rows.length ? 'hidden' : ''}><h3>Liikettä ei löytynyt</h3><p>Kokeile toista hakusanaa tai lisää oma liike.</p><button class="btn secondary" data-action="newcustom" data-key="newcustom">Lisää haettu nimi omana liikkeenä</button></div><button class="btn secondary library-more" data-action="moreex" data-key="moreex" ${rows.length <= picker.limit ? 'hidden' : ''}>Näytä lisää liikkeitä</button>${picker.keepOpen ? `<div class="library-done"><p class="small-copy muted" role="status">${picker.added.length} lisätty harjoitukseen${draftOk ? '' : ' · Luonnos ei tallentunut. Pidä välilehti auki.'}</p><button class="btn primary big" data-action="backedit" data-key="library-done">Valmis · takaisin harjoitukseen ${icon('check')}</button></div>` : ''}`;
}
function updateLibraryResults() {
  const rows = libraryMatches();
  document.getElementById('library-results').innerHTML = libraryResults(rows);
  document.getElementById('library-count').textContent = `${rows.length} hakutulosta`;
  document.getElementById('library-empty').hidden = rows.length > 0;
  document.querySelector('[data-action="moreex"]').hidden = rows.length <= picker.limit;
  document.querySelector('[data-action="resetfilters"]').hidden = !hasLibraryFilters();
}
function openLibrary(target = null, adding = true) {
  picker = { query: '', category: '', equipment: '', customOnly: false, limit: 40, target, adding, keepOpen: false, added: [] };
  customOpen = false; customError = ''; view = 'library'; rememberDraft(); render();
}
function chooseExercise(exercise) {
  if (!exercise || !draft || picker.added.includes(exercise.id)) return;
  let row = picker.target && draft.exercises.find((e) => e.id === picker.target);
  if (!row) {
    if (draft.exercises.length >= 60) { announce('Harjoituksessa voi olla enintään 60 liikettä.'); return; }
    row = blankEx(); draft.exercises.push(row);
  }
  if (!row.name.trim()) row.reps = exercise.reps;
  row.name = exercise.name;
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
  renderUpdateNotice();
  tick(); syncWakeLock();
}

// Center within usable space, not behind the sticky header or floating timer.
// Oversized exercises show the next set instead of centering an unreadable card.
function showCurrentExercise({ focus = false, instant = false } = {}) {
  if (view !== 'workout' || !state.session || !storageOk || document.hidden) return;
  const index = core.currentExercise(state.session);
  const card = document.getElementById(`exercise-${index}`);
  const nextSet = card?.querySelector('.set.next') || card?.querySelector('.set');
  const viewport = window.visualViewport;
  const top = (viewport?.offsetTop ?? 0) + (document.querySelector('.session-header')?.getBoundingClientRect().height ?? 0) + 12;
  const viewportBottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight);
  const rest = document.getElementById('rest');
  const bottom = Math.min(viewportBottom, rest && !rest.hidden ? rest.getBoundingClientRect().top : viewportBottom) - 12;
  const height = Math.max(0, bottom - top);
  const target = card && card.getBoundingClientRect().height <= height ? card : nextSet || document.querySelector('[data-action="finish"]');
  if (!target || height < 48) return;
  const rect = target.getBoundingClientRect();
  if (focus) (nextSet || target).focus({ preventScroll: true });
  window.scrollTo({ top: Math.max(0, window.scrollY + rect.top - top - Math.max(0, (height - rect.height) / 2)), behavior: instant || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}

let exerciseScroll;
let scrollInteraction = 0;
function cancelExerciseScroll() { clearTimeout(exerciseScroll); scrollInteraction++; }
function scheduleExerciseScroll(sessionId, index) {
  cancelExerciseScroll();
  // Leave time to undo a mistaken last-set tap. Any new interaction cancels it.
  exerciseScroll = setTimeout(() => {
    if (state.session?.id === sessionId && core.currentExercise(state.session) === index) showCurrentExercise();
  }, 350);
}
for (const event of ['pointerdown', 'touchstart', 'wheel', 'keydown']) {
  document.addEventListener(event, cancelExerciseScroll, { passive: true });
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

async function changeRevision(id, undo = false) {
  let result;
  const ok = await mutate((next) => {
    result = undo ? undoRevision(next, id) : reviseRoutine(next, id);
    return result.ok;
  }, { critical: true });
  const message = ok || !result?.ok ? result?.message : 'Tarkistusta ei voitu tallentaa. Edelliset tavoitteet säilyvät; yritä uudelleen.';
  revisionMessages.set(id, message || 'Tarkistus ei onnistunut. Tarkista tallennuksen tila.');
  render(); announce(revisionMessages.get(id));
}

function logInput(t) {
  const field = t.dataset.log;
  const value = t.type === 'checkbox' ? t.checked : t.value.trim();
  const numeric = field === 'actualReps' || field === 'rir';
  const valid = !t.validity.badInput && (!numeric || value === '' || (/^\d+$/.test(value) && Number(value) <= (field === 'rir' ? 5 : 100))) &&
    (field !== 'actualWeight' || value === '' || parseWeight(value) !== null);
  if (!valid) {
    logError = field === 'actualWeight' ? 'Anna paino kilogrammoina (esim. 22,5) tai jätä kenttä tyhjäksi käyttääksesi tavoitepainoa.' : 'Anna kokonaisluku: toistot 0–100 tai RIR 0–5. Tyhjä tarkoittaa tuntematonta.';
    announce(logError); render(); return;
  }
  const options = sessionOptions(), ei = +t.dataset.e, si = +t.dataset.s;
  enqueueAction(async () => {
    logError = '';
    await mutate((next) => {
      const target = field === 'fatigued' ? next.session : ['rir', 'pain'].includes(field) ? next.session?.exercises[ei] : next.session?.exercises[ei]?.sets[si];
      if (!target) { announce('Kirjattavaa sarjaa ei enää löytynyt. Tarkista harjoitus.'); return false; }
      if (value === '' || value === false) delete target[field];
      else target[field] = value;
    }, { ...options, patch: () => patchLoggedSet(ei, si) });
  });
}

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

const actions = {
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
    announce(`Liikkeen ehdotus on ${range.minReps}–${range.maxReps} toistoa. Muutos tallentuu ohjelman tallennuksessa.`);
  },
  async revise(t) { await changeRevision(t.dataset.id); },
  async undorevision(t) { await changeRevision(t.dataset.id, true); },
  async start(t) {
    // Ask before taking the cross-tab write lock so a dialog cannot block other tabs.
    readLatest();
    let confirmed = false;
    if (state.session) {
      if (!confirm('Korvataanko keskeneräinen harjoitus? Sen kirjaukset menetetään.')) return;
      confirmed = true;
    }
    await mutate((next) => {
      if (next.session && !confirmed && !confirm('Korvataanko keskeneräinen harjoitus? Sen kirjaukset menetetään.')) return false;
      const session = core.startSession(byId(t.dataset.id, next));
      if (!session) { announce('Lisää ensin vähintään yksi liike.'); return false; }
      next.session = session; next.restEnd = null;
    });
    if (state.session) { view = 'workout'; render(); }
  },
  resume() { view = 'workout'; render(); showCurrentExercise({ focus: true }); },
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
    let advance = null;
    const interaction = scrollInteraction;
    const ok = await mutate((next) => {
      const ei = +t.dataset.e, si = +t.dataset.s, ex = next.session?.exercises[ei];
      if (!ex?.sets[si]) return false;
      const current = core.currentExercise(next.session);
      const done = core.toggleSet(next.session, ei, si);
      if (done) {
        navigator.vibrate?.(15);
        const p = core.progress(next.session);
        next.restEnd = next.settings.autoRest && p.done < p.total ? Date.now() + next.settings.restSeconds * 1000 : null;
        const following = core.currentExercise(next.session);
        if (ei === current && following > current) advance = { sessionId: next.session.id, index: following };
      }
      announce(`${ex.name}, sarja ${si + 1} ${done ? 'tehty' : 'kirjaus peruttu'}.${done && next.restEnd ? ` Lepoajastin käynnistyi, ${next.settings.restSeconds} sekuntia.` : ''}`);
    }, sessionOptions());
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
  async addset(t) { await mutate((next) => core.addSet(next.session, +t.dataset.e), sessionOptions()); },
  async rmset(t) {
    readLatest();
    const shown = state.session?.exercises[+t.dataset.e];
    let confirmed = false;
    if (shown?.sets.length > 1 && shown.sets.at(-1).done) {
      if (!confirm('Poistetaanko tehty sarja? Myös sen suoritusmerkintä poistuu.')) return;
      confirmed = true;
    }
    await mutate((next) => {
      const ex = next.session?.exercises[+t.dataset.e];
      if (!ex || ex.sets.length < 2) return false;
      if (ex.sets.at(-1).done && !confirmed && !confirm('Poistetaanko tehty sarja? Myös sen suoritusmerkintä poistuu.')) return false;
      core.removeSet(next.session, +t.dataset.e);
      const p = core.progress(next.session); if (p.done === p.total) next.restEnd = null;
    }, sessionOptions());
  },
  async skiprest() { await mutate((next) => { next.restEnd = null; }, sessionOptions()); },
  async plus() { await mutate((next) => { next.restEnd = Math.max(next.restEnd || 0, Date.now()) + 30000; }, sessionOptions()); },
  async finish() {
    let revisionResult, routineId;
    readLatest();
    let confirmed = false;
    if (state.session) {
      const shown = core.progress(state.session);
      if (shown.done < shown.total) {
        if (!confirm(`${shown.total - shown.done} sarjaa on tekemättä. Lopetetaanko silti?`)) return;
        confirmed = true;
      }
    }
    const ok = await mutate((next) => {
      if (!next.session) return false;
      const p = core.progress(next.session);
      if (p.done < p.total && !confirmed && !confirm(`${p.total - p.done} sarjaa on tekemättä. Lopetetaanko silti?`)) return false;
      routineId = next.session.routineId;
      if (p.done) next.history.unshift(core.summarize(next.session));
      next.history = next.history.slice(0, core.MAX_HISTORY); next.session = null; next.restEnd = null;
      if (p.done && byId(routineId, next)?.autoProgress) revisionResult = reviseRoutine(next, routineId);
    }, { ...sessionOptions(), critical: true });
    if (ok) {
      if (revisionResult) revisionMessages.set(routineId, revisionResult.message);
      view = 'home'; render(); announce(`Harjoitus tallennettu. Hienoa työtä! ${revisionResult?.message ?? ''}`);
    }
  },
  async discard() {
    if (!confirm('Hylätäänkö harjoitus? Suoritusmerkinnät menetetään.')) return;
    if (await mutate((next) => { next.session = null; next.restEnd = null; }, { ...sessionOptions(), critical: true })) { view = 'home'; render(); }
  },
  new() { openDraft({ id: core.uid(), name: '', exercises: [blankEx()] }, true); },
  edit(t) { const r = byId(t.dataset.id); if (r) openDraft(r, false); },
  addex() { if (draft.exercises.length >= 60) return; openLibrary(draft.exercises.find((e) => !e.name.trim())?.id ?? null); },
  pickex(t) { openLibrary(t.dataset.id, false); },
  backedit() { view = 'edit'; render(); document.querySelector(picker.target ? `[data-key="pick-${CSS.escape(picker.target)}"]` : '[data-key="addex"]')?.focus(); },
  chooseex(t) { chooseExercise([...EXERCISES, ...state.customExercises].find((e) => e.id === t.dataset.id)); },
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
    if (!confirm('Poistetaanko harjoitusohjelma? Keskeneräinen harjoitus ei muutu.')) return;
    const ok = await mutate((next) => {
      if (next.routines.length < 2) { editorError('Säilytä vähintään yksi harjoitus. Luo ensin uusi ohjelma.'); return false; }
      if (JSON.stringify(byId(draft.id, next)) !== draft.base) { editorError('Harjoitus muuttui toisessa välilehdessä. Peruuta ja avaa se uudelleen ennen poistamista.'); return false; }
      next.routines = next.routines.filter((r) => r.id !== draft.id);
    }, { critical: true });
    if (ok) { clearDraft(); view = 'home'; render(); }
  },
  jump() { showCurrentExercise({ focus: true }); },
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
    if (!confirm('Aloitetaanko tyhjästä? Vioittuneet tiedot siirretään talteen selaimen tallennustilaan, mutta sovellus ei enää näytä niitä. Vie ne ensin tiedostoksi, jos haluat säilyttää ne.')) return;
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
  e.preventDefault(); enqueueAction(() => actions[t.dataset.action](t));
});
document.addEventListener('submit', (e) => {
  if (e.target.id !== 'custom-exercise-form') return;
  e.preventDefault(); enqueueAction(() => actions.createcustom());
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.log && t.type !== 'checkbox') {
    // Keep valid edits durable before blur; unfinished input is validated on change.
    if (t.validity.valid && (t.dataset.log !== 'actualWeight' || !t.value.trim() || parseWeight(t.value) !== null)) logInput(t);
    return;
  }
  if (t.id === 'exercise-search') { picker.query = t.value; picker.limit = 40; updateLibraryResults(); return; }
  if (t.dataset.custom && draft) { customEntry()[t.dataset.custom] = t.value; rememberDraft(); return; }
  if (t.dataset.progression && draft && t.type !== 'checkbox') {
    const exercise = draft.exercises[+t.dataset.i];
    const config = progressionConfig(exercise);
    if (['minReps', 'maxReps'].includes(t.dataset.progression)) exercise.progression = config;
    else exercise.progression ??= { weightStep: config.weightStep, autoLoad: config.autoLoad };
    exercise.progression[t.dataset.progression] = t.value;
    rememberDraft(); return;
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
document.addEventListener('change', async (e) => {
  const t = e.target;
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
  if (t.dataset.action === 'restsecs') {
    const seconds = core.clampInt(t.value, 10, 600, 90);
    await mutate((next) => { next.settings.restSeconds = seconds; });
  }
});
document.addEventListener('toggle', (e) => {
  if (e.target.matches('.exercise-log')) {
    if (e.target.open) openLogs.add(e.target.dataset.logPanel);
    else openLogs.delete(e.target.dataset.logPanel);
  }
  if (e.target.matches('.settings')) settingsOpen = e.target.open;
  if (e.target.matches('.custom-exercise')) customOpen = e.target.open;
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
  if (document.visibilityState === 'visible') {
    readLatest(); if (view !== 'edit') render();
    updateDismissed = false; renderUpdateNotice(); void checkForUpdates();
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
    if (!controlled) return;
    clearTimeout(updateTimer);
    updateBusy = false; reloadPending = true;
    if (dirty || saveConflict || (draft && !draftOk) || pendingActions > 1) {
      updateFailed('Uusi versio on valmis, mutta tässä ikkunassa on tallentamattomia muutoksia. Tallenna ne ennen uudelleenavausta.');
    } else window.location.reload();
  });
  void registerUpdates();
}
render();
if (view === 'workout') showCurrentExercise({ instant: true });
