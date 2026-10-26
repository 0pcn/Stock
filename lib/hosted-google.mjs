import { PORTFOLIO_SOURCES, SPREADSHEET_ID } from './portfolio-sources.mjs';
import { SCRIPT_SCOPES, createPriceRefreshRunner, PriceRefreshError } from '../scripts/local-google/price-refresh.mjs';

const AUTH = '/api/auth/google/';
const SESSION = '__Host-stockfolio_session';
const STATE = '__Host-stockfolio_oauth';
const SESSION_AGE = 30 * 86400_000;
const STATE_AGE = 10 * 60_000;
const JOB_AGE = 20 * 60_000;
const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{43}$/.test(id);
const bytes = value => new TextEncoder().encode(value);
const b64 = value => btoa(String.fromCharCode(...new Uint8Array(value))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const unb64 = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
const opaque = () => b64(crypto.getRandomValues(new Uint8Array(32)));
const hash = async value => b64(await crypto.subtle.digest('SHA-256', bytes(value)));
const cookie = (name, value, age) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
const jar = request => Object.fromEntries((request.headers.get('cookie') || '').split(';').map(s => s.trim().split('=')).filter(s => s.length === 2));
const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
const json = (body, status = 200) => Response.json(body, { status, headers });
const jump = (path, cookies = []) => { const h = new Headers({ ...headers, Location: path }); for (const c of cookies) h.append('Set-Cookie', c); return new Response(null, { status: 303, headers: h }); };
const authRequired = () => json({ status: 'reauthentication_required', message: '請使用有股票試算表權限的 Google 帳號登入。', signInPath: `${AUTH}start` }, 401);

/** Worker-only OAuth and fixed-sheet API. Each browser session uses its own grant. */
export function createHostedGoogle({ env, fetcher = fetch, now = Date.now }) {
  const db = env.DB;
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = env.GOOGLE_REDIRECT_URI?.trim();
  const deploymentId = env.GOOGLE_APPS_SCRIPT_DEPLOYMENT_ID?.trim();
  const keyText = env.GOOGLE_TOKEN_ENCRYPTION_KEY?.trim();
  let redirect;
  try {
    redirect = new URL(redirectUri);
    if (redirect.protocol !== 'https:' || redirect.pathname !== `${AUTH}callback` || redirect.search || redirect.hash || redirect.username || redirect.password) redirect = undefined;
  } catch {}
  const configured = Boolean(db && clientId && clientSecret && redirect && keyText && /^[A-Za-z0-9_-]{43}$/.test(keyText) && /^[\w-]{20,256}$/.test(deploymentId || ''));
  const runRefresh = createPriceRefreshRunner({ deploymentId, now });
  let key;
  async function encryptionKey() {
    key ||= crypto.subtle.importKey('raw', unb64(keyText), 'AES-GCM', false, ['encrypt', 'decrypt']);
    return key;
  }
  async function seal(value, context) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: bytes(context) }, await encryptionKey(), bytes(JSON.stringify(value)));
    return `${b64(iv)}.${b64(encrypted)}`;
  }
  async function open(value, context) {
    const [iv, encrypted] = value.split('.');
    const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: bytes(context) }, await encryptionKey(), unb64(encrypted));
    return JSON.parse(new TextDecoder().decode(clear));
  }
  async function provider(url, options, timeout = 20_000) {
    const response = await fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(timeout) });
    let data;
    try { data = await response.json(); } catch { throw new Error('Invalid provider response'); }
    if (!response.ok) throw Object.assign(new Error('Google request failed'), { response: { status: response.status, data } });
    return data;
  }
  async function tokenRequest(parameters) {
    return provider('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...parameters }) });
  }
  async function session(request) {
    const id = jar(request)[SESSION];
    if (!validId(id)) return null;
    const idHash = await hash(id);
    const saved = await db.prepare('SELECT payload, expires_at FROM google_sessions WHERE id = ? AND expires_at > ?').bind(idHash, now()).first();
    if (!saved) return null;
    try { return { idHash, expiresAt: saved.expires_at, tokens: await open(saved.payload, `session:${idHash}`) }; }
    catch { return null; }
  }
  async function persistSession(s) {
    const result = await db.prepare('UPDATE google_sessions SET payload = ? WHERE id = ? AND expires_at > ?').bind(await seal(s.tokens, `session:${s.idHash}`), s.idHash, now()).run();
    return result.meta.changes === 1;
  }
  async function sessionActive(s) {
    return Boolean(await db.prepare('SELECT id FROM google_sessions WHERE id = ? AND expires_at > ?').bind(s.idHash, now()).first());
  }
  async function accessToken(s, minimumAge = 60_000) {
    if (!await sessionActive(s)) throw Object.assign(new Error('Signed out'), { response: { status: 401 } });
    if (!s.tokens.expiry_date || s.tokens.expiry_date - now() < minimumAge) {
      if (!s.tokens.refresh_token) throw Object.assign(new Error('Reauthorization required'), { response: { status: 401 } });
      const fresh = await tokenRequest({ grant_type: 'refresh_token', refresh_token: s.tokens.refresh_token });
      if (!fresh.access_token || !Number.isFinite(Number(fresh.expires_in))) throw new Error('Invalid refresh response');
      s.tokens = { ...s.tokens, ...fresh, expiry_date: now() + Number(fresh.expires_in) * 1000 };
      if (!await persistSession(s)) throw Object.assign(new Error('Signed out'), { response: { status: 401 } });
    }
    return s.tokens.access_token;
  }
  function failure(error) {
    const code = Number(error.response?.status);
    if (code === 401 || error.response?.data?.error === 'invalid_grant') return authRequired();
    if (code === 403) return json({ status: 'permission_denied', message: '這個 Google 帳號沒有這份股票試算表的必要權限。查看需檢視權限，更新現價需編輯權限。' }, 403);
    if (code === 429) return json({ status: 'rate_limited', message: 'Google 請求過於頻繁，請稍後再試。', retryAfterMs: 60000 }, 429);
    return json({ status: 'upstream_error', message: 'Google 暫時無法完成請求，請稍後再試。' }, 502);
  }
  async function body(request) {
    if (Number(request.headers.get('content-length') || 0) > 2048) throw new Error();
    const reader = request.body?.getReader();
    if (!reader) throw new Error();
    const chunks = []; let size = 0;
    for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > 2048) { await reader.cancel(); throw new Error(); } chunks.push(item.value); }
    const all = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder().decode(all));
  }
  async function updatePrices(s, requestId) {
    if (typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) return json({ status: 'invalid_request', message: '請重新從同步按鈕開始更新。' }, 400);
    const jobId = await hash(`${s.idHash}:${requestId}`);
    const cached = await db.prepare('SELECT payload FROM price_jobs WHERE id = ? AND session_id = ? AND expires_at > ?').bind(jobId, s.idHash, now()).first();
    if (cached) return cached.payload ? json(JSON.parse(cached.payload).body, JSON.parse(cached.payload).code) : json({ status: 'in_progress', message: '這次更新正在執行，請稍候完成。' }, 409);
    const inserted = await db.prepare('INSERT OR IGNORE INTO price_jobs (id, session_id, expires_at) VALUES (?, ?, ?)').bind(jobId, s.idHash, now() + JOB_AGE).run();
    if (inserted.meta.changes !== 1) return json({ status: 'execution_unconfirmed', message: '這次請求已送出，請先確認試算表更新時間。' }, 409);
    const lock = await db.prepare('INSERT INTO price_locks (id, job_id, expires_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET job_id = excluded.job_id, expires_at = excluded.expires_at WHERE price_locks.expires_at < ?').bind('fixed-stock-sheet', jobId, now() + 7 * 60_000, now()).run();
    let response;
    try {
      if (lock.meta.changes !== 1) response = json({ status: 'in_progress', message: '這份試算表正在由其他使用者更新，請稍候。' }, 409);
      else {
        const client = {
          get credentials() { return s.tokens; },
          async getAccessToken() { return { token: await accessToken(s, 360_000) }; },
          async refreshAccessToken() { return { credentials: (await accessToken(s, Number.MAX_SAFE_INTEGER), s.tokens) }; },
          async request(options) {
            const token = await accessToken(s, 360_000);
            return { data: await provider(options.url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(options.data) }, options.timeout) };
          },
        };
        const result = await runRefresh({ client, sessionKey: s.idHash, requestId });
        response = await sessionActive(s) ? json({ status: 'success', result }) : authRequired();
      }
    } catch (error) {
      response = error instanceof PriceRefreshError ? json({ status: error.status, message: error.message, ...(error.status === 'reauthentication_required' ? { signInPath: `${AUTH}start` } : {}) }, error.httpStatus) : failure(error);
    } finally {
      // A timed-out upstream may still be running. Its lock expires naturally.
      if (lock.meta.changes === 1 && response && !['execution_unconfirmed', 'upstream_error'].includes((await response.clone().json()).status)) await db.prepare('DELETE FROM price_locks WHERE id = ? AND job_id = ?').bind('fixed-stock-sheet', jobId).run();
    }
    await db.prepare('UPDATE price_jobs SET payload = ? WHERE id = ?').bind(JSON.stringify({ code: response.status, body: await response.clone().json() }), jobId).run();
    return response;
  }
  return async function handle(request) {
    try {
      const url = new URL(request.url);
      if (!configured) return json({ mode: 'hosted', provider: 'google', configured: false, connected: false, status: 'configuration_required', configurationError: '正式網站的 Google 連線尚未設定完成。', message: '正式網站的 Google 連線尚未設定完成。' }, url.pathname.endsWith('/status') ? 200 : 503);
      if (url.origin !== redirect.origin || (request.method === 'POST' && request.headers.get('origin') !== redirect.origin)) return json({ status: 'invalid_request', message: '無效的請求來源。' }, 403);
      if (url.pathname === `${AUTH}status` && request.method === 'GET') {
        const s = await session(request);
        return json({ mode: 'hosted', provider: 'google', configured: true, connected: Boolean(s), signInPath: `${AUTH}start`, signOutPath: `${AUTH}logout`, priceRefreshConfigured: true });
      }
      if (url.pathname === `${AUTH}start` && request.method === 'GET') {
        const site = request.headers.get('sec-fetch-site');
        const top = request.headers.get('sec-fetch-mode') === 'navigate' && request.headers.get('sec-fetch-dest') === 'document';
        if ((request.headers.get('origin') && request.headers.get('origin') !== redirect.origin) || (site === 'cross-site' && !top)) return json({ status: 'invalid_request', message: '請從藏股網站的 Google 登入按鈕開始授權。' }, 403);
        if (request.headers.get('purpose') === 'prefetch' || request.headers.get('sec-purpose')?.includes('prefetch')) return new Response(null, { status: 204, headers });
        const id = opaque(), state = opaque(), verifier = opaque(); const idHash = await hash(id);
        await db.prepare('DELETE FROM google_states WHERE expires_at <= ?').bind(now()).run();
        await db.prepare('DELETE FROM google_sessions WHERE expires_at <= ?').bind(now()).run();
        await db.prepare('DELETE FROM price_jobs WHERE expires_at <= ?').bind(now()).run();
        await db.prepare('INSERT INTO google_states (id, payload, expires_at) VALUES (?, ?, ?)').bind(idHash, await seal({ state, verifier }, `state:${idHash}`), now() + STATE_AGE).run();
        const google = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        const params = { client_id: clientId, redirect_uri: redirectUri, response_type: 'code', access_type: 'offline', prompt: 'consent select_account', scope: SCRIPT_SCOPES.join(' '), state, code_challenge: await hash(verifier), code_challenge_method: 'S256' };
        for (const [k, v] of Object.entries(params)) google.searchParams.set(k, v);
        return jump(google.href, [cookie(STATE, id, STATE_AGE / 1000)]);
      }
      if (url.pathname === `${AUTH}callback` && request.method === 'GET') {
        const finish = reason => jump(`/?google_auth=${reason}`, [cookie(STATE, '', 0)]);
        const id = jar(request)[STATE];
        if (!validId(id)) return finish('expired');
        const idHash = await hash(id);
        const saved = await db.prepare('DELETE FROM google_states WHERE id = ? AND expires_at > ? RETURNING payload').bind(idHash, now()).first();
        if (!saved) return finish('expired');
        const tx = await open(saved.payload, `state:${idHash}`);
        if (tx.state !== url.searchParams.get('state')) return finish('expired');
        if (url.searchParams.has('error')) return finish('denied');
        const code = url.searchParams.get('code');
        if (!code || code.length > 4096) return finish('failed');
        try {
          const tokens = await tokenRequest({ grant_type: 'authorization_code', code, code_verifier: tx.verifier, redirect_uri: redirectUri });
          if (!tokens.access_token || !Number.isFinite(Number(tokens.expires_in))) return finish('failed');
          if (!SCRIPT_SCOPES.every(scope => (tokens.scope || '').split(' ').includes(scope))) return finish('scope');
          tokens.expiry_date = now() + Number(tokens.expires_in) * 1000;
          const sessionId = opaque(), sessionHash = await hash(sessionId);
          await db.prepare('INSERT INTO google_sessions (id, payload, expires_at) VALUES (?, ?, ?)').bind(sessionHash, await seal(tokens, `session:${sessionHash}`), now() + SESSION_AGE).run();
          const previous = jar(request)[SESSION];
          if (validId(previous)) await db.prepare('DELETE FROM google_sessions WHERE id = ?').bind(await hash(previous)).run();
          return jump('/?google_auth=connected', [cookie(STATE, '', 0), cookie(SESSION, sessionId, SESSION_AGE / 1000)]);
        } catch { return finish('failed'); }
      }
      if (url.pathname === `${AUTH}logout` && request.method === 'POST') {
        const s = await session(request);
        if (s) await db.prepare('DELETE FROM google_sessions WHERE id = ?').bind(s.idHash).run();
        const response = json({ status: 'success' }); response.headers.append('Set-Cookie', cookie(SESSION, '', 0)); return response;
      }
      if ((url.pathname === '/api/portfolio' || url.pathname === '/api/portfolio/refresh-prices') && request.method === 'POST') {
        const s = await session(request);
        if (!s) return authRequired();
        let input; try { input = await body(request); } catch { return json({ status: 'invalid_request', message: '請求格式不正確。' }, 400); }
        if (url.pathname.endsWith('/refresh-prices')) return await updatePrices(s, input?.requestId);
        if (!Object.hasOwn(PORTFOLIO_SOURCES, input?.source || '')) return json({ status: 'invalid_request', message: '找不到資料分頁。' }, 400);
        const [sheet, range] = PORTFOLIO_SOURCES[input.source];
        try {
          const token = await accessToken(s);
          const data = await provider(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(`'${sheet}'!${range}`)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`, { headers: { Authorization: `Bearer ${token}` } });
          return await sessionActive(s) ? json({ status: 'success', result: { content: [], structuredContent: data } }) : authRequired();
        } catch (error) { return failure(error); }
      }
      return json({ status: 'invalid_request', message: '不支援的操作。' }, 405);
    } catch {
      // Never return provider objects: they can contain tokens or secret headers.
      return json({ status: 'internal_error', message: 'Google 連線暫時無法使用，請稍後再試。' }, 500);
    }
  };
}
