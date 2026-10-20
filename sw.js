// Bump VERSION on every release. All files are cached together so app.js and core.js can never be mixed across versions.
const VERSION = '8';
const CACHE = `gym-tracker-v${VERSION}`;
const ASSETS = ['./', './index.html', './app.js', './core.js', './exercises.js', './styles.css', './manifest.webmanifest', './icon.svg', './icon-180.png', './icon-192.png', './icon-512.png'];

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
