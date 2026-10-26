const SCOPE=new URL(self.registration.scope).pathname;
const CACHE='stockfolio-shell-v2-'+SCOPE;
const ASSETS=['offline.html','icon.svg','icons/icon-192.png','icons/icon-512.png','icons/apple-touch-icon.png','manifest.webmanifest'].map(path=>SCOPE+path);
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(Promise.all([caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('stockfolio-shell-')&&k!==CACHE&&(k.endsWith(SCOPE)||k==='stockfolio-shell-v1')).map(k=>caches.delete(k)))),self.clients.claim()]))});
self.addEventListener('fetch',e=>{const url=new URL(e.request.url);if(e.request.method!=='GET'||url.origin!==location.origin||!url.pathname.startsWith(SCOPE))return;if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).catch(()=>caches.match(SCOPE+'offline.html')));return}if(ASSETS.includes(url.pathname))e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request)))});
