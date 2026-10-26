import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
const shell = '<div id="root"></div><script src="/Stock/assets/app.js"></script><link rel="stylesheet" href="/Stock/assets/app.css">';
function fixture() {
  const events = {}, entries = new Map(), fetched = [], cachesByName = new Map();
  let online = true;
  const key = request => new URL(typeof request === 'string' ? request : request.url, 'https://0pcn.github.io').pathname;
  const fetcher = async request => {
    const path = key(request); fetched.push(path);
    if (!online) throw new Error('Offline');
    return new Response(path === '/Stock/' ? shell : 'public asset: ' + path);
  };
  const cache = {
    async addAll(paths) { for (const path of paths) entries.set(path, await fetcher(path)); },
    async put(request, response) { entries.set(key(request), new Response(await response.text())); },
    async match(request) { return entries.get(key(request))?.clone(); },
  };
  const caches = {
    async open(name) { cachesByName.set(name, cache); return cache; },
    async keys() { return [...cachesByName.keys()]; }, async delete(name) { return cachesByName.delete(name); },
  };
  const context = { URL, Response, location: { origin: 'https://0pcn.github.io' }, fetch: fetcher, caches,
    self: { registration: { scope: 'https://0pcn.github.io/Stock/' }, clients: { claim: async () => {} }, skipWaiting() {}, addEventListener(name, callback) { events[name] = callback; } } };
  vm.runInNewContext(source, context);
  return {
    entries, fetched, offline() { online = false; },
    async install() { const waits = []; events.install({ waitUntil(promise) { waits.push(promise); } }); await Promise.all(waits); },
    async request(url, mode = 'cors', method = 'GET') {
      let response; const waits = [];
      events.fetch({ request: { url, mode, method }, respondWith(promise) { response = promise; }, waitUntil(promise) { waits.push(promise); } });
      const result = await response;
      const body = result ? await result.text() : undefined;
      await Promise.all(waits);
      return body;
    },
  };
}

test('the public app shell and bundles allow an offline reopen under /Stock/', async () => {
  const f = fixture(); await f.install(); f.offline();
  assert.equal(await f.request('https://0pcn.github.io/Stock/', 'navigate'), shell);
  assert.equal(await f.request('https://0pcn.github.io/Stock/assets/app.js'), 'public asset: /Stock/assets/app.js');
  assert.equal(await f.request('https://0pcn.github.io/Stock/assets/app.css'), 'public asset: /Stock/assets/app.css');
  assert.ok([...f.entries.keys()].every(path => path.startsWith('/Stock/')));
});
test('navigation caching survives the browser consuming its response before bundle caching finishes', async () => {
  const f = fixture();
  assert.equal(await f.request('https://0pcn.github.io/Stock/', 'navigate'), shell);
  f.offline(); assert.equal(await f.request('https://0pcn.github.io/Stock/', 'navigate'), shell);
});
test('the service worker does not intercept Google requests, OAuth routes or private API responses', async () => {
  const f = fixture();
  for (const [url, mode, method] of [
    ['https://sheets.googleapis.com/v4/spreadsheets/private', 'cors', 'GET'],
    ['https://script.googleapis.com/v1/scripts/private:run', 'cors', 'POST'],
    ['https://accounts.google.com/gsi/client', 'cors', 'GET'],
    ['https://0pcn.github.io/Stock/api/portfolio', 'cors', 'POST'],
    ['https://0pcn.github.io/Stock/api/auth/google/callback?code=secret', 'navigate', 'GET'],
    ['https://0pcn.github.io/another-app/', 'navigate', 'GET'],
  ]) assert.equal(await f.request(url, mode, method), undefined);
  assert.equal(f.fetched.length, 0); assert.equal(f.entries.size, 0);
});
