// Bump VERSION on every release. All files are cached together so app.js and core.js can never be mixed across versions.
const VERSION = '60';
const CACHE = `gym-tracker-v${VERSION}`;
const ASSETS = ['./', './index.html', './app.js', './core.js', './autobackup.js', './progression.js', './cheers.js', './heartrate.js', './timer.js', './statistics.js', './statistics-ui.js', './exercises.js', './appearance.js', './styles.css', './aurora.css', './release-notes.json', './manifest.webmanifest', './icon.svg', './icon-180.png', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];

self.addEventListener('install', (e) => {
  // cache:'reload' bypasses the HTTP cache so a new version never stores stale files.
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      // Do not force-activate over a running workout. New files take over once old tabs close.
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith('gym-tracker-v') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Lets the running page show what a waiting version changes before it is activated.
self.addEventListener('message', (e) => {
  if (e.data?.type === 'RELEASE_INFO' && e.ports[0]) {
    const port = e.ports[0];
    e.waitUntil((async () => {
      const hit = await (await caches.open(CACHE)).match('./release-notes.json');
      port.postMessage({ version: VERSION, notes: hit ? await hit.json() : [] });
    })().catch(() => port.postMessage(null)));
  }
});

// Explicit acceptance can activate immediately, but never disrupt another visible window.
// Hidden tabs (iOS Chrome keeps them alive for days) reload into the new version when reopened.
self.addEventListener('message', (e) => {
  if (e.data?.type !== 'APPLY_UPDATE' || !e.ports[0] || !e.source?.id) return;
  const reply = (data) => e.ports[0].postMessage(data);
  e.waitUntil((async () => {
    const clients = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .filter((client) => client.url.startsWith(self.registration.scope));
    if (!clients.some((client) => client.id === e.source.id) || clients.some((client) => client.id !== e.source.id && client.visibilityState !== 'hidden')) {
      reply({ ok: false, reason: 'other-windows' }); return;
    }
    await self.skipWaiting();
    reply({ ok: true });
  })().catch(() => reply({ ok: false, reason: 'activation-failed' })));
});

// Cache-first: instant and fully offline. The new version takes effect on the next launch.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      try { return await fetch(e.request); }
      catch {
        if (e.request.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
        return new Response('Unavailable offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })
  );
});
