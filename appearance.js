// Per-device appearance (Dark mode or Aurora). Runs as a classic script in <head> so the
// theme is applied before first paint. It never touches training data: the choice lives under
// its own key and is not part of backups or the saved workout state.
(function () {
  'use strict';
  var KEY = 'gym-tracker-appearance-v1';
  var THEMES = {
    dark: { color: '#101313', scheme: 'dark', status: 'black-translucent' },
    aurora: { color: '#f7f6fc', scheme: 'light', status: 'default' },
  };
  var DEFAULT = 'dark';
  var root = document.documentElement;
  var theme = DEFAULT;
  var saved = true;

  function stored() {
    try {
      var value = localStorage.getItem(KEY);
      return Object.prototype.hasOwnProperty.call(THEMES, value) ? value : DEFAULT;
    } catch (error) { return DEFAULT; }
  }

  function paint(name) {
    theme = name;
    root.dataset.theme = name;
    var color = document.querySelector('meta[name="theme-color"]');
    if (color) color.setAttribute('content', THEMES[name].color);
    var scheme = document.querySelector('meta[name="color-scheme"]');
    if (scheme) scheme.setAttribute('content', THEMES[name].scheme);
    // iOS reads this when the home-screen app launches; light pages need dark status-bar text.
    var status = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (status) status.setAttribute('content', THEMES[name].status);
  }

  function announce() {
    try { window.dispatchEvent(new CustomEvent('appearancechange', { detail: { theme: theme, saved: saved } })); } catch (error) { /* Painting already happened. */ }
  }

  function resync() {
    if (!saved) return;
    var next = stored();
    if (next === theme) return;
    paint(next);
    announce();
  }

  function set(name) {
    if (!Object.prototype.hasOwnProperty.call(THEMES, name)) return saved;
    paint(name);
    try { localStorage.setItem(KEY, name); saved = true; } catch (error) { saved = false; }
    announce();
    return saved;
  }

  paint(stored());

  window.addEventListener('storage', function (event) {
    if (event.key !== KEY && event.key !== null) return;
    saved = true;
    resync();
  });
  window.addEventListener('pageshow', function (event) { if (event.persisted) resync(); });

  window.TrackerAppearance = {
    get theme() { return theme; },
    get saved() { return saved; },
    set: set,
  };
}());
