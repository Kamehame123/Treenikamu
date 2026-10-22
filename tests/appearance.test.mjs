import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../appearance.js', import.meta.url), 'utf8');
const KEY = 'gym-tracker-appearance-v1';

// A minimal browser: only what appearance.js touches, with every storage call recorded.
function load({ stored = null, failRead = false, failWrite = false } = {}) {
  const store = new Map(stored === null ? [] : [[KEY, stored]]);
  const calls = [];
  const metas = {
    'theme-color': { content: '#101313', setAttribute(name, value) { this.content = value; } },
    'color-scheme': { content: 'dark', setAttribute(name, value) { this.content = value; } },
    'apple-mobile-web-app-status-bar-style': { content: 'black-translucent', setAttribute(name, value) { this.content = value; } },
  };
  const listeners = {};
  const events = [];
  const window = {
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    dispatchEvent(event) { events.push({ ...event.detail }); return true; },
  };
  const context = {
    window,
    document: {
      documentElement: { dataset: {} },
      querySelector(selector) { return metas[/name="([^"]+)"/.exec(selector)[1]] ?? null; },
    },
    localStorage: {
      getItem(key) { calls.push(['get', key]); if (failRead) throw new Error('denied'); return store.has(key) ? store.get(key) : null; },
      setItem(key, value) { calls.push(['set', key]); if (failWrite) throw new Error('quota'); store.set(key, String(value)); },
    },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
  };
  vm.runInNewContext(source, context);
  const fire = (type, event = {}) => (listeners[type] ?? []).forEach((fn) => fn(event));
  return { api: window.TrackerAppearance, html: context.document.documentElement, metas, store, calls, events, fire };
}

test('defaults to Dark mode when nothing is stored, regardless of anything else', () => {
  const { api, html, metas } = load();
  assert.deepEqual([api.theme, api.saved, html.dataset.theme], ['dark', true, 'dark']);
  assert.deepEqual([metas['theme-color'].content, metas['color-scheme'].content], ['#101313', 'dark']);
});

test('applies a stored Aurora choice before anything else runs and updates the browser chrome', () => {
  const { api, html, metas } = load({ stored: 'aurora' });
  assert.deepEqual([api.theme, html.dataset.theme], ['aurora', 'aurora']);
  assert.deepEqual([metas['theme-color'].content, metas['color-scheme'].content, metas['apple-mobile-web-app-status-bar-style'].content], ['#f7f6fc', 'light', 'default']);
});

test('invalid, empty and prototype-named stored values fall back to Dark', () => {
  for (const stored of ['', 'light', 'AURORA', 'toString', '__proto__', '{"theme":"aurora"}']) assert.equal(load({ stored }).api.theme, 'dark', stored);
});

test('an unreadable store falls back to Dark without throwing', () => {
  const { api, html } = load({ failRead: true });
  assert.deepEqual([api.theme, html.dataset.theme], ['dark', 'dark']);
});

test('set saves the choice under its own key only, repaints and announces once', () => {
  const { api, html, store, calls, events, metas } = load();
  assert.equal(api.set('aurora'), true);
  assert.deepEqual([...store.entries()], [[KEY, 'aurora']]);
  assert.deepEqual(calls.filter(([op]) => op === 'set'), [['set', KEY]]);
  assert.deepEqual(calls.map(([, key]) => key).filter((key, i, all) => all.indexOf(key) === i), [KEY]);
  assert.deepEqual([html.dataset.theme, metas['theme-color'].content], ['aurora', '#f7f6fc']);
  assert.deepEqual(events, [{ theme: 'aurora', saved: true }]);
  api.set('dark');
  assert.deepEqual([store.get(KEY), html.dataset.theme, metas['theme-color'].content], ['dark', 'dark', '#101313']);
});

test('set rejects unknown themes without changing anything', () => {
  const { api, store, events } = load({ stored: 'aurora' });
  for (const bad of ['light', '', undefined, null, 'toString', 'constructor']) api.set(bad);
  assert.deepEqual([api.theme, store.get(KEY), events.length], ['aurora', 'aurora', 0]);
});

test('a failed write keeps the choice in this tab and reports it as not saved', () => {
  const { api, html, events } = load({ failWrite: true });
  assert.equal(api.set('aurora'), false);
  assert.deepEqual([api.theme, api.saved, html.dataset.theme], ['aurora', false, 'aurora']);
  assert.deepEqual(events, [{ theme: 'aurora', saved: false }]);
});

test('another tab changing the choice is applied without writing anything', () => {
  const { api, html, store, calls, events, fire } = load();
  store.set(KEY, 'aurora');
  calls.length = 0;
  fire('storage', { key: 'gym-tracker-v1' });
  assert.equal(api.theme, 'dark', 'training-data storage events are ignored');
  fire('storage', { key: KEY });
  assert.deepEqual([api.theme, html.dataset.theme], ['aurora', 'aurora']);
  assert.deepEqual(events, [{ theme: 'aurora', saved: true }]);
  assert.equal(calls.some(([op]) => op === 'set'), false);
  store.delete(KEY);
  fire('storage', { key: null });
  assert.equal(api.theme, 'dark', 'clearing site data returns to Dark');
});

test('a bfcache restore resyncs with the stored choice', () => {
  const { api, store, fire } = load();
  store.set(KEY, 'aurora');
  fire('pageshow', { persisted: false });
  assert.equal(api.theme, 'dark');
  fire('pageshow', { persisted: true });
  assert.equal(api.theme, 'aurora');
});

test('the controller never touches training data, backups or any other storage key', () => {
  assert.doesNotMatch(source, /gym-tracker-v1|gym-tracker-last-backup|gym-tracker-draft|sessionStorage|indexedDB|removeItem|\.clear\(/);
});
