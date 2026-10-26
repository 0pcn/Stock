export const SCRIPT_SCOPES = Object.freeze([
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/script.external_request',
  'https://www.googleapis.com/auth/script.scriptapp',
]);
export const PRICE_REFRESH_FUNCTION = 'stockfolioRefreshCurrentPrices';
export class PriceRefreshError extends Error {
  constructor(status, httpStatus, message) { super(message); this.status = status; this.httpStatus = httpStatus; }
}
const fail = (status, http, message) => { throw new PriceRefreshError(status, http, message); };

/** Only the authenticated click handler calls this runner. Never run during reads or rendering. */
export function createPriceRefreshRunner({ deploymentId, now = Date.now }) {
  const jobs = new Map();
  const active = new Map();
  return async function refreshPrices({ client, sessionKey, requestId }) {
    if (!deploymentId || !/^[\w-]{20,256}$/.test(deploymentId)) fail('configuration_required', 503, '現價更新功能尚未完成 Apps Script 部署設定。');
    if (typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) fail('invalid_request', 400, '請重新從同步按鈕開始更新。');
    for (const [key, job] of jobs) if (job.done && job.expiresAt <= now()) jobs.delete(key);
    const key = `${sessionKey}:${requestId}`;
    if (jobs.has(key)) return jobs.get(key).promise;
    if (active.has(sessionKey)) fail('in_progress', 409, '現價正在更新中，請稍候完成。');
    const grantedScope = client.credentials.scope || '';
    const scopes = new Set(grantedScope.split(' '));
    if (!SCRIPT_SCOPES.every(scope => scopes.has(scope))) fail('reauthentication_required', 401, '更新現價需要新增 Google 授權。登入完成後，請再次按同步。');
    if (jobs.size >= 200) fail('rate_limited', 429, '更新請求過多，請稍後重試。');
    const job = { done: false, expiresAt: now() + 20 * 60_000, promise: null };
    active.set(sessionKey, requestId);
    job.promise = (async () => {
      try {
        // Apps Script can execute for six minutes. Refresh before calling when needed.
        if (!client.credentials.expiry_date || client.credentials.expiry_date - now() < 360_000) await client.refreshAccessToken();
        else await client.getAccessToken();
        client.credentials.scope ||= grantedScope;
        if (!SCRIPT_SCOPES.every(scope => client.credentials.scope.split(' ').includes(scope))) fail('reauthentication_required', 401, 'Google 授權範圍已變更，請重新登入後再按同步。');
        const response = await client.request({
          url: `https://script.googleapis.com/v1/scripts/${deploymentId}:run`, method: 'POST',
          data: { function: PRICE_REFRESH_FUNCTION, parameters: [], devMode: false },
          timeout: 380_000, retry: false,
        });
        const operation = response.data;
        if (operation?.error) fail('script_error', 502, '試算表的現價更新程式執行失敗，請查看 Apps Script 執行項目。');
        if (operation?.done !== true || !operation.response) fail('execution_unconfirmed', 502, '尚未確認更新結果。請先查看試算表的更新時間，再決定是否重試。');
        const result = operation.response.result;
        if (result?.status === 'forbidden') fail('permission_denied', 403, '這個 Google 帳號沒有這份股票試算表的編輯權限，無法更新現價。');
        if (result?.status === 'busy') fail('in_progress', 409, '試算表的現價更新正在執行，請稍後再試。');
        if (result?.status === 'empty') fail('no_holdings', 409, '試算表尚未建立庫存，請先執行「更新庫存 & 股利」。');
        if (result?.status !== 'success' || !Number.isInteger(result.updated) || result.updated < 0 || result.updated > 1000 || !Array.isArray(result.failed) || result.failed.length > 1000 || !result.failed.every(code => typeof code === 'string' && /^[\w.-]{1,16}$/.test(code)) || typeof result.updatedAt !== 'string' || !Number.isFinite(Date.parse(result.updatedAt))) {
          fail('execution_unconfirmed', 502, '更新程式沒有回傳可確認的結果，請先查看試算表。');
        }
        return { updated: result.updated, failed: result.failed, updatedAt: result.updatedAt };
      } catch (error) {
        if (error instanceof PriceRefreshError) throw error;
        const status = Number(error.response?.status || error.code);
        const provider = error.response?.data?.error;
        if (status === 401 || provider === 'invalid_grant') fail('reauthentication_required', 401, 'Google 授權已失效，請重新登入後再按同步。');
        if (status === 403) fail('permission_denied', 403, '請確認 Apps Script API 已啟用、腳本與 OAuth 共用同一個 Cloud 專案，且帳號有執行權限。');
        if (status === 404) fail('configuration_required', 503, '找不到 Apps Script API 部署，請確認部署 ID。');
        if (status === 429) fail('rate_limited', 429, 'Google 更新配額暫時用完，請稍候再試。');
        fail('execution_unconfirmed', 502, '尚未確認股價是否更新完成。請先查看試算表，避免重複執行。');
      } finally { job.done = true; job.expiresAt = now() + 20 * 60_000; active.delete(sessionKey); }
    })();
    // Keep both confirmed and uncertain outcomes, so the same click is never replayed.
    jobs.set(key, job);
    return job.promise;
  };
}
