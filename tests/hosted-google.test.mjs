import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { createHostedGoogle } from '../lib/hosted-google.mjs';
import { SCRIPT_SCOPES } from '../scripts/local-google/price-refresh.mjs';
import { SPREADSHEET_ID } from '../lib/portfolio-sources.mjs';

const origin = 'https://stock.example.test';
function fixture(t, overrides = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../drizzle/0000_late_black_bird.sql', import.meta.url), 'utf8'));
  const db = { prepare(sql) { return { bind(...args) { const statement = sqlite.prepare(sql); return {
    async first() { return statement.get(...args) || null; },
    async run() { const result = statement.run(...args); return { meta: { changes: Number(result.changes) } }; },
  }; } }; } };
  let currentTime = Date.now();
  const calls = { tokens: [], reads: [], scripts: [], scope: SCRIPT_SCOPES.join(' '), result: { status: 'success', updated: 16, failed: [], updatedAt: '2026-10-26T06:00:00.000Z' } };
  const env = { DB: db, GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'secret-value', GOOGLE_REDIRECT_URI: `${origin}/api/auth/google/callback`, GOOGLE_APPS_SCRIPT_DEPLOYMENT_ID: 'test-api-deployment-1234567890', GOOGLE_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64url'), ...overrides };
  const fetcher = async (url, options) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      calls.tokens.push(new URLSearchParams(options.body));
      const code = options.body.get('code') || options.body.get('refresh_token').slice(8);
      return Response.json({ access_token: `access-${code}`, refresh_token: `refresh-${code}`, scope: calls.scope, expires_in: 3600 });
    }
    if (url.startsWith('https://sheets.googleapis.com/')) {
      calls.reads.push({ url, ...options });
      if (calls.readWait) await calls.readWait;
      return calls.readDenied ? Response.json({ error: { message: 'no access' } }, { status: 403 }) : Response.json({ values: [['代號'], ['0050']], range: '庫存總覽!A1:Q1000' });
    }
    if (url.startsWith('https://script.googleapis.com/')) {
      calls.scripts.push({ url, ...options });
      if (calls.scriptWait) await calls.scriptWait;
      if (calls.scriptFailure) throw new Error('unknown outcome');
      return Response.json({ done: true, response: { result: calls.result } });
    }
    throw new Error('Unexpected provider');
  };
  const initialize = () => createHostedGoogle({ env, fetcher, now: () => currentTime });
  let handle = initialize();
  const request = (path, options = {}) => handle(new Request(origin + path, options));
  const post = (path, data, cookie = '', extra = {}) => request(path, { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(data) });
  async function start() {
    const response = await request('/api/auth/google/start');
    return { response, state: new URL(response.headers.get('location')).searchParams.get('state'), cookie: response.headers.getSetCookie()[0].split(';')[0], url: new URL(response.headers.get('location')) };
  }
  async function login(code = 'editor') {
    const flow = await start();
    const response = await request(`/api/auth/google/callback?state=${flow.state}&code=${code}`, { headers: { Cookie: flow.cookie } });
    assert.equal(response.headers.get('location'), '/?google_auth=connected');
    return response.headers.getSetCookie().find(s => s.startsWith('__Host-stockfolio_session=')).split(';')[0];
  }
  t.after(() => sqlite.close());
  return { env, db, sqlite, calls, request, post, start, login, restart() { handle = initialize(); }, advance(ms) { currentTime += ms; } };
}

test('hosted APIs deny anonymous, forged, cross-origin and non-HTTPS requests', async t => {
  const f = fixture(t);
  assert.equal((await (await f.request('/api/auth/google/status')).json()).connected, false);
  assert.equal((await f.post('/api/portfolio', { source: 'holdings' })).status, 401);
  assert.equal((await f.post('/api/portfolio/refresh-prices', { requestId: randomUUID() }, '__Host-stockfolio_session=' + 'x'.repeat(43))).status, 401);
  assert.equal((await f.post('/api/portfolio', {}, '', { Origin: 'https://other.test' })).status, 403);
  const bad = createHostedGoogle({ env: { ...f.env, GOOGLE_REDIRECT_URI: 'http://stock.example.test/api/auth/google/callback' } });
  assert.equal((await (await bad(new Request(origin + '/api/auth/google/status'))).json()).configured, false);
  assert.equal(f.calls.tokens.length + f.calls.reads.length + f.calls.scripts.length, 0);
});
test('hosted OAuth uses encrypted single-use browser-bound state and PKCE', async t => {
  const f = fixture(t); const flow = await f.start();
  assert.equal(flow.url.searchParams.get('scope'), SCRIPT_SCOPES.join(' '));
  assert.equal(flow.url.searchParams.get('code_challenge_method'), 'S256');
  assert.match(flow.response.headers.getSetCookie()[0], /HttpOnly; Secure; SameSite=Lax/);
  const stored = f.sqlite.prepare('SELECT * FROM google_states').get();
  assert.ok(!stored.payload.includes(flow.state)); assert.ok(!stored.id.includes(flow.cookie.split('=')[1]));
  const noCookie = await f.request(`/api/auth/google/callback?state=${flow.state}&code=editor`);
  assert.equal(noCookie.headers.get('location'), '/?google_auth=expired');
  const call = () => f.request(`/api/auth/google/callback?state=${flow.state}&code=editor`, { headers: { Cookie: flow.cookie } });
  const results = await Promise.all([call(), call()]);
  assert.equal(results.filter(r => r.headers.get('location') === '/?google_auth=connected').length, 1);
  assert.equal(f.calls.tokens.length, 1);
  const verifier = f.calls.tokens[0].get('code_verifier');
  const expected = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url');
  assert.equal(expected, flow.url.searchParams.get('code_challenge'));
});
test('expired, denied and insufficient OAuth grants cannot establish a session', async t => {
  const f = fixture(t); const flow = await f.start(); f.advance(11 * 60_000);
  assert.equal((await f.request(`/api/auth/google/callback?state=${flow.state}&code=editor`, { headers: { Cookie: flow.cookie } })).headers.get('location'), '/?google_auth=expired');
  const denied = await f.start();
  assert.equal((await f.request(`/api/auth/google/callback?state=${denied.state}&error=access_denied`, { headers: { Cookie: denied.cookie } })).headers.get('location'), '/?google_auth=denied');
  f.calls.scope = 'https://www.googleapis.com/auth/spreadsheets.readonly'; const partial = await f.start();
  assert.equal((await f.request(`/api/auth/google/callback?state=${partial.state}&code=partial`, { headers: { Cookie: partial.cookie } })).headers.get('location'), '/?google_auth=scope');
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM google_sessions').get().n, 0);
});
test('two visitors use their own encrypted credentials and only the fixed sheet is read', async t => {
  const f = fixture(t); const alice = await f.login('alice'); const bob = await f.login('bob'); f.restart();
  assert.equal((await f.post('/api/portfolio', { source: 'holdings', spreadsheet_id: 'attacker-sheet' }, alice)).status, 200);
  assert.equal((await f.post('/api/portfolio', { source: 'settings' }, bob)).status, 200);
  assert.equal(f.calls.reads[0].headers.Authorization, 'Bearer access-alice'); assert.equal(f.calls.reads[1].headers.Authorization, 'Bearer access-bob');
  assert.ok(f.calls.reads.every(r => r.url.includes(SPREADSHEET_ID)));
  assert.equal((await f.post('/api/portfolio', { source: '__proto__' }, alice)).status, 400);
  for (const row of f.sqlite.prepare('SELECT payload FROM google_sessions').all()) { assert.ok(!row.payload.includes('access-')); assert.ok(!row.payload.includes('refresh-')); }
  assert.equal(f.calls.scripts.length, 0);
});
test('encryption binds a grant to its session and logout cannot be undone by an in-flight read', async t => {
  const f = fixture(t); const alice = await f.login('alice'); const bob = await f.login('bob');
  const sessions = f.sqlite.prepare('SELECT * FROM google_sessions').all();
  f.sqlite.prepare('UPDATE google_sessions SET payload = ? WHERE id = ?').run(sessions[0].payload, sessions[1].id);
  assert.equal((await f.post('/api/portfolio', { source: 'holdings' }, bob)).status, 401);
  let release; f.calls.readWait = new Promise(resolve => { release = resolve; });
  const reading = f.post('/api/portfolio', { source: 'holdings' }, alice);
  while (f.calls.reads.length === 0) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.post('/api/auth/google/logout', {}, alice)).status, 200); release();
  assert.equal((await reading).status, 401);
  assert.equal((await f.post('/api/portfolio', { source: 'holdings' }, alice)).status, 401);
});
test('tokens refresh on the server before long scripts and never reach the browser', async t => {
  const f = fixture(t); const login = await f.login(); f.advance(55 * 60_000);
  const response = await f.post('/api/portfolio/refresh-prices', { requestId: randomUUID(), function: 'updateAll' }, login);
  assert.equal(response.status, 200); assert.equal(f.calls.tokens.length, 2);
  assert.equal(f.calls.tokens[1].get('grant_type'), 'refresh_token');
  assert.equal(JSON.parse(f.calls.scripts[0].body).function, 'stockfolioRefreshCurrentPrices');
  const output = await response.text(); assert.ok(!output.includes('access-')); assert.ok(!output.includes('secret-value'));
});
test('viewers get a clear denial and the Google script gate runs before any price changes', async t => {
  const f = fixture(t); const viewer = await f.login('viewer'); f.calls.result = { status: 'forbidden' };
  const result = await f.post('/api/portfolio/refresh-prices', { requestId: randomUUID() }, viewer);
  assert.equal(result.status, 403); assert.match((await result.json()).message, /編輯權限/);
  f.calls.readDenied = true;
  assert.equal((await f.post('/api/portfolio', { source: 'holdings' }, viewer)).status, 403);
});
test('D1 deduplicates clicks across Worker instances and locks the shared spreadsheet across visitors', async t => {
  const f = fixture(t); const alice = await f.login('alice'); const bob = await f.login('bob');
  const requestId = randomUUID(); let release; f.calls.scriptWait = new Promise(resolve => { release = resolve; });
  const first = f.post('/api/portfolio/refresh-prices', { requestId }, alice);
  while (f.calls.scripts.length === 0) await new Promise(resolve => setImmediate(resolve)); f.restart();
  assert.equal((await f.post('/api/portfolio/refresh-prices', { requestId }, alice)).status, 409);
  assert.equal((await f.post('/api/portfolio/refresh-prices', { requestId: randomUUID() }, bob)).status, 409);
  release(); assert.equal((await first).status, 200); f.restart();
  assert.equal((await f.post('/api/portfolio/refresh-prices', { requestId }, alice)).status, 200);
  assert.equal(f.calls.scripts.length, 1);
});
test('uncertain executions keep the shared lock and the same click is not retried', async t => {
  const f = fixture(t); const login = await f.login(); const requestId = randomUUID(); f.calls.scriptFailure = true;
  assert.equal((await f.post('/api/portfolio/refresh-prices', { requestId }, login)).status, 502); f.restart();
  assert.equal((await f.post('/api/portfolio/refresh-prices', { requestId }, login)).status, 502);
  assert.equal((await f.post('/api/portfolio/refresh-prices', { requestId: randomUUID() }, login)).status, 409);
  assert.equal(f.calls.scripts.length, 1);
});
test('oversized requests, invalid jobs and cross-site background authorization never execute', async t => {
  const f = fixture(t); const login = await f.login();
  assert.equal((await f.post('/api/portfolio', { source: 'holdings', extra: 'a'.repeat(2050) }, login)).status, 400);
  assert.equal((await f.post('/api/portfolio/refresh-prices', { requestId: 'bad' }, login)).status, 400);
  assert.equal((await f.request('/api/auth/google/start', { headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors' } })).status, 403);
  assert.equal((await f.request('/api/auth/google/start', { headers: { 'sec-purpose': 'prefetch' } })).status, 204);
  assert.equal(f.calls.scripts.length, 0);
});
