import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedAuthStorage } from '../lib/browser-auth-storage.mjs';
import { createPortfolioSnapshot, createSavedPortfolioApi } from '../lib/portfolio-snapshot.mjs';
import { SPREADSHEET_ID } from '../lib/portfolio-sources.mjs';

const rows = [['代號', '名稱'], ['0050', '測試 ETF', '上市', 1000, 90, 100, 90000, 100000, 0, 10000]];
const now = Date.now();
function fixture() {
  const indexedDB = new IDBFactory();
  const store = () => createIndexedAuthStorage({ getIndexedDB: () => indexedDB, databaseName: 'stockfolio-portfolio', storeName: 'snapshots' });
  return { store, cache: () => createPortfolioSnapshot({ store: store() }) };
}

test('a reopened device can read the saved stock rows without a Google login or request', async () => {
  const f = fixture();
  const first = createSavedPortfolioApi({ api: { read: async () => ({ status: 'success', result: { values: rows } }) }, cache: f.cache(), now: () => now });
  assert.equal((await first.read('holdings')).savedLocally, true);
  let requests = 0;
  const reopened = createSavedPortfolioApi({ api: { status: async () => ({ connected: false }), read() { requests++; throw new Error('No grant'); } }, cache: f.cache() });
  const saved = await reopened.saved();
  assert.deepEqual(saved.sources.holdings, { rows, savedAt: now });
  assert.equal(saved.persisted, true); assert.equal(requests, 0);
});
test('expiry and failed updates preserve the last successful source and its original timestamp', async () => {
  const f = fixture(); let result = { status: 'success', result: { values: rows } }, listener;
  const api = createSavedPortfolioApi({ api: { read: async () => result, subscribe(fn) { listener = fn; return () => {}; } }, cache: f.cache(), now: () => now });
  await api.read('holdings'); api.subscribe(() => {});
  listener(); result = { status: 'reauthentication_required' };
  assert.equal((await api.read('holdings')).status, 'reauthentication_required');
  assert.equal((await api.saved()).sources.holdings.savedAt, now);
  result = { status: 'upstream_error' }; await api.read('holdings');
  assert.deepEqual((await api.saved()).sources.holdings.rows, rows);
});
test('concurrent source reads merge their snapshots and old responses cannot overwrite newer rows', async () => {
  const f = fixture(), first = f.cache(), second = f.cache();
  await Promise.all([first.load(), second.load()]);
  await Promise.all([first.save('holdings', rows, now), second.save('dividends', [['代號'], ['0050']], now)]);
  assert.deepEqual(Object.keys((await f.cache().load()).sources).sort(), ['dividends', 'holdings']);
  await second.save('holdings', [['new']], now + 1);
  await first.save('holdings', [['old']], now);
  assert.deepEqual((await f.cache().load()).sources.holdings.rows, [['new']]);
});
test('logout clears saved financial data and a late read cannot restore it', async () => {
  const f = fixture(); let release, delayed = false;
  const api = createSavedPortfolioApi({ cache: f.cache(), api: {
    read: async () => { if (delayed) await new Promise(resolve => { release = resolve; }); return { status: 'success', result: { values: rows } }; },
    logout: async () => ({ status: 'success' }),
  } });
  await api.read('holdings'); delayed = true;
  const reading = api.read('holdings'); await Promise.resolve();
  await api.logout(); release();
  assert.equal((await reading).status, 'cancelled');
  assert.deepEqual((await f.cache().load()).sources, {});
});
test('an old tab cannot repopulate another tab\'s cleared snapshot', async () => {
  const f = fixture(), old = f.cache(), other = f.cache();
  await old.save('holdings', rows, now); await other.load();
  await other.clear(); assert.equal(await old.save('holdings', rows, now + 1), false);
  assert.deepEqual((await f.cache().load()).sources, {});
});
test('only fixed spreadsheet tables are stored and malformed snapshots are discarded', async () => {
  const f = fixture(), cache = f.cache();
  assert.equal(await cache.save('__proto__', rows, now), false);
  assert.equal(await cache.save('holdings', [[{ access_token: 'must-not-be-stored' }]], now), false);
  assert.equal(await cache.save('holdings', [[Infinity]], now), false);
  const store = f.store();
  await store.write(SPREADSHEET_ID, JSON.stringify({ version: 1, spreadsheetId: 'different-sheet', epoch: 'old', sources: { holdings: { rows, savedAt: now } } }));
  assert.deepEqual((await f.cache().load()).sources, {});
  const raw = await store.read(SPREADSHEET_ID);
  assert.ok(!raw.includes('access_token')); assert.ok(!raw.includes('different-sheet'));
});
test('unavailable device storage reports the limitation while keeping this tab usable', async () => {
  const store = { update: async () => { throw new Error('Storage blocked'); } };
  const cache = createPortfolioSnapshot({ store });
  assert.equal(await cache.save('holdings', rows, now), false);
  const saved = await cache.load();
  assert.equal(saved.persisted, false); assert.deepEqual(saved.sources.holdings.rows, rows);
});
test('logout does not claim device data was deleted when persistent storage stops responding', async () => {
  const f = fixture(), actual = f.store(); let blocked = false, signedOut = false;
  const cache = createPortfolioSnapshot({ store: { update(...args) { if (blocked) throw new Error('Storage blocked'); return actual.update(...args); } } });
  const api = createSavedPortfolioApi({ cache, api: { read: async () => ({ status: 'success', result: { values: rows } }), logout: async () => { signedOut = true; return { status: 'success' }; } } });
  await api.read('holdings'); blocked = true;
  assert.equal((await api.logout()).status, 'storage_error'); assert.equal(signedOut, true);
});
