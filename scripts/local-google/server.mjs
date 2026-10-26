import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, chmod } from 'node:fs/promises';
import path from 'node:path';
import { OAuth2Client } from 'google-auth-library';
import getRawBody from 'raw-body';
import { SCRIPT_SCOPES, createPriceRefreshRunner, PriceRefreshError } from './price-refresh.mjs';
import { PORTFOLIO_SOURCES, SPREADSHEET_ID } from '../../lib/portfolio-sources.mjs';

export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const CALLBACK = '/api/auth/google/callback';
const AUTH = '/api/auth/google/';
const SESSION_COOKIE = 'stockfolio_google_session';
const STATE_COOKIE = 'stockfolio_google_state';
const SESSION_AGE = 30 * 24 * 60 * 60 * 1000;
const STATE_AGE = 10 * 60 * 1000;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);
const ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const opaque = () => randomBytes(32).toString('base64url');
const validId = value => typeof value === 'string' && /^[\w-]{43}$/.test(value);
const digest = value => createHash('sha256').update(value).digest('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const cookies = request => Object.fromEntries((request.headers.cookie || '').split(';').map(p => p.trim().split('=')).filter(p => p.length === 2));
const cookie = (name, value, maxAge) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;

/** Localhost-only Node middleware. This module is never included in a Worker or browser build. */
export function createLocalGoogleMiddleware({ root, env, clientFactory = options => new OAuth2Client(options), now = Date.now }) {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = env.GOOGLE_REDIRECT_URI?.trim() || 'http://localhost:5173/api/auth/google/callback';
  const missing = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'].filter(key => !env[key]?.trim());
  let redirect;
  let configurationError = '';
  try {
    redirect = new URL(redirectUri);
    if (redirect.protocol !== 'http:' || !LOOPBACK.has(redirect.hostname.replace(/^\[|\]$/g, '')) || redirect.pathname !== CALLBACK || redirect.search || redirect.hash || redirect.username || redirect.password) throw new Error();
  } catch { configurationError = 'GOOGLE_REDIRECT_URI 必須是本機 http 網址，路徑為 /api/auth/google/callback。'; }
  const configured = !missing.length && !configurationError;
  const fingerprint = digest(`${clientId}\n${redirectUri}`);
  const directory = path.join(root, '.sites-runtime', 'google-oauth');
  const deploymentId = env.GOOGLE_APPS_SCRIPT_DEPLOYMENT_ID?.trim() || '';
  const requestedScopes = deploymentId ? [...SCRIPT_SCOPES] : [GOOGLE_SCOPE];
  const runPriceRefresh = createPriceRefreshRunner({ deploymentId, now });
  const pending = new Map();
  const sessions = new Map();
  const revoked = new Set();
  const makeClient = () => clientFactory({ clientId, clientSecret, redirectUri });
  const sessionPath = id => path.join(directory, `${digest(id)}.json`);
  const json = (res, status, body) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  };
  const jump = (res, location) => { res.statusCode = 303; res.setHeader('Location', location); res.end(); };
  const authRequired = res => json(res, 401, { status: 'reauthentication_required', message: '請登入 Google 並授權讀取股票試算表。', signInPath: `${AUTH}start` });
  async function persist(id, session) {
    if (revoked.has(id)) return false;
    // Refresh responses may omit scope; an OAuth refresh preserves the grant.
    session.client.credentials.scope ||= session.grantedScope;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const target = sessionPath(id);
    const temporary = `${target}.${opaque()}.tmp`;
    await writeFile(temporary, JSON.stringify({ tokens: session.client.credentials, expiresAt: session.expiresAt, fingerprint }), { mode: 0o600, flag: 'wx' });
    if (revoked.has(id)) { await rm(temporary, { force: true }); return false; }
    await rename(temporary, target);
    if (revoked.has(id)) { await rm(target, { force: true }); return false; }
    return true;
  }
  async function destroy(id) {
    if (!validId(id)) return;
    revoked.add(id);
    sessions.delete(id);
    await rm(sessionPath(id), { force: true });
  }
  async function getSession(id) {
    if (!validId(id) || revoked.has(id)) return null;
    if (!sessions.has(id)) {
      sessions.set(id, (async () => {
        try {
          const saved = JSON.parse(await readFile(sessionPath(id), 'utf8'));
          if (saved.fingerprint !== fingerprint || saved.expiresAt <= now() || !saved.tokens?.access_token) { await destroy(id); return null; }
          const client = makeClient();
          client.setCredentials(saved.tokens);
          return { client, expiresAt: saved.expiresAt, grantedScope: saved.tokens.scope };
        } catch (error) { if (error.code !== 'ENOENT') await destroy(id); return null; }
      })());
    }
    const session = await sessions.get(id);
    if (revoked.has(id) || !session || session.expiresAt <= now()) { await destroy(id); return null; }
    return session;
  }
  function errorPage(res, reason) {
    res.setHeader('Set-Cookie', cookie(STATE_COOKIE, '', 0));
    jump(res, `/?google_auth=${reason}`);
  }
  return async function localGoogle(request, response, next) {
    const pathname = (request.url || '/').split('?')[0];
    if (!pathname.startsWith(AUTH) && pathname !== '/api/portfolio' && pathname !== '/api/portfolio/refresh-prices') { next(); return; }
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    let url;
    try { url = new URL(request.url, `http://${request.headers.host}`); }
    catch { json(response, 400, { status: 'invalid_request', message: '無效的本機網址。' }); return; }
    if (!LOOPBACK.has(url.hostname.replace(/^\[|\]$/g, '')) || !ADDRESSES.has(request.socket.remoteAddress || '')) {
      json(response, 403, { status: 'invalid_request', message: '本機 Google 連線僅接受 localhost 存取。' }); return;
    }
    if (request.method === 'POST' && request.headers.origin !== url.origin) {
      json(response, 403, { status: 'invalid_request', message: '無效的請求來源。' }); return;
    }
    try {
      const jar = cookies(request);
      if (pathname === `${AUTH}status` && request.method === 'GET') {
        const session = configured ? await getSession(jar[SESSION_COOKIE]) : null;
        json(response, 200, { mode: 'local', configured, connected: Boolean(session), missing, configurationError, signInPath: `${AUTH}start`, redirectUri, priceRefreshConfigured: Boolean(deploymentId) }); return;
      }
      if (pathname === `${AUTH}start` && request.method === 'GET') {
        if (!configured) { errorPage(response, 'configuration'); return; }
        const topLevelNavigation = request.headers['sec-fetch-mode'] === 'navigate' && request.headers['sec-fetch-dest'] === 'document';
        // A navigation redirected from 127.0.0.1 to localhost is cross-site.
        // Accept normal top-level navigations; state + PKCE bind the callback.
        if ((request.headers.origin && request.headers.origin !== url.origin) || (request.headers['sec-fetch-site'] === 'cross-site' && !topLevelNavigation)) {
          json(response, 403, { status: 'invalid_request', message: '請在一般瀏覽器開啟藏股頁面，再點「連接 Google」。' }); return;
        }
        if (request.headers.purpose === 'prefetch' || request.headers['sec-purpose']?.includes('prefetch')) {
          response.statusCode = 204; response.end(); return;
        }
        if (url.origin !== redirect.origin) { jump(response, `${redirect.origin}${AUTH}start`); return; }
        for (const [id, tx] of pending) if (tx.expiresAt <= now()) pending.delete(id);
        if (pending.size >= 100) { json(response, 429, { status: 'rate_limited', message: '登入請求過多，請稍後再試。' }); return; }
        const client = makeClient();
        const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
        const id = opaque();
        const state = opaque();
        pending.set(id, { state, codeVerifier, expiresAt: now() + STATE_AGE });
        response.setHeader('Set-Cookie', cookie(STATE_COOKIE, id, STATE_AGE / 1000));
        jump(response, client.generateAuthUrl({ access_type: 'offline', prompt: 'consent select_account', scope: requestedScopes, state, code_challenge: codeChallenge, code_challenge_method: 'S256' })); return;
      }
      if (pathname === CALLBACK && request.method === 'GET') {
        if (!configured || url.origin !== redirect.origin) { errorPage(response, 'configuration'); return; }
        const id = jar[STATE_COOKIE];
        const tx = validId(id) ? pending.get(id) : null;
        pending.delete(id);
        if (!tx || tx.expiresAt <= now() || !equal(tx.state, url.searchParams.get('state'))) { errorPage(response, 'expired'); return; }
        if (url.searchParams.has('error')) { errorPage(response, 'denied'); return; }
        const code = url.searchParams.get('code');
        if (!code || code.length > 4096) { errorPage(response, 'failed'); return; }
        try {
          const client = makeClient();
          const { tokens } = await client.getToken({ code, codeVerifier: tx.codeVerifier, redirect_uri: redirectUri });
          if (!tokens.access_token) throw new Error('Missing access token');
          const scopes = tokens.scope?.split(' ') || (await client.getTokenInfo(tokens.access_token)).scopes;
          if (!scopes.includes(GOOGLE_SCOPE) && !scopes.includes(SCRIPT_SCOPES[0])) { errorPage(response, 'scope'); return; }
          tokens.scope = scopes.join(' ');
          client.setCredentials(tokens);
          const sessionId = opaque();
          const session = { client, expiresAt: now() + SESSION_AGE, grantedScope: tokens.scope };
          await persist(sessionId, session);
          sessions.set(sessionId, Promise.resolve(session));
          await destroy(jar[SESSION_COOKIE]);
          response.setHeader('Set-Cookie', [cookie(SESSION_COOKIE, sessionId, SESSION_AGE / 1000), cookie(STATE_COOKIE, '', 0)]);
          jump(response, '/?google_auth=connected');
        } catch { errorPage(response, 'failed'); }
        return;
      }
      if (pathname === `${AUTH}logout` && request.method === 'POST') {
        await destroy(jar[SESSION_COOKIE]);
        response.setHeader('Set-Cookie', cookie(SESSION_COOKIE, '', 0));
        json(response, 200, { status: 'success' }); return;
      }
      if (pathname === '/api/portfolio/refresh-prices' && request.method === 'POST') {
        const sessionId = jar[SESSION_COOKIE];
        const session = configured ? await getSession(sessionId) : null;
        if (!session) { authRequired(response); return; }
        let body;
        try { body = JSON.parse((await getRawBody(request, { limit: 2048 })).toString('utf8')); }
        catch { request.resume(); json(response, 400, { status: 'invalid_request', message: '請求格式不正確。' }); return; }
        try {
          const result = await runPriceRefresh({ client: session.client, sessionKey: digest(sessionId), requestId: body?.requestId });
          if (!await persist(sessionId, session)) { authRequired(response); return; }
          json(response, 200, { status: 'success', result });
        } catch (error) {
          if (!(error instanceof PriceRefreshError)) throw error;
          json(response, error.httpStatus, { status: error.status, message: error.message, ...(error.status === 'reauthentication_required' ? { signInPath: `${AUTH}start` } : {}), ...(error.status === 'rate_limited' ? { retryAfterMs: 60000 } : {}) });
        }
        return;
      }
      if (pathname === '/api/portfolio' && request.method === 'POST') {
        if (!configured) {
          json(response, 503, { status: 'configuration_required', message: configurationError || `請在 .env.local 填入 ${missing.join('、')}，儲存後重新啟動 npm run dev。` }); return;
        }
        let body;
        try { body = JSON.parse((await getRawBody(request, { limit: 2048 })).toString('utf8')); }
        catch { request.resume(); json(response, 400, { status: 'invalid_request', message: '請求格式不正確。' }); return; }
        if (typeof body?.source !== 'string' || !Object.hasOwn(PORTFOLIO_SOURCES, body.source)) {
          json(response, 400, { status: 'invalid_request', message: '找不到資料分頁。' }); return;
        }
        const sessionId = jar[SESSION_COOKIE];
        const session = await getSession(sessionId);
        if (!session) { authRequired(response); return; }
        const [sheet, range] = PORTFOLIO_SOURCES[body.source];
        try {
          const result = await session.client.request({
            url: `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(`'${sheet}'!${range}`)}`,
            method: 'GET', params: { valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' }, timeout: 20000,
          });
          if (!await persist(sessionId, session)) { authRequired(response); return; }
          json(response, 200, { status: 'success', result: { content: [], structuredContent: result.data } });
        } catch (error) {
          const status = Number(error.response?.status || error.code);
          const googleError = error.response?.data?.error;
          if (status === 401 || googleError === 'invalid_grant' || googleError?.status === 'UNAUTHENTICATED') {
            await destroy(sessionId); authRequired(response);
          } else if (status === 403) {
            const disabled = googleError?.details?.some(detail => detail.reason === 'SERVICE_DISABLED');
            json(response, 403, { status: 'tool_error', message: disabled ? '請先在這組 OAuth 憑證的 Google Cloud 專案啟用 Google Sheets API。' : 'Google 帳號沒有這份試算表的讀取權限，或未允許必要的 Sheets 權限。請在偏好設定重新連接有權限的帳號。' });
          } else if (status === 429) {
            json(response, 429, { status: 'rate_limited', message: 'Google Sheets 讀取頻率過高，請一分鐘後重試。', retryAfterMs: 60000 });
          } else { json(response, 502, { status: 'upstream_error', message: 'Google Sheets 暫時無法讀取，請稍後再試。' }); }
        }
        return;
      }
      json(response, 405, { status: 'invalid_request', message: '不支援的操作。' });
    } catch {
      // Provider errors can include tokens and request headers; never log or send them.
      json(response, 500, { status: 'internal_error', message: '本機 Google 連線暫時無法使用，請確認設定後重試。' });
    }
  };
}
