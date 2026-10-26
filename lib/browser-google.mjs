import { PORTFOLIO_SOURCES, SPREADSHEET_ID } from './portfolio-sources.mjs';
import { SCRIPT_SCOPES, createPriceRefreshRunner, PriceRefreshError } from '../scripts/local-google/price-refresh.mjs';

/** GitHub Pages uses Google's token model: no Client Secret or refresh token. */
export function createBrowserGoogle({ clientId, deploymentId, fetcher = fetch, getOAuth = () => globalThis.google?.accounts?.oauth2, initialize = loadGoogleIdentity, now = Date.now, schedule = setTimeout, cancel = clearTimeout, getStorage = () => globalThis.localStorage, events = globalThis }) {
  const configured = typeof clientId === 'string' && /^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId) && typeof deploymentId === 'string' && /^[\w-]{20,256}$/.test(deploymentId);
  const storageKey = `stockfolio.google-auth.v1:${clientId}`;
  let credentials = null, expiresTimer, pending = false, generation = 0, remembered = null, storage;
  try { storage = getStorage(); } catch { /* Storage may be disabled; keep this tab usable. */ }
  const listeners = new Set();
  const runRefresh = createPriceRefreshRunner({ deploymentId, now });
  const authRequired = message => ({ status: 'reauthentication_required', message: message || 'Google 授權已到期，請重新登入後再按同步。' });
  function forgetSaved() {
    try {
      // An old tab must not delete a newer account's saved authorization.
      if (remembered !== null && storage?.getItem(storageKey) === remembered) storage.removeItem(storageKey);
    } catch { /* Storage failures must not prevent logout. */ }
    remembered = null;
  }
  function clear(announce = false, forget = true) {
    if (forget) forgetSaved();
    else remembered = null;
    generation++; credentials = null; pending = false; cancel(expiresTimer);
    if (announce) for (const listener of listeners) listener();
  }
  function active() {
    if (credentials && remembered !== null) {
      try { if (storage.getItem(storageKey) !== remembered) clear(true, false); } catch { /* Use the in-memory token until its original expiry. */ }
    }
    if (credentials && credentials.expiry_date <= now() + 10_000) clear(true);
    return Boolean(credentials);
  }
  function scheduleExpiry() {
    cancel(expiresTimer);
    expiresTimer = schedule(() => { if (active()) scheduleExpiry(); }, Math.min(2_147_483_647, Math.max(0, credentials.expiry_date - now() - 10_000)));
  }
  function remember() {
    try {
      if (!storage) return;
      const value = JSON.stringify({ version: 1, clientId, ...credentials });
      storage.setItem(storageKey, value); remembered = value;
    } catch { /* Continue in memory when storage is unavailable or full. */ }
  }
  function restore() {
    let value;
    try {
      value = storage?.getItem(storageKey);
      if (!value) return;
      const saved = JSON.parse(value);
      if (!configured || saved?.version !== 1 || saved.clientId !== clientId || typeof saved.access_token !== 'string' || !saved.access_token.trim() || typeof saved.scope !== 'string' || !SCRIPT_SCOPES.every(scope => saved.scope.split(' ').includes(scope)) || !Number.isSafeInteger(saved.expiry_date) || saved.expiry_date <= now() + 10_000) throw new Error('Invalid saved authorization');
      credentials = { access_token: saved.access_token, scope: saved.scope, expiry_date: saved.expiry_date };
      remembered = value; scheduleExpiry();
    } catch {
      try { if (value && storage.getItem(storageKey) === value) storage.removeItem(storageKey); } catch { /* Ignore inaccessible storage. */ }
    }
  }
  function storageChanged(event) {
    if ((event.key !== storageKey && event.key !== null) || (event.storageArea && event.storageArea !== storage)) return;
    if (pending) clear(true, false);
    else active();
  }
  restore();
  function access(minimumAge = 10_000) {
    if (!active() || credentials.expiry_date - now() < minimumAge) throw new PriceRefreshError('reauthentication_required', 401, 'Google 授權即將到期，請重新登入後再按同步。');
    return credentials.access_token;
  }
  async function googleRequest(url, options, timeout = 20_000) {
    const response = await fetcher(url, { ...options, cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(timeout) });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error('Google request failed'), { response: { status: response.status, data } });
    return data;
  }
  function failure(error, updating = false) {
    if (error instanceof PriceRefreshError) return { status: error.status, message: error.message };
    const status = error.response?.status;
    if (status === 401) { clear(true); return authRequired(); }
    if (status === 403 || status === 404) return { status: 'permission_denied', message: '這個帳號無法存取股票試算表。請確認使用有權限的 Google 帳號；更新現價需要編輯權限。' };
    if (status === 429) return { status: 'rate_limited', message: 'Google 請求過於頻繁，請稍後再試。', retryAfterMs: 60000 };
    return { status: updating ? 'execution_unconfirmed' : 'upstream_error', message: updating ? '尚未確認現價是否更新完成，請先查看試算表更新時間再決定是否重試。' : 'Google 資料暫時無法讀取，請稍後重試。' };
  }
  return {
    initialize,
    async status() { return { mode: 'pages', configured, connected: active(), priceRefreshConfigured: configured, configurationError: configured ? '' : '請設定公開的 Google Client ID 與 Apps Script API 部署 ID。' }; },
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        events.addEventListener?.('storage', storageChanged);
        events.addEventListener?.('focus', active);
        events.addEventListener?.('pageshow', active);
        events.document?.addEventListener('visibilitychange', active);
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          events.removeEventListener?.('storage', storageChanged);
          events.removeEventListener?.('focus', active);
          events.removeEventListener?.('pageshow', active);
          events.document?.removeEventListener('visibilitychange', active);
        }
      };
    },
    // Call directly from a click, with no await before requestAccessToken (popup rules).
    login() {
      if (!configured) return Promise.resolve({ status: 'configuration_required', message: 'Google 登入設定尚未完成。' });
      const oauth = getOAuth();
      if (!oauth) { void initialize().catch(() => {}); return Promise.resolve({ status: 'tool_error', message: 'Google 登入元件載入中，請稍後再按一次登入。' }); }
      if (pending) return Promise.resolve({ status: 'in_progress', message: '請先完成已開啟的 Google 登入視窗。' });
      if (credentials) clear(true);
      pending = true; const version = generation;
      return new Promise(resolve => {
        let settled = false;
        function finish(result) { if (!settled) { settled = true; pending = false; resolve(result); } }
        try { const client = oauth.initTokenClient({
          client_id: clientId, scope: SCRIPT_SCOPES.join(' '), include_granted_scopes: false,
          callback(response) {
            if (version !== generation) { finish({ status: 'cancelled', message: '登入已取消。' }); return; }
            if (response.error) { finish({ status: 'denied', message: 'Google 授權未完成，請重新登入。' }); return; }
            const expiry = now() + Number(response.expires_in) * 1000;
            if (typeof response.access_token !== 'string' || !response.access_token.trim() || !Number.isSafeInteger(expiry) || expiry <= now() + 10_000 || typeof response.scope !== 'string' || !SCRIPT_SCOPES.every(scope => response.scope.split(' ').includes(scope))) {
              finish({ status: 'scope_required', message: '請允許股票工具所需的三個 Google 權限。' }); return;
            }
            credentials = { access_token: response.access_token, scope: response.scope, expiry_date: expiry };
            remember(); scheduleExpiry();
            finish({ status: 'success' });
          },
          error_callback(error) { finish({ status: 'denied', message: error.type === 'popup_failed_to_open' ? '請允許 Google 登入彈出視窗後重試。' : 'Google 登入視窗已關閉，請重新登入。' }); },
        });
        client.requestAccessToken({ prompt: 'select_account' }); } catch { finish({ status: 'tool_error', message: 'Google 登入未能開啟，請稍後重試。' }); }
      });
    },
    async logout() { clear(); return { status: 'success' }; },
    async read(source) {
      if (!Object.hasOwn(PORTFOLIO_SOURCES, source)) return { status: 'invalid_request', message: '找不到資料分頁。' };
      const version = generation;
      try {
        const token = access(); const [sheet, range] = PORTFOLIO_SOURCES[source];
        const result = await googleRequest(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(`'${sheet}'!${range}`)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`, { headers: { Authorization: `Bearer ${token}` } });
        return version === generation && active() ? { status: 'success', result } : authRequired();
      } catch (error) { return version === generation && active() ? failure(error) : authRequired(); }
    },
    async refresh(requestId) {
      const version = generation;
      try {
        access(360_000);
        const client = {
          get credentials() { return credentials; },
          async getAccessToken() { return { token: access(360_000) }; },
          async refreshAccessToken() { throw new PriceRefreshError('reauthentication_required', 401, '請重新登入以取得新的 Google 授權，再按同步。'); },
          async request(options) { return { data: await googleRequest(options.url, { method: 'POST', headers: { Authorization: `Bearer ${access(360_000)}`, 'Content-Type': 'application/json' }, body: JSON.stringify(options.data) }, options.timeout) }; },
        };
        const result = await runRefresh({ client, sessionKey: `browser-${version}`, requestId });
        return version === generation && active() ? { status: 'success', result } : authRequired();
      } catch (error) { return version === generation && active() ? failure(error, true) : authRequired(); }
    },
  };
}

let identityLoading;
export function loadGoogleIdentity() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
  if (identityLoading) return identityLoading;
  identityLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => { identityLoading = null; script.remove(); reject(new Error('Google identity timed out')); }, 15000);
    script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
    script.onload = () => { clearTimeout(timer); resolve(); };
    script.onerror = () => { clearTimeout(timer); identityLoading = null; script.remove(); reject(new Error('Google identity unavailable')); };
    document.head.append(script);
  });
  return identityLoading;
}
