import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { holdingRoute, createHoldingNavigation } from '../lib/holding-navigation.mjs';
const view = { tab: 'holdings', query: 'ETF', market: 'ETF', sort: 'return', filtersOpen: true };
test('holding routes support valid stock codes and reject malformed or unrelated hashes', () => {
  assert.equal(holdingRoute('#holding/0050'), '0050'); assert.equal(holdingRoute('#holding/aapl'), 'AAPL');
  for (const hash of ['', '#unrelated', '#holding/', '#holding/%', '#holding/%3Cscript%3E', '#holding/0050/extra']) assert.equal(holdingRoute(hash), null);
});
test('navigation writes only UI context, ignores duplicate history events and removes positions on logout', t => {
  const dom = new JSDOM('', { url: 'https://0pcn.github.io/Stock/' }); t.after(() => dom.window.close());
  const updates = [], browser = dom.window;
  Object.defineProperty(browser, 'scrollY', { value: 512 });
  const nav = createHoldingNavigation({ browser, onChange: value => updates.push(value) }); t.after(() => nav.dispose());
  nav.open('0050', { ...view, access_token: 'never-store-this', rows: [['private']] });
  assert.equal(browser.location.hash, '#holding/0050'); assert.equal(browser.history.length, 2);
  assert.equal(browser.history.state.stockfolioList.scrollY, 512);
  assert.ok(!JSON.stringify(browser.history.state).includes('never-store-this')); assert.ok(!JSON.stringify(browser.history.state).includes('private'));
  const count = updates.length;
  browser.dispatchEvent(new browser.PopStateEvent('popstate')); browser.dispatchEvent(new browser.HashChangeEvent('hashchange'));
  assert.equal(updates.length, count);
  nav.reset(); assert.equal(browser.location.hash, ''); assert.equal(browser.history.state.stockfolioHolding, undefined); assert.equal(browser.history.state.stockfolioList, undefined);
  assert.equal(updates.at(-1).code, null);
});
