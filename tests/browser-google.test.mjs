import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createBrowserGoogle } from '../lib/browser-google.mjs';
import { SCRIPT_SCOPES } from '../scripts/local-google/price-refresh.mjs';
import { SPREADSHEET_ID } from '../lib/portfolio-sources.mjs';

function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem(key, value) { values.set(key, value); }, removeItem(key) { values.delete(key); }, clear() { values.clear(); }, get length() { return values.size; } };
}

function fixture(overrides = {}) {
  let time = Date.now(), callback, timer;
  const storage = memoryStorage(), events = new EventTarget();
  const calls = { auth: [], requests: [], token: 'alice-access', scope: SCRIPT_SCOPES.join(' '), expiry: 3600 };
  const oauth = { initTokenClient(options) { callback = options.callback; calls.auth.push(options); return { requestAccessToken(request) { calls.prompt = request; if (!calls.manual) callback({ access_token: calls.token, expires_in: calls.expiry, scope: calls.scope }); } }; } };
  const fetcher = async (url, options) => {
    calls.requests.push({ url, ...options }); if (calls.wait) await calls.wait;
    if (calls.failure) return Response.json({ error: 'secret-provider-detail' }, { status: calls.failure });
    return Response.json(url.startsWith('https://script.googleapis.com/') ? { done: true, response: { result: calls.result || { status: 'success', updated: 16, failed: [], updatedAt: '2026-10-26T07:00:00.000Z' } } } : { values: [['代號'], ['0050']] });
  };
  const config = { clientId: 'test-client.apps.googleusercontent.com', deploymentId: 'test-api-deployment-1234567890', getOAuth: () => oauth, initialize: async () => {}, fetcher, now: () => time, schedule: (fn, delay) => { timer = fn; calls.delay = delay; return 1; }, cancel: () => {}, getStorage: () => storage, events, ...overrides };
  const api = createBrowserGoogle(config);
  return { api, calls, config, storage, events, expire() { time += 3600_000; timer(); }, advance(ms) { time += ms; }, complete(response) { callback(response); } };
}

test('Pages starts on the login gate and cannot read or update before Google consent', async () => {
  const f = fixture(); assert.equal((await f.api.status()).mode, 'pages'); assert.equal((await f.api.status()).connected, false);
  assert.equal((await f.api.read('holdings')).status, 'reauthentication_required');
  assert.equal((await f.api.refresh(randomUUID())).status, 'reauthentication_required'); assert.equal(f.calls.requests.length, 0);
});
test('Pages requests a popup directly from the click and uses only a public Client ID', async () => {
  const f = fixture(); const login = f.api.login(); assert.equal(f.calls.auth.length, 1);
  assert.equal((await login).status, 'success'); assert.equal(f.calls.prompt.prompt, 'select_account');
  assert.equal(f.calls.auth[0].scope, SCRIPT_SCOPES.join(' ')); assert.ok(!('client_secret' in f.calls.auth[0]));
  assert.equal((await f.api.status()).connected, true);
});
test('browser reads are fixed to the stock sheet, omit cookies and never call a website backend', async () => {
  const f = fixture(); await f.api.login();
  assert.equal((await f.api.read('holdings')).status, 'success'); assert.ok(f.calls.requests[0].url.includes(SPREADSHEET_ID));
  assert.equal(f.calls.requests[0].headers.Authorization, 'Bearer alice-access'); assert.equal(f.calls.requests[0].credentials, 'omit');
  assert.equal(f.calls.requests[0].cache, 'no-store'); assert.equal((await f.api.read('__proto__')).status, 'invalid_request');
  assert.ok(f.calls.requests.every(call => call.url.startsWith('https://sheets.googleapis.com/')));
});
test('manual sync calls only the fixed script, deduplicates one click and reports viewers', async () => {
  const f = fixture(); await f.api.login(); const id = randomUUID();
  assert.equal((await f.api.refresh(id)).status, 'success'); assert.equal((await f.api.refresh(id)).status, 'success');
  assert.equal(f.calls.requests.length, 1); const call = f.calls.requests[0]; assert.equal(call.method, 'POST');
  assert.equal(call.url, 'https://script.googleapis.com/v1/scripts/test-api-deployment-1234567890:run');
  assert.deepEqual(JSON.parse(call.body), { function: 'stockfolioRefreshCurrentPrices', parameters: [], devMode: false });
  f.calls.result = { status: 'forbidden' }; assert.equal((await f.api.refresh(randomUUID())).status, 'permission_denied');
});
test('logout and expiration clear the token and late reads cannot restore portfolio data', async () => {
  const f = fixture(); await f.api.login(); let release;
  f.calls.wait = new Promise(resolve => { release = resolve; }); const reading = f.api.read('holdings');
  await f.api.logout(); release(); assert.equal((await reading).status, 'reauthentication_required'); assert.equal((await f.api.status()).connected, false);
  await f.api.login(); let notifications = 0; f.api.subscribe(() => notifications++); f.expire();
  assert.equal(notifications, 1); assert.equal((await f.api.status()).connected, false);
  assert.equal((await f.api.refresh(randomUUID())).status, 'reauthentication_required');
});
test('switching accounts discards old responses and a new device starts with no saved token', async () => {
  const f = fixture(); await f.api.login(); let release;
  f.calls.wait = new Promise(resolve => { release = resolve; }); const alice = f.api.read('holdings');
  f.calls.token = 'bob-access'; await f.api.login(); release(); assert.equal((await alice).status, 'reauthentication_required');
  await f.api.read('holdings'); assert.equal(f.calls.requests[1].headers.Authorization, 'Bearer bob-access');
  assert.equal((await fixture().api.status()).connected, false);
});
test('reopening a page restores an unexpired authorization without another popup or extending its expiry', async () => {
  const f = fixture(); await f.api.login();
  assert.equal(f.storage.length, 1);
  f.advance(20 * 60_000);
  const reopened = fixture({ getStorage: () => f.storage, now: f.config.now });
  assert.equal((await reopened.api.status()).connected, true);
  assert.equal(reopened.calls.auth.length, 0);
  assert.equal(reopened.calls.delay, 40 * 60_000 - 10_000);
  assert.equal((await reopened.api.read('holdings')).status, 'success');
  assert.equal(reopened.calls.requests[0].headers.Authorization, 'Bearer alice-access');
  assert.equal(reopened.calls.requests.length, 1); // Restoring login never updates prices.
  f.advance(40 * 60_000);
  assert.equal((await reopened.api.status()).connected, false);
  assert.equal(f.storage.length, 0);
});
test('logout, expiry and revoked tokens remove the remembered authorization', async () => {
  for (const action of ['logout', 'expire', 'revoked']) {
    const f = fixture(); await f.api.login();
    if (action === 'logout') await f.api.logout();
    if (action === 'expire') f.expire();
    if (action === 'revoked') { f.calls.failure = 401; await f.api.read('holdings'); }
    assert.equal(f.storage.length, 0, action);
    assert.equal((await fixture({ getStorage: () => f.storage }).api.status()).connected, false, action);
  }
});
test('expired, malformed and incomplete saved authorizations cannot pass the login gate', async () => {
  const f = fixture(); await f.api.login();
  const key = `stockfolio.google-auth.v1:${f.config.clientId}`, original = JSON.parse(f.storage.getItem(key));
  const invalid = [
    '{', 'null',
    JSON.stringify({ ...original, version: 2 }),
    JSON.stringify({ ...original, clientId: 'other.apps.googleusercontent.com' }),
    JSON.stringify({ ...original, scope: SCRIPT_SCOPES[0] }),
    JSON.stringify({ ...original, access_token: '' }),
    JSON.stringify({ ...original, expiry_date: String(original.expiry_date) }),
    JSON.stringify({ ...original, expiry_date: f.config.now() + 9_000 }),
    JSON.stringify({ ...original, expiry_date: f.config.now() - 1 }),
  ];
  for (const value of invalid) {
    f.storage.setItem(key, value);
    const reopened = fixture({ getStorage: () => f.storage, now: f.config.now });
    assert.equal((await reopened.api.status()).connected, false);
    assert.equal((await reopened.api.read('holdings')).status, 'reauthentication_required');
    assert.equal(reopened.calls.requests.length, 0);
    assert.equal(f.storage.length, 0);
  }
});
test('unavailable or full browser storage does not prevent login, reads or logout', async () => {
  const fail = () => { throw new Error('Storage is blocked'); };
  for (const getStorage of [fail, () => ({ getItem: fail, setItem: fail, removeItem: fail }), () => ({ getItem: () => null, setItem: fail, removeItem: fail })]) {
    const f = fixture({ getStorage });
    assert.equal((await f.api.login()).status, 'success');
    assert.equal((await f.api.read('holdings')).status, 'success');
    assert.equal((await f.api.logout()).status, 'success');
    assert.equal((await f.api.status()).connected, false);
  }
});
test('another tab logging out immediately clears this tab and a suspended tab checks storage on return', async () => {
  const f = fixture(); await f.api.login();
  const other = fixture({ getStorage: () => f.storage, now: f.config.now });
  let notifications = 0; const unsubscribe = other.api.subscribe(() => notifications++);
  await f.api.logout();
  const event = new Event('storage');
  Object.assign(event, { key: `stockfolio.google-auth.v1:${f.config.clientId}`, storageArea: f.storage });
  other.events.dispatchEvent(event);
  assert.equal(notifications, 1);
  assert.equal((await other.api.status()).connected, false); unsubscribe();
  await f.api.login();
  const suspended = fixture({ getStorage: () => f.storage, now: f.config.now });
  await f.api.logout();
  assert.equal((await suspended.api.read('holdings')).status, 'reauthentication_required');
  assert.equal(suspended.calls.requests.length, 0);
});
test('returning from the background checks expiry even when the browser has paused timers', async () => {
  for (const type of ['focus', 'pageshow']) {
    const f = fixture(); await f.api.login(); let notifications = 0;
    const unsubscribe = f.api.subscribe(() => notifications++);
    f.advance(3600_000); // Do not fire the token expiry timer.
    f.events.dispatchEvent(new Event(type));
    assert.equal(notifications, 1);
    assert.equal(f.storage.length, 0);
    assert.equal((await f.api.status()).connected, false); unsubscribe();
  }
});
test('an older tab cannot erase another account or let a stale unauthorized response remove a new login', async () => {
  const f = fixture(); await f.api.login();
  const oldTab = fixture({ getStorage: () => f.storage, now: f.config.now });
  f.calls.token = 'bob-access'; await f.api.login();
  await oldTab.api.logout();
  assert.equal((await fixture({ getStorage: () => f.storage, now: f.config.now }).api.status()).connected, true);
  let release;
  f.calls.wait = new Promise(resolve => { release = resolve; }); const oldRead = f.api.read('holdings');
  f.calls.token = 'carol-access'; await f.api.login(); f.calls.failure = 401; release();
  assert.equal((await oldRead).status, 'reauthentication_required');
  assert.equal((await f.api.status()).connected, true);
  const reopened = fixture({ getStorage: () => f.storage, now: f.config.now });
  assert.equal((await reopened.api.read('holdings')).status, 'success');
  assert.equal(reopened.calls.requests[0].headers.Authorization, 'Bearer carol-access');
});
test('partial scopes, expired grants, unavailable SDK and cancelled popups stay on the login gate', async () => {
  const f = fixture(); f.calls.scope = SCRIPT_SCOPES[0]; assert.equal((await f.api.login()).status, 'scope_required');
  assert.equal((await f.api.status()).connected, false);
  const unavailable = fixture({ getOAuth: () => null }); assert.equal((await unavailable.api.login()).status, 'tool_error');
  f.calls.manual = true; const login = f.api.login(); f.calls.auth.at(-1).error_callback({ type: 'popup_closed' }); assert.equal((await login).status, 'denied');
  f.calls.manual = false; f.calls.scope = SCRIPT_SCOPES.join(' '); await f.api.login(); f.calls.failure = 401;
  assert.equal((await f.api.read('holdings')).status, 'reauthentication_required'); assert.equal((await f.api.status()).connected, false);
});
test('an almost-expired grant asks for a new login before starting a long price update', async () => {
  const f = fixture(); await f.api.login(); f.advance(55 * 60_000);
  assert.equal((await f.api.refresh(randomUUID())).status, 'reauthentication_required'); assert.equal(f.calls.requests.length, 0);
});
test('popup cancellation after logout cannot sign the user back in', async () => {
  const f = fixture(); f.calls.manual = true; const login = f.api.login(); await f.api.logout();
  f.complete({ access_token: 'late-access', scope: SCRIPT_SCOPES.join(' '), expires_in: 3600 });
  assert.equal((await login).status, 'cancelled'); assert.equal((await f.api.status()).connected, false);
});
test('PWA assets and offline fallback stay under the GitHub project path without caching API calls', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.scope, './'); assert.equal(manifest.start_url, './');
  assert.ok(manifest.icons.every(icon => !icon.src.startsWith('/')));
  const events = {}, reads = [];
  const context = { URL, location: { origin: 'https://0pcn.github.io' }, self: { registration: { scope: 'https://0pcn.github.io/Stock/' }, addEventListener(name, callback) { events[name] = callback; } }, fetch: async () => { throw new Error('offline'); }, caches: { match(path) { reads.push(path); return Promise.resolve('offline'); } } };
  vm.runInNewContext(await readFile(new URL('../public/sw.js', import.meta.url), 'utf8'), context);
  let navigation; events.fetch({ request: { method: 'GET', url: 'https://0pcn.github.io/Stock/', mode: 'navigate' }, respondWith(promise) { navigation = promise; } });
  assert.equal(await navigation, 'offline'); assert.equal(reads[0], '/Stock/offline.html');
  let intercepted = false; events.fetch({ request: { method: 'GET', url: 'https://sheets.googleapis.com/v4/spreadsheets/private', mode: 'cors' }, respondWith() { intercepted = true; } });
  assert.equal(intercepted, false);
});
