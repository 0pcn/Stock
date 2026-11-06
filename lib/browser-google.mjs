import { PORTFOLIO_SOURCES, SPREADSHEET_ID } from './portfolio-sources.mjs';
import { SCRIPT_SCOPES, createPriceRefreshRunner, PriceRefreshError } from '../scripts/local-google/price-refresh.mjs';
import { createIndexedAuthStorage } from './browser-auth-storage.mjs';
import { validateTransaction } from './transaction-input.mjs';

/** GitHub Pages uses Google's token model: no Client Secret or refresh token. */
export function createBrowserGoogle({ clientId, deploymentId, fetcher = fetch, getOAuth = () => globalThis.google?.accounts?.oauth2, initialize = loadGoogleIdentity, now = Date.now, schedule = setTimeout, cancel = clearTimeout, getStorage = () => globalThis.localStorage, backup = createIndexedAuthStorage(), events = globalThis }) {
  const configured = typeof clientId === 'string' && /^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId) && typeof deploymentId === 'string' && /^[\w-]{20,256}$/.test(deploymentId);
  const storageKey = `stockfolio.google-auth.v1:${clientId}`;
  let credentials = null, expiresTimer, pending = false, generation = 0, remembered = null, storage, locallySaved = false, backupSaved = false;
  try { storage = getStorage(); } catch { /* Storage may be disabled; keep this tab usable. */ }
  const listeners = new Set();
  const runRefresh = createPriceRefreshRunner({ deploymentId, now });
  let writingTransaction = false;
  const authRequired = message => ({ status: 'reauthentication_required', message: message || 'Google 授權已到期，請重新登入後再按同步。' });
  function forgetSaved() {
    try {
      // An old tab must not delete a newer account's saved authorization.
      if (remembered !== null && storage?.getItem(storageKey) === remembered) storage.removeItem(storageKey);
    } catch { /* Storage failures must not prevent logout. */ }
    remembered = null;
  }
  function clear(announce = false, forget = true) {
    const previous = remembered;
    if (forget) forgetSaved();
    else remembered = null;
    locallySaved = false; backupSaved = false;
    generation++; credentials = null; pending = false; cancel(expiresTimer);
    if (announce) for (const listener of listeners) listener();
    return forget && previous ? backup.remove(storageKey, previous).catch(() => {}) : Promise.resolve();
  }
  function active() {
    if (credentials && locallySaved) {
      try { if (storage.getItem(storageKey) !== remembered) clear(true, false); } catch { /* Use the in-memory token until its original expiry. */ }
    }
    if (credentials && credentials.expiry_date <= now() + 10_000) clear(true);
    return Boolean(credentials);
  }
  function scheduleExpiry() {
    cancel(expiresTimer);
    expiresTimer = schedule(() => { if (active()) scheduleExpiry(); }, Math.min(2_147_483_647, Math.max(0, credentials.expiry_date - now() - 10_000)));
  }
  function remember(value = JSON.stringify({ version: 1, clientId, ...credentials })) {
    remembered = value;
    locallySaved = false;
    try {
      if (!storage) return;
      storage.setItem(storageKey, remembered);
      locallySaved = storage.getItem(storageKey) === remembered;
    } catch { /* Continue in memory when storage is unavailable or full. */ }
  }
  function savedCredentials(value) {
    try {
      const saved = JSON.parse(value);
      if (!configured || saved?.version !== 1 || saved.clientId !== clientId || typeof saved.access_token !== 'string' || !saved.access_token.trim() || typeof saved.scope !== 'string' || !SCRIPT_SCOPES.every(scope => saved.scope.split(' ').includes(scope)) || !Number.isSafeInteger(saved.expiry_date) || saved.expiry_date <= now() + 10_000) return null;
      return { access_token: saved.access_token, scope: saved.scope, expiry_date: saved.expiry_date };
    } catch { return null; }
  }
  function restore() {
    let value;
    try {
      value = storage?.getItem(storageKey);
      if (!value) return;
      const saved = savedCredentials(value);
      if (!saved) throw new Error('Invalid saved authorization');
      credentials = saved;
      remembered = value; locallySaved = true; scheduleExpiry();
    } catch {
      try { if (value && storage.getItem(storageKey) === value) storage.removeItem(storageKey); } catch { /* Ignore inaccessible storage. */ }
    }
  }
  async function rememberBackup(version) {
    const value = remembered;
    try {
      const saved = await backup.write(storageKey, value);
      if (version !== generation || value !== remembered) { await backup.remove(storageKey, value); return; }
      backupSaved = saved;
    } catch { /* Local storage or this tab can still be used. */ }
  }
  async function restoreBackup() {
    const version = generation;
    try {
      const value = await backup.read(storageKey);
      if (version !== generation) return;
      if (credentials) {
        if (!active() || version !== generation) return;
        if (value === remembered) backupSaved = true;
        else await rememberBackup(version);
      } else if (value) {
        const saved = savedCredentials(value);
        if (!saved) { await backup.remove(storageKey, value); return; }
        credentials = saved; backupSaved = true;
        remember(value); scheduleExpiry();
      }
    } catch { /* Unavailable backup must not block the login screen. */ }
  }
  function storageChanged(event) {
    if ((event.key !== storageKey && event.key !== null) || (event.storageArea && event.storageArea !== storage)) return;
    if (pending || !credentials) clear(true, false);
    else active();
  }
  restore();
  const restoring = restoreBackup();
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
  async function failure(error, updating = false) {
    if (error instanceof PriceRefreshError) return { status: error.status, message: error.message };
    const status = error.response?.status;
    if (status === 401) { await clear(true); return authRequired(); }
    if (status === 403 || status === 404) return { status: 'permission_denied', message: '這個帳號無法存取股票試算表。請確認使用有權限的 Google 帳號；更新現價需要編輯權限。' };
    if (status === 429) return { status: 'rate_limited', message: 'Google 請求過於頻繁，請稍後再試。', retryAfterMs: 60000 };
    return { status: updating ? 'execution_unconfirmed' : 'upstream_error', message: updating ? '尚未確認現價是否更新完成，請先查看試算表更新時間再決定是否重試。' : 'Google 資料暫時無法讀取，請稍後重試。' };
  }
  return {
    initialize,
    canRefresh() { return active() && credentials.expiry_date - now() >= 360_000; },
    async status() {
      await restoring;
      const connected = active();
      return { mode: 'pages', configured, connected, loginRemembered: connected && (locallySaved || backupSaved), loginExpiresAt: connected ? credentials.expiry_date : undefined, priceRefreshConfigured: configured, configurationError: configured ? '' : '請設定公開的 Google Client ID 與 Apps Script API 部署 ID。' };
    },
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
    login({ selectAccount = false } = {}) {
      if (!configured) return Promise.resolve({ status: 'configuration_required', message: 'Google 登入設定尚未完成。' });
      const oauth = getOAuth();
      if (!oauth) { void initialize().catch(() => {}); return Promise.resolve({ status: 'tool_error', message: 'Google 登入元件載入中，請稍後再按一次登入。' }); }
      if (pending) return Promise.resolve({ status: 'in_progress', message: '請先完成已開啟的 Google 登入視窗。' });
      if (credentials) clear(true);
      else generation++; // A late storage read cannot overwrite a new login.
      pending = true; const version = generation;
      return new Promise(resolve => {
        let settled = false;
        function finish(result) { if (!settled) { settled = true; if (version === generation) pending = false; resolve(result); } }
        try { const client = oauth.initTokenClient({
          client_id: clientId, scope: SCRIPT_SCOPES.join(' '), include_granted_scopes: false,
          async callback(response) {
            if (version !== generation) { finish({ status: 'cancelled', message: '登入已取消。' }); return; }
            if (response.error) { finish({ status: 'denied', message: 'Google 授權未完成，請重新登入。' }); return; }
            const expiry = now() + Number(response.expires_in) * 1000;
            if (typeof response.access_token !== 'string' || !response.access_token.trim() || !Number.isSafeInteger(expiry) || expiry <= now() + 10_000 || typeof response.scope !== 'string' || !SCRIPT_SCOPES.every(scope => response.scope.split(' ').includes(scope))) {
              finish({ status: 'scope_required', message: '請允許股票工具所需的三個 Google 權限。' }); return;
            }
            credentials = { access_token: response.access_token, scope: response.scope, expiry_date: expiry };
            remember(); scheduleExpiry();
            await rememberBackup(version);
            if (version !== generation) { finish({ status: 'cancelled', message: '登入已取消。' }); return; }
            finish({ status: 'success' });
          },
          error_callback(error) { finish({ status: 'denied', message: error.type === 'popup_failed_to_open' ? '請允許 Google 登入彈出視窗後重試。' : 'Google 登入視窗已關閉，請重新登入。' }); },
        });
        client.requestAccessToken({ prompt: selectAccount ? 'select_account' : '' }); } catch { finish({ status: 'tool_error', message: 'Google 登入未能開啟，請稍後重試。' }); }
      });
    },
    async logout() { await clear(); return { status: 'success' }; },
    async addTransaction(requestId, input) {
      let transaction;
      try { transaction = validateTransaction(input); } catch (error) { return { status: 'invalid_request', message: error.message }; }
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId || '')) return { status: 'invalid_request', message: '請重新開啟新增交易。' };
      if (writingTransaction) return { status: 'in_progress', message: '這筆交易正在儲存，請稍候。' };
      const version = generation;
      writingTransaction = true;
      try {
        await restoring;
        if (version !== generation) return authRequired();
        const token = access(360_000);
        const operation = await googleRequest(`https://script.googleapis.com/v1/scripts/${deploymentId}:run`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ function: 'stockfolioAddTransaction', parameters: [requestId, transaction], devMode: false }),
        }, 380_000);
        if (version !== generation) return { status: 'execution_unconfirmed', message: '帳號或授權已變更，請先確認交易記錄，勿重複新增。' };
        if (operation?.error) {
          const missing = operation.error.details?.some(detail => /Script function not found.*stockfolioAddTransaction/i.test(detail.errorMessage || ''));
          return { status: missing ? 'configuration_required' : 'execution_unconfirmed', message: missing ? 'Google 端尚未部署新增交易功能，請先更新 Apps Script API 執行檔。' : '尚未確認交易是否寫入。請保留這個視窗，使用「確認這筆紀錄」檢查，勿重新新增。' };
        }
        const result = operation?.response?.result;
        if (operation?.done !== true || !result) throw new Error();
        const messages = { forbidden: '這個帳號沒有交易記錄與庫存分頁的編輯權限。', busy: '試算表正在更新中，請稍後再儲存。', invalid: '交易資料無法寫入，請檢查日期、股數、費用與賣出數量。', conflict: '這筆紀錄的內容與先前送出的資料不同，請先確認試算表。', configuration_required: 'Google 端的新增交易設定尚未完成，請先更新 Apps Script。', full: '交易記錄已達目前可讀取的筆數上限，請先整理試算表。', ledger_order: '試算表的交易日期未依序排列，請先整理日期後再補登較早的交易。' };
        if (Object.hasOwn(messages, result.status)) return { status: result.status === 'forbidden' ? 'permission_denied' : result.status === 'busy' ? 'in_progress' : result.status, message: messages[result.status] };
        if (result.status !== 'success' || !Number.isInteger(result.row) || result.row < 2 || result.row > 4997 || typeof result.inventoryUpdated !== 'boolean') throw new Error();
        return { status: 'success', result: { row: result.row, inventoryUpdated: result.inventoryUpdated, warning: result.inventoryUpdated ? '' : '交易已儲存，但庫存重算未完成。請保留視窗按「重新整理庫存」，不會再次新增交易。' } };
      } catch (error) {
        if (error instanceof PriceRefreshError) return { status: error.status, message: error.message };
        if (error.response?.status === 403) return { status: 'permission_denied', message: '無法執行新增交易，請確認此帳號的編輯權限與 Apps Script 部署存取權。' };
        if (error.response?.status === 404) return { status: 'configuration_required', message: '找不到 Apps Script API 部署，請先完成 Google 端設定。' };
        if (error.response?.status === 401) { await clear(true); return authRequired(); }
        return { status: 'execution_unconfirmed', message: '連線中斷，尚未確認這筆交易是否儲存。請保留視窗，按「確認這筆紀錄」，勿另開一筆重送。' };
      } finally { writingTransaction = false; }
    },
    async read(source) {
      if (!Object.hasOwn(PORTFOLIO_SOURCES, source)) return { status: 'invalid_request', message: '找不到資料分頁。' };
      const version = generation;
      await restoring;
      if (version !== generation) return authRequired();
      try {
        const token = access(); const [sheet, range] = PORTFOLIO_SOURCES[source];
        const result = await googleRequest(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(`'${sheet}'!${range}`)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`, { headers: { Authorization: `Bearer ${token}` } });
        return version === generation && active() ? { status: 'success', result } : authRequired();
      } catch (error) { return version === generation && active() ? failure(error) : authRequired(); }
    },
    async refresh(requestId) {
      const version = generation;
      await restoring;
      if (version !== generation) return authRequired();
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
