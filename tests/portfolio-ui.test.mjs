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

async function page(t, overrides = {}, { keepRenewal = false } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://0pcn.github.io/Stock/', pretendToBeVisual: true });
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
test('expired authorization opens saved inventory and keeps the detail sheet usable', async t => {
  const p = await page(t);
  assert.ok(document.querySelector('[aria-label="我的持股清單"]'));
  assert.ok(document.body.textContent.includes('測試 ETF'));
  assert.ok(document.querySelector('time[datetime="2026-10-26T08:00:00.000Z"]'));
  assert.deepEqual(p.calls, []);
  await p.click('[aria-label="查看測試 ETF 0050持股明細"]');
  await p.expire();
  assert.ok(document.querySelector('[role="dialog"]'));
  assert.ok(document.body.textContent.includes('未實現損益'));
  assert.equal(document.querySelector('.login-screen'), null);
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
