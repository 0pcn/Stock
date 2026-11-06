import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { validateTransaction } from '../lib/transaction-input.mjs';
const rules = await readFile(new URL('../google-apps-script/transaction-rules.gs', import.meta.url), 'utf8');
const source = await readFile(new URL('../google-apps-script/stockfolio-transactions.gs', import.meta.url), 'utf8');
const tx = (overrides = {}) => ({ date: '2026-01-02', code: '0050', name: '測試 ETF', market: '上市', action: '買入', shares: 1000, price: 100, fee: null, tax: null, note: '', ...overrides });
function fixture(seed = []) {
  const calls = { writes: 0, rebuilds: 0, permission: true, failRebuild: false, inserts: 0 };
  class Sheet {
    constructor(name, data) { this.name = name; this.data = data; }
    getMaxRows() { return 5000; }
    getMaxColumns() { return 26; }
    getLastRow() { return this.data.length; }
    insertRowBefore(r) { this.data.splice(r - 1, 0, []); calls.inserts++; }
    getRange(r, c, nr = 1, nc = 1) {
      const sheet = this;
      return {
        canEdit: () => calls.permission,
        getValue: () => sheet.data[r - 1]?.[c - 1] ?? '',
        getValues: () => Array.from({ length: nr }, (_, y) => Array.from({ length: nc }, (_, x) => sheet.data[r - 1 + y]?.[c - 1 + x] ?? '')),
        setNumberFormat() { return this; },
        setValue(value) { return this.setValues([[value]]); },
        setValues(values) {
          if (c === 1 && nc === 12) calls.writes++;
          values.forEach((row, y) => row.forEach((value, x) => { sheet.data[r - 1 + y] ||= []; sheet.data[r - 1 + y][c - 1 + x] = value; })); return this;
        },
      };
    }
  }
  const sheets = new Map([
    ['交易記錄', new Sheet('交易記錄', [['交易日期', '股票代號', '股票名稱', '市場', '買/賣', '股數', '成交價', '手續費', '交易稅', '實際成本/收入', '備註'], ...seed])],
    ['庫存總覽', new Sheet('庫存總覽', [['代號'], ['0050', '測試', '上市', 1000, 100, 100]])],
    ['股利記錄', new Sheet('股利記錄', [['代號']])], ['已實現損益', new Sheet('已實現損益', [['代號']])],
  ]);
  const context = { Date, console: { warn() {} }, SpreadsheetApp: { openById(id) { assert.equal(id, '1RH2r6Hx_y6-AuzZ_XXRw5dmVSnUqoUK2IfmtJF15w70'); return { getSheetByName: name => sheets.get(name) }; }, flush() {} },
    LockService: { getScriptLock: () => ({ tryLock: () => !calls.busy, releaseLock() {} }) },
    Utilities: { formatDate: value => value.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }) },
    getFeeSettings: () => ({ buyDiscount: 0.28, sellDiscount: 0.6, minFee: 20 }),
    calcHoldings: () => ({ '0050': { lots: [{ remaining: 1000 }] } }), fetchPrices: () => ({ '0050': 100 }), readTxList: () => ({}), fetchAndSaveDividends: () => ({}),
    writeSummaryContents_() { calls.rebuilds++; if (calls.failRebuild) throw new Error('temporary'); },
  };
  vm.runInNewContext(rules + '\n' + source, context);
  return { calls, sheets, run: (id, input) => context.stockfolioAddTransaction(id, input) };
}
test('browser and Apps Script share validation, rejecting malformed dates, quantities and missing fees', () => {
  const f = fixture();
  for (const input of [tx({ date: '2026-02-30' }), tx({ shares: 0 }), tx({ shares: 1.5 }), tx({ price: -1 }), tx({ fee: -1 }), tx({ fee: undefined }), tx({ code: '=IMPORTXML' }), tx({ note: '\n' }), tx({ tax: 5 })]) {
    assert.throws(() => validateTransaction(input)); assert.equal(f.run(randomUUID(), input).status, 'invalid');
  }
  assert.equal(f.calls.writes, 0);
});
test('writes all eleven transaction cells and the id atomically, preserving leading zeroes and calculating original fees', () => {
  const f = fixture(), id = randomUUID(); const result = f.run(id, tx());
  assert.equal(result.status, 'success'); assert.equal(result.inventoryUpdated, true); assert.equal(result.row, 2);
  const row = f.sheets.get('交易記錄').data[1];
  assert.equal(row[1], '0050'); assert.equal(row[7], 40); assert.equal(row[8], 0); assert.equal(row[9], 100040); assert.ok(row[11].startsWith(id + '|'));
  assert.equal(f.sheets.get('交易記錄').data[0][11], '藏股交易ID');
});
test('a saved transaction with failed rebuild is retried with the same id without a duplicate write', () => {
  const f = fixture(), id = randomUUID(); f.calls.failRebuild = true;
  assert.equal(f.run(id, tx()).inventoryUpdated, false); f.calls.failRebuild = false;
  assert.equal(f.run(id, tx()).inventoryUpdated, true); assert.equal(f.calls.writes, 1);
  assert.equal(f.run(id, tx({ shares: 2000 })).status, 'conflict'); assert.equal(f.calls.writes, 1);
});
test('viewers, concurrent updates and occupied metadata columns cannot write', () => {
  const f = fixture(); f.calls.permission = false;
  assert.equal(f.run(randomUUID(), tx()).status, 'forbidden'); f.calls.permission = true; f.calls.busy = true;
  assert.equal(f.run(randomUUID(), tx()).status, 'busy'); f.calls.busy = false; f.sheets.get('交易記錄').data[0][11] = '使用者其他資料';
  assert.equal(f.run(randomUUID(), tx()).status, 'configuration_required'); assert.equal(f.calls.writes, 0);
});
test('rejects overselling, including legacy numeric ETF codes; explicit fees and tax are retained', () => {
  const f = fixture([['2026/01/01', 50, '測試 ETF', '上市', '買入', 1000, 80, 20, 0, 80020, '']]);
  assert.equal(f.run(randomUUID(), tx({ action: '賣出', shares: 1001 })).status, 'invalid');
  assert.equal(f.run(randomUUID(), tx({ action: '賣出', fee: 12, tax: 100 })).status, 'success');
  const row = f.sheets.get('交易記錄').data[2]; assert.equal(row[1], '50'); assert.equal(row[7], 12); assert.equal(row[8], 100); assert.equal(row[9], 99888);
});
test('backdated entries are inserted before later trades, and spreadsheet text cannot become formulas', () => {
  const f = fixture([['2026/01/03', '0050', '測試 ETF', '上市', '買入', 1000, 80, 20, 0, 80020, '']]);
  const result = f.run(randomUUID(), tx({ name: '=1+1', note: '+IMPORTXML()' }));
  assert.equal(result.row, 2); assert.equal(f.calls.inserts, 1);
  const row = f.sheets.get('交易記錄').data[1]; assert.equal(row[2], "'=1+1"); assert.equal(row[10], "'+IMPORTXML()");
});
