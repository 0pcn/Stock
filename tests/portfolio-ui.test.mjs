import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const work = new URL('../work/', import.meta.url); await mkdir(work, { recursive: true });
const bundle = new URL(`portfolio-ui-${process.pid}.mjs`, work);
await build({ entryPoints: [fileURLToPath(new URL('../app/portfolio.tsx', import.meta.url))], outfile: fileURLToPath(bundle), bundle: true, packages: 'external', platform: 'node', format: 'esm', jsx: 'automatic' });
const { default: Portfolio } = await import(pathToFileURL(fileURLToPath(bundle)).href); await rm(bundle);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const savedAt = Date.parse('2026-10-26T08:00:00Z');
const rows = [['代號', '名稱'], ['0050', '測試 ETF', '上市', 1000, 90, 100, 90000, 100000, 0, 10000, 10000, 0, 10000, 0.1, 0.1, 0.1, 46000]];

async function page(t, overrides = {}, { keepRenewal = false, hash = '' } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://0pcn.github.io/Stock/' + hash, pretendToBeVisual: true });
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  dom.window.scrollTo = () => {};
  let connected = false, listener, loginOptions;
  const calls = [];
  const api = {
    status: async () => ({ mode: 'pages', configured: true, connected, priceRefreshConfigured: true }),
    initialize: async () => {}, saved: async () => ({ persisted: true, sources: { holdings: { rows, savedAt } } }),
    subscribe(fn) { listener = fn; return () => {}; }, canRefresh: () => connected,
    login(options) { calls.push('login'); loginOptions = options; connected = true; return Promise.resolve({ status: 'success' }); },
    async read(source) { calls.push('read:' + source); return { status: 'success', result: { values: source === 'holdings' ? rows : [] }, savedAt, savedLocally: true }; },
    async refresh() { calls.push('refresh'); return { status: 'success', result: { updated: 1, failed: [] } }; },
    async logout() { calls.push('logout'); connected = false; listener('cleared'); return { status: 'success' }; },
    ...overrides,
  };
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); });
  await act(async () => root.render(React.createElement(Portfolio, { api, baseUrl: '/Stock/' })));
  if (!keepRenewal) {
    const later = [...document.querySelectorAll('button')].find(button => button.textContent === '稍後再說');
    if (later) await act(async () => later.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
  }
  return {
    calls, dom,
    get loginOptions() { return loginOptions; },
    async expire() { connected = false; await act(async () => listener()); },
    async click(selector) { const element = document.querySelector(selector); assert.ok(element, selector); await act(async () => element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))); },
    async clickText(text) { const element = [...document.querySelectorAll('button')].find(button => button.textContent === text); assert.ok(element, text); await act(async () => element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))); },
  };
}

test('an expired grant offers a choice before starting Google authorization or changing the sheet', async t => {
  const p = await page(t, {}, { keepRenewal: true });
  assert.ok(document.querySelector('[role="dialog"][aria-label="要同步最新庫存嗎？"]'));
  assert.ok(document.body.textContent.includes('庫存最後讀取'));
  assert.deepEqual(p.calls, []);
  await p.clickText('稍後再說');
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.ok(document.body.textContent.includes('測試 ETF'));
  await p.expire();
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.deepEqual(p.calls, []);
});
test('the dialog authorizes from the original click and continues one sync without forced account selection', async t => {
  const p = await page(t, {}, { keepRenewal: true });
  const button = [...document.querySelectorAll('button')].find(button => button.textContent.startsWith('授權並同步'));
  await act(async () => {
    button.dispatchEvent(new p.dom.window.MouseEvent('click', { bubbles: true }));
    assert.deepEqual(p.calls, ['login']);
  });
  assert.deepEqual(p.loginOptions, { selectAccount: false });
  assert.deepEqual(p.calls.slice(0, 2), ['login', 'refresh']);
  assert.equal(p.calls.filter(call => call === 'refresh').length, 1);
  assert.equal(p.calls.filter(call => call.startsWith('read:')).length, 5);
  assert.equal(document.querySelector('[role="dialog"]'), null);
});
test('each new grant can offer renewal once on expiry, while cancelling does not show it repeatedly', async t => {
  const p = await page(t);
  await p.click('[aria-label="更新現價並同步"]');
  await p.expire();
  assert.ok(document.querySelector('[role="dialog"][aria-label="要同步最新庫存嗎？"]'));
  await p.clickText('稍後再說'); await p.expire();
  assert.equal(document.querySelector('[role="dialog"]'), null);
  await p.click('[aria-label="更新現價並同步"]'); await p.expire();
  assert.ok(document.querySelector('[role="dialog"][aria-label="要同步最新庫存嗎？"]'));
});
test('explicit account switching still requests the Google account chooser', async t => {
  const p = await page(t);
  await p.clickText('我的');
  const button = [...document.querySelectorAll('button')].find(button => button.textContent.startsWith('重新連接 Google'));
  await act(async () => button.dispatchEvent(new p.dom.window.MouseEvent('click', { bubbles: true })));
  assert.deepEqual(p.loginOptions, { selectAccount: true });
  assert.ok(!p.calls.includes('refresh'));
});
test('expired authorization opens saved inventory and keeps the holding page usable', async t => {
  const p = await page(t);
  assert.ok(document.querySelector('[aria-label="我的持股清單"]'));
  assert.ok(document.body.textContent.includes('測試 ETF'));
  assert.ok(document.querySelector('time[datetime="2026-10-26T08:00:00.000Z"]'));
  assert.deepEqual(p.calls, []);
  await p.click('[aria-label="查看測試 ETF 0050持股明細"]');
  await p.expire();
  assert.ok(document.querySelector('.holding-page-content'));
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.equal(document.querySelector('.bottom-navigation'), null);
  assert.ok(document.body.textContent.includes('未實現損益'));
  assert.equal(document.querySelector('.login-screen'), null);
});
test('holding page back and forward preserve list filtering, sorting, focus and scroll without Google requests', async t => {
  const p = await page(t);
  await p.click('[aria-label="搜尋與篩選持股"]'); await p.clickText('ETF');
  await act(async () => { const select = document.querySelector('[aria-label="庫存排序"]'); select.value = 'return'; select.dispatchEvent(new p.dom.window.Event('change', { bubbles: true })); });
  Object.defineProperty(window, 'scrollY', { value: 640, configurable: true, writable: true });
  window.scrollTo = options => { window.scrollY = options.top; };
  await p.click('.holding-row');
  assert.equal(window.location.hash, '#holding/0050'); assert.equal(window.scrollY, 0);
  assert.ok(document.querySelector('.holding-page-content')); assert.equal(document.querySelector('.sheet-backdrop'), null);
  const popped = () => new Promise(resolve => window.addEventListener('popstate', resolve, { once: true }));
  await act(async () => { const event = popped(); document.querySelector('[aria-label="返回上一頁"]').click(); await event; });
  assert.equal(window.location.hash, ''); assert.equal(window.scrollY, 640);
  assert.equal(document.querySelector('[aria-label="庫存排序"]').value, 'return');
  assert.equal(document.querySelector('[aria-label="市場篩選"] [aria-pressed="true"]').textContent, 'ETF');
  assert.ok(document.querySelector('[aria-label="搜尋庫存"]'));
  assert.equal(document.activeElement.dataset.holdingCode, '0050');
  await act(async () => { const event = popped(); window.history.forward(); await event; });
  assert.ok(document.querySelector('.holding-page-content')); assert.equal(window.scrollY, 0);
  assert.deepEqual(p.calls, []);
});
test('a direct holding link restores saved data and its back button stays inside the app', async t => {
  const p = await page(t, {}, { hash: '#holding/0050' });
  assert.ok(document.querySelector('.holding-page-content'));
  assert.equal(document.querySelector('#holding-page-title').textContent, '測試 ETF');
  await p.click('[aria-label="返回上一頁"]');
  assert.equal(window.location.hash, ''); assert.ok(document.querySelector('.stock-list')); assert.equal(window.history.length, 1);
  assert.deepEqual(p.calls, []);
});
test('a holding URL never exposes a position on a device without saved data or Google authorization', async t => {
  await page(t, { saved: async () => ({ persisted: true, sources: {} }) }, { hash: '#holding/0050' });
  assert.ok(document.querySelector('.login-screen')); assert.equal(document.querySelector('.holding-page-content'), null);
  assert.ok(!document.body.textContent.includes('測試 ETF'));
});
test('clicking update opens Google immediately, then updates prices and rereads sources once', async t => {
  const p = await page(t);
  const button = document.querySelector('[aria-label="更新現價並同步"]');
  await act(async () => {
    button.dispatchEvent(new p.dom.window.MouseEvent('click', { bubbles: true }));
    assert.deepEqual(p.calls, ['login']); // No await before opening the popup.
  });
  assert.deepEqual(p.calls.slice(0, 2), ['login', 'refresh']);
  assert.equal(p.calls.filter(call => call.startsWith('read:')).length, 5);
  assert.equal(p.calls.filter(call => call === 'refresh').length, 1);
  assert.ok(document.body.textContent.includes('測試 ETF'));
});
test('cancelled authorization preserves the visible inventory', async t => {
  const p = await page(t, { login: async () => ({ status: 'denied', message: '登入已取消' }) });
  await p.click('[aria-label="更新現價並同步"]');
  assert.ok(document.body.textContent.includes('登入已取消'));
  assert.ok(document.body.textContent.includes('測試 ETF'));
  assert.equal(document.querySelector('.login-screen'), null);
  assert.deepEqual(p.calls, []);
});
test('a failed price update keeps the saved inventory and its timestamp without claiming success', async t => {
  const p = await page(t, { refresh: async () => ({ status: 'execution_unconfirmed', message: '尚未確認現價更新結果' }) });
  await p.click('[aria-label="更新現價並同步"]');
  assert.ok(document.body.textContent.includes('尚未確認現價更新結果'));
  assert.ok(document.body.textContent.includes('測試 ETF'));
  assert.ok(document.querySelector('time[datetime="2026-10-26T08:00:00.000Z"]'));
  assert.equal(document.querySelector('.login-screen'), null);
  assert.deepEqual(p.calls, ['login']);
});
test('a valid grant rereads the spreadsheet on opening without running the price update', async t => {
  const p = await page(t, { status: async () => ({ mode: 'pages', configured: true, connected: true, priceRefreshConfigured: true }) });
  assert.equal(p.calls.filter(call => call.startsWith('read:')).length, 5);
  assert.ok(!p.calls.includes('login')); assert.ok(!p.calls.includes('refresh'));
  await p.expire();
  assert.ok(document.body.textContent.includes('測試 ETF'));
  assert.equal(document.querySelector('.login-screen'), null);
});
test('authorization expiring during initial device restore does not block the saved inventory', async t => {
  let listener;
  await page(t, {
    subscribe(fn) { listener = fn; return () => {}; },
    status: async () => { await Promise.resolve(); listener(); return { mode: 'pages', configured: true, connected: false }; },
  });
  assert.ok(document.querySelector('[aria-label="我的持股清單"]'));
  assert.ok(document.body.textContent.includes('測試 ETF'));
  assert.equal(document.querySelector('.login-screen'), null);
});
test('a device with no saved inventory asks for the first Google login', async t => {
  await page(t, { saved: async () => ({ persisted: true, sources: {} }) });
  assert.ok(document.querySelector('.login-screen'));
  assert.ok(document.body.textContent.includes('使用 Google 帳號登入'));
});
test('explicit logout clears the viewing state and returns to the first-login screen', async t => {
  const p = await page(t);
  await p.clickText('我的');
  await p.clickText('登出並清除此裝置資料');
  assert.ok(document.querySelector('.login-screen'));
  assert.equal(document.body.textContent.includes('測試 ETF'), false);
  assert.deepEqual(p.calls, ['logout']);
});
test('cached trades group mixed sheet dates, show the selected net income and fees, and respect privacy without writes', async t => {
  const serial = Date.parse('2026-01-02T00:00:00Z') / 86400000 + 25569;
  const transactions = [['日期', '代號'],
    ['2026/1/2', '0050', '測試 ETF', '上市', '買入', 100, 10, 2, 0, 1002, '分批'],
    [serial, '2330', '測試股票', '上市', '賣出', 50, 100, 20, 15, 4965, '部分賣出'],
    ['2026-01-03', '0050', '測試 ETF', '上市', '買入', 200, 10, 2, 0, 2002, '']];
  const p = await page(t, { saved: async () => ({ persisted: true, sources: { holdings: { rows, savedAt }, transactions: { rows: transactions, savedAt } } }) });
  await p.clickText('交易');
  const groups = [...document.querySelectorAll('.transaction-date-group')];
  assert.deepEqual(groups.map(group => group.querySelector('time').textContent), ['2026-01-03', '2026-01-02']);
  assert.equal(groups[1].querySelectorAll('.transaction-row').length, 2);
  const selected = '[aria-label="2026-01-02交易"] .transaction-row:last-child';
  await p.click(selected);
  assert.equal(document.querySelector('.transaction-net>span').textContent, '實際收入');
  assert.equal(document.querySelector('.transaction-net>strong').textContent, '4,965');
  assert.deepEqual([...document.querySelectorAll('.detail-grid strong')].map(el => el.textContent), ['50 股', '100.00', '20', '15']);
  assert.equal(document.querySelector('.transaction-detail-note p').textContent, '部分賣出');
  await p.expire(); assert.ok(document.querySelector('.transaction-net'));
  await p.click('[aria-label="關閉"]'); await p.click('[aria-label="隱藏金額"]'); await p.click(selected);
  assert.equal(document.querySelector('.transaction-net>strong').textContent, '••••');
  assert.ok([...document.querySelectorAll('.detail-grid strong')].every(el => el.textContent.startsWith('••••')));
  assert.deepEqual(p.calls, []);
});

const dividendRows = [['股票代號', '股票名稱', '除息日', '每股現金股利', '持有股數', '實際領到股利'],
  [50, '測試 ETF', Date.parse('2026-01-02T00:00:00Z') / 86400000 + 25569, 1, 100, 100],
  ['0050', '測試 ETF', '2026/1/20', 2, 100, 200],
  ['2330', '歷史股票', '2026-01-31', 5, 60, 300],
  ['0050', '測試 ETF', '2025/1/20', 4, 100, 400],
  ['0050', '測試 ETF', '2026/3/20', 6, 100, 600],
  ['9999', '無配息', '-', 0, 0, 0]];
const dividendSnapshot = async () => ({ persisted: true, sources: { holdings: { rows, savedAt }, dividends: { rows: dividendRows, savedAt } } });
test('dividend overview defaults to latest data year, sums every stock into all 12 months, and filters records without authorizing', async t => {
  const p = await page(t, { saved: dividendSnapshot }); await p.clickText('股利');
  assert.equal(document.querySelector('[aria-label="股利年度"]').value, '2026');
  assert.equal(document.querySelector('[aria-label="股利摘要"] > strong').textContent, 'NT$1,200');
  assert.equal(document.querySelectorAll('.dividend-month').length, 12);
  assert.equal(document.querySelector('[aria-label="1月股利"] > strong').textContent, '600');
  assert.equal(document.querySelector('[aria-label="2月股利"] > strong').textContent, '0');
  assert.ok(document.body.textContent.includes('依除息月份統計，非實際入帳月份'));
  await p.click('[aria-label="1月股利"]');
  assert.equal(document.querySelectorAll('.dividend-record').length, 3);
  assert.equal(document.querySelector('[aria-label="股利摘要"] > strong').textContent, 'NT$1,200');
  assert.equal(document.querySelector('.dividend-month-total strong').textContent, '600');
  await p.click('[aria-label="2月股利"]');
  assert.equal(document.querySelectorAll('.dividend-record').length, 0); assert.ok(document.body.textContent.includes('2 月沒有股利紀錄'));
  await act(async () => { const select = document.querySelector('[aria-label="股利年度"]'); select.value = '2025'; select.dispatchEvent(new p.dom.window.Event('change', { bubbles: true })); });
  assert.equal(document.querySelector('[aria-label="股利摘要"] > strong').textContent, 'NT$400');
  assert.equal(document.querySelectorAll('.dividend-record').length, 1);
  await act(async () => { const select = document.querySelector('[aria-label="股利年度"]'); select.value = 'all'; select.dispatchEvent(new p.dom.window.Event('change', { bubbles: true })); });
  assert.equal(document.querySelector('[aria-label="1月股利"] > strong').textContent, '1,000');
  assert.ok(document.body.textContent.includes('歷年同月份合計')); assert.deepEqual(p.calls, []);
});
test('stock dividend drilldown shows all years independent of overview year, preserves return position, and includes sold positions', async t => {
  const p = await page(t, { saved: dividendSnapshot }); await p.clickText('股利'); await p.clickText('依股票看');
  assert.equal(document.querySelectorAll('.dividend-stock-row').length, 2);
  assert.ok(document.querySelector('[aria-label="各股股利清單"]').textContent.includes('歷史股票'));
  Object.defineProperty(window, 'scrollY', { value: 250, configurable: true, writable: true });
  window.scrollTo = options => { window.scrollY = options.top; };
  await p.click('#dividend-stock-0050');
  assert.equal(window.scrollY, 0);
  assert.equal(document.querySelector('[aria-label="單股歷年股利摘要"] > strong').textContent, 'NT$1,300');
  assert.deepEqual([...document.querySelectorAll('.dividend-year-label > strong')].map(el => el.textContent), ['2026 年', '2025 年']);
  assert.deepEqual([...document.querySelectorAll('.dividend-year-amount > strong')].map(el => el.textContent), ['900', '400']);
  assert.equal(document.querySelector('.dividend-year-card').open, true);
  assert.equal(document.querySelectorAll('.dividend-year-card')[1].open, false);
  await p.clickText('返回股利總覽');
  assert.equal(window.scrollY, 250); assert.equal(document.activeElement.id, 'dividend-stock-0050');
  assert.equal(document.querySelector('[aria-label="股利年度"]').value, '2026');
  assert.equal(document.querySelector('[aria-label="股利檢視"] [aria-pressed="true"]').textContent, '依股票看'); assert.deepEqual(p.calls, []);
});
test('dividend privacy masks totals, per share and share counts and removes chart magnitude hints', async t => {
  const p = await page(t, { saved: dividendSnapshot }); await p.click('[aria-label="隱藏金額"]'); await p.clickText('股利');
  assert.equal(document.querySelector('[aria-label="股利摘要"] > strong').textContent, 'NT$••••');
  assert.ok([...document.querySelectorAll('.dividend-month > strong')].every(el => el.textContent === '••••'));
  assert.ok([...document.querySelectorAll('.dividend-bar-track > i')].every(el => el.style.height === '0%'));
  assert.ok([...document.querySelectorAll('.dividend-record .holding-identity > small')].every(el => el.textContent.includes('每股 •••• · 持有 •••• 股')));
  await p.clickText('依股票看'); await p.click('#dividend-stock-0050');
  assert.ok([...document.querySelectorAll('.dividend-year-amount > strong')].every(el => el.textContent === '••••'));
  assert.ok([...document.querySelectorAll('.dividend-year-track > i')].every(el => el.style.width === '0%')); assert.deepEqual(p.calls, []);
});
test('unread dividends do not imply a zero balance or enable empty month filters', async t => {
  const p = await page(t); await p.clickText('股利');
  assert.equal(document.querySelector('[aria-label="股利摘要"] > strong').textContent, 'NT$—');
  assert.ok([...document.querySelectorAll('.dividend-month')].every(el => el.disabled && el.querySelector('strong').textContent === '—'));
  assert.ok(document.body.textContent.includes('股利資料尚未讀取')); assert.deepEqual(p.calls, []);
});
