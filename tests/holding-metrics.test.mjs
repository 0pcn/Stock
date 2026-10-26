import test from 'node:test';
import assert from 'node:assert/strict';
import { unrealizedPosition } from '../lib/holding-metrics.mjs';

test('a current loss stays negative even when earlier sales make cumulative profit positive', () => {
  const row = ['2330', '測試股票', '上市', 100, 1000, 800, 100000, 80000, 50000, -20000, 30000, 10000, 40000, .3, .4];
  assert.deepEqual(unrealizedPosition(row), { profitLoss: -20000, returnRate: -.2 });
  row[8] = 200000; row[10] = 180000; row[11] = 90000; row[12] = 270000;
  assert.deepEqual(unrealizedPosition(row), { profitLoss: -20000, returnRate: -.2 });
});
test('remaining cost is the denominator after partial sales', () => {
  const row = ['0050', '測試 ETF', '上市', 500, 40, 50, '20000', 25000, 3000, '4800', 7800, 1000];
  assert.deepEqual(unrealizedPosition(row), { profitLoss: 4800, returnRate: .24 });
});
test('a zero-cost position avoids infinite or invalid return values', () => {
  assert.deepEqual(unrealizedPosition([null, null, null, null, null, null, 0, 5000, 0, 5000]), { profitLoss: 5000, returnRate: 0 });
  assert.deepEqual(unrealizedPosition([]), { profitLoss: 0, returnRate: 0 });
});
