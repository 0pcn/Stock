import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
const initial = new JSDOM('<div></div>');
globalThis.window = initial.window; globalThis.document = initial.window.document;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: initial.window.navigator });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { default: React, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const bundle = new URL('../work/transaction-dialog-test.mjs', import.meta.url);
await build({ entryPoints: [fileURLToPath(new URL('../app/transaction-dialog.tsx', import.meta.url))], outfile: fileURLToPath(bundle), bundle: true, packages: 'external', platform: 'node', format: 'esm', jsx: 'automatic' });
const { default: TransactionDialog } = await import(bundle.href); await rm(bundle);
async function page(t, overrides = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:5173/Stock/' });
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  const writes = []; let closes = 0, saved = 0, logins = 0;
  const api = { canRefresh: () => true, login() { logins++; return Promise.resolve({ status: 'success' }); }, async addTransaction(id, input) { writes.push({ id, input }); return { status: 'success', result: { inventoryUpdated: true } }; }, ...overrides };
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); });
  await act(async () => root.render(React.createElement(TransactionDialog, { api, suggestions: [['0050', '測試 ETF', '上市']], connected: false, close() { closes++; }, onAuthorized: async () => {}, onSaved: async () => { saved++; } })));
  const p = {
    writes, get closes() { return closes; }, get saved() { return saved; }, get logins() { return logins; },
    async fill(name, value) {
      const input = document.querySelector(`[name="${name}"]`);
      await act(async () => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      });
    },
    async submit() { await act(async () => document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))); },
  };
  await p.fill('code', '0050'); await p.fill('shares', '1000'); await p.fill('price', '100');
  return p;
}
test('entering a known code fills its name; saving sends one transaction and rereads only after success', async t => {
  const p = await page(t);
  assert.equal(document.querySelector('[name="name"]').value, '測試 ETF');
  await p.submit();
  assert.equal(p.writes.length, 1); assert.equal(p.writes[0].input.shares, 1000); assert.equal(p.writes[0].input.fee, null);
  assert.equal(p.saved, 1); assert.equal(p.closes, 1);
});
test('uncertain results lock the content and reuse the same id on an explicit confirmation', async t => {
  const writes = [];
  const p = await page(t, { async addTransaction(id, input) { writes.push({ id, input }); return { status: 'execution_unconfirmed', message: '尚未確認儲存結果' }; } });
  await p.submit(); assert.ok(document.querySelector('fieldset').disabled);
  assert.ok(document.querySelector('[type="submit"]').textContent.includes('確認這筆紀錄'));
  await p.submit(); assert.equal(writes.length, 2); assert.equal(writes[0].id, writes[1].id); assert.deepEqual(writes[0].input, writes[1].input);
  assert.equal(p.saved, 0); assert.equal(p.closes, 0);
});
test('cancelled Google authorization preserves the form without sending a write', async t => {
  const p = await page(t, { canRefresh: () => false, login: async () => ({ status: 'denied', message: '已取消授權' }) });
  await p.submit(); assert.equal(p.writes.length, 0); assert.equal(p.closes, 0);
  assert.equal(document.querySelector('[name="shares"]').value, '1000'); assert.ok(document.body.textContent.includes('已取消授權'));
});
test('a successful write with unfinished rebuild is reported as saved and confirmation does not create a new id', async t => {
  const writes = []; const p = await page(t, { async addTransaction(id) { writes.push(id); return { status: 'success', result: { inventoryUpdated: false, warning: '交易已儲存，庫存尚待更新' } }; } });
  await p.submit(); await p.submit(); assert.equal(writes[0], writes[1]); assert.equal(p.closes, 0);
  assert.ok(document.querySelector('[type="submit"]').textContent.includes('重新整理庫存'));
});
