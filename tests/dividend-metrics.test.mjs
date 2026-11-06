import test from 'node:test';
import assert from 'node:assert/strict';
import { dividendDate, dividendEntries, dividendMonths, dividendStocks, dividendTotal } from '../lib/dividend-metrics.mjs';
const serial = date => Date.parse(date + 'T00:00:00Z') / 86400000 + 25569;
const rows = [['股票代號', '股票名稱', '除息日', '每股現金股利', '持有股數', '實際領到股利'],
  [50, '測試 ETF', serial('2026-01-02'), 1, 100, 100],
  ['0050', '測試 ETF', '2026/1/20', 2, 100, 200.5],
  ['2330', '測試股票', '2026-01-31', 5, 60, 300],
  ['0050', '測試 ETF', '2025/1/20', 4, 100, 400],
  ['0050', '測試 ETF', '2026/3/20', 6, 100, 600],
  ['9999', '無配息', '-', 0, 0, 0],
  ['合計', '', '2026/1/1', 0, 0, 9999],
  ['2330', '錯誤日期', '2026/2/30', 10, 100, 1000]];
test('dividend dates accept Sheets serials and strings, reject blanks, impossible dates and invalid numbers', () => {
  assert.equal(dividendDate(serial('2026-01-02')), '2026-01-02');
  assert.equal(dividendDate('2026/1/2'), '2026-01-02');
  assert.equal(dividendDate('2024-02-29'), '2024-02-29');
  for (const value of [null, '', '-', Infinity, NaN, 1e20, '2026/2/29', '2026/13/1']) assert.equal(dividendDate(value), null);
});
test('monthly totals combine every stock and payment in the chosen year using received amounts, preserving fractional totals', () => {
  const entries = dividendEntries(rows).filter(entry => entry.year === '2026'), months = dividendMonths(entries);
  assert.equal(months.length, 12); assert.equal(months[0].amount, 600.5); assert.equal(months[0].count, 3);
  assert.equal(months[1].amount, 0); assert.equal(months[11].amount, 0); assert.equal(months[2].amount, 600);
  assert.equal(dividendTotal(entries), 1200.5); assert.equal(months.reduce((sum, month) => sum + month.amount, 0), dividendTotal(entries));
});
test('single stock history combines numeric code aliases across years, including positions no longer held', () => {
  const entries = dividendEntries(rows), stocks = dividendStocks(entries);
  assert.deepEqual(stocks.map(stock => [stock.code, stock.amount, stock.count]), [['0050', 1300.5, 4], ['2330', 300, 1]]);
  assert.deepEqual(entries.map(entry => entry.date), ['2026-03-20', '2026-01-31', '2026-01-20', '2026-01-02', '2025-01-20']);
});
