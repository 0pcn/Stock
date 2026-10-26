const SCOPE = new URL(self.registration.scope).pathname;
const CACHE = 'stockfolio-shell-v3-' + SCOPE;
// Only public app files live here. Financial rows stay in device IndexedDB.
const ASSETS = ['offline.html', 'privacy.html', 'icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'manifest.webmanifest'].map(path => SCOPE + path);
const isShell = html => html.includes('id="root"') && html.includes(SCOPE + 'assets/');
function bundles(html) {
  return [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/g)]
    .map(match => new URL(match[1], self.registration.scope))
    .filter(url => url.origin === location.origin && url.pathname.startsWith(SCOPE + 'assets/'))
    .map(url => url.pathname);
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
    try {
      const response = await fetch(SCOPE, { cache: 'no-store' });
      const html = await response.clone().text();
      if (response.ok && isShell(html)) {
        await cache.addAll(bundles(html));
        await cache.put(SCOPE, response);
      }
    } catch { /* The offline explanation remains available if the shell cannot load. */ }
  })());
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('stockfolio-shell-') && key !== CACHE && (key.endsWith(SCOPE) || key === 'stockfolio-shell-v1')).map(key => caches.delete(key)))),
    self.clients.claim(),
  ]));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith(SCOPE)) return;
  if (event.request.mode === 'navigate' && [SCOPE, SCOPE + 'index.html'].includes(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(event.request, { cache: 'no-store' });
        const html = await response.clone().text();
        if (response.ok && isShell(html)) {
          const copy = response.clone();
          event.waitUntil((async () => { await cache.addAll(bundles(html)); await cache.put(SCOPE, copy); })().catch(() => {}));
        }
        return response;
      } catch { return await cache.match(SCOPE) || await cache.match(SCOPE + 'offline.html'); }
    })());
    return;
  }
  const publicFile = ASSETS.includes(url.pathname) || (url.pathname.startsWith(SCOPE + 'assets/') && /\.(js|css)$/.test(url.pathname));
  if (!publicFile) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const saved = await cache.match(event.request);
    if (saved) return saved;
    const response = await fetch(event.request);
    if (response.ok) await cache.put(event.request, response.clone());
    return response;
  })());
});
