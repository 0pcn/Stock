const CACHE='stockfolio-shell-v1';
const ASSETS=['/offline.html','/icon.svg','/icons/icon-192.png','/icons/icon-512.png','/icons/apple-touch-icon.png','/manifest.webmanifest'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(Promise.all([caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))),self.clients.claim()]))});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==location.origin)return;if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).catch(()=>caches.match('/offline.html')));return}if(ASSETS.includes(new URL(e.request.url).pathname))e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request)))});
