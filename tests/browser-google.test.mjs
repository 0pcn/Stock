import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createBrowserGoogle } from '../lib/browser-google.mjs';
import { SCRIPT_SCOPES } from '../scripts/local-google/price-refresh.mjs';
import { SPREADSHEET_ID } from '../lib/portfolio-sources.mjs';

function fixture(overrides = {}) {
  let time = Date.now(), callback, timer;
  const calls = { auth: [], requests: [], token: 'alice-access', scope: SCRIPT_SCOPES.join(' '), expiry: 3600 };
  const oauth = { initTokenClient(options) { callback = options.callback; calls.auth.push(options); return { requestAccessToken(request) { calls.prompt = request; if (!calls.manual) callback({ access_token: calls.token, expires_in: calls.expiry, scope: calls.scope }); } }; } };
  const fetcher = async (url, options) => {
    calls.requests.push({ url, ...options }); if (calls.wait) await calls.wait;
    if (calls.failure) return Response.json({ error: 'secret-provider-detail' }, { status: calls.failure });
    return Response.json(url.startsWith('https://script.googleapis.com/') ? { done: true, response: { result: calls.result || { status: 'success', updated: 16, failed: [], updatedAt: '2026-10-26T07:00:00.000Z' } } } : { values: [['代號'], ['0050']] });
  };
  const config = { clientId: 'test-client.apps.googleusercontent.com', deploymentId: 'test-api-deployment-1234567890', getOAuth: () => oauth, initialize: async () => {}, fetcher, now: () => time, schedule: fn => { timer = fn; return 1; }, cancel: () => {}, ...overrides };
  const api = createBrowserGoogle(config);
  return { api, calls, config, expire() { time += 3600_000; timer(); }, advance(ms) { time += ms; }, complete(response) { callback(response); } };
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
test('switching accounts discards old responses and each page starts with no saved token', async () => {
  const f = fixture(); await f.api.login(); let release;
  f.calls.wait = new Promise(resolve => { release = resolve; }); const alice = f.api.read('holdings');
  f.calls.token = 'bob-access'; await f.api.login(); release(); assert.equal((await alice).status, 'reauthentication_required');
  await f.api.read('holdings'); assert.equal(f.calls.requests[1].headers.Authorization, 'Bearer bob-access');
  assert.equal((await fixture().api.status()).connected, false);
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
