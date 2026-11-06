const holdingKey = 'stockfolioHolding';
const listKey = 'stockfolioList';
const codePattern = /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,15}$/;
export function holdingRoute(hash) {
  const match = /^#holding\/([^/]+)$/.exec(hash || '');
  if (!match) return null;
  try { const code = decodeURIComponent(match[1]); return codePattern.test(code) ? code.toUpperCase() : null; } catch { return null; }
}
function returnContext(value) {
  if (!value || !['holdings', 'overview'].includes(value.tab) || typeof value.query !== 'string' || value.query.length > 500 || typeof value.market !== 'string' || !['value', 'return', 'code'].includes(value.sort) || typeof value.filtersOpen !== 'boolean' || !Number.isFinite(value.scrollY) || value.scrollY < 0) return null;
  return { tab: value.tab, query: value.query, market: value.market, sort: value.sort, filtersOpen: value.filtersOpen, scrollY: value.scrollY, focusCode: typeof value.focusCode === 'string' && codePattern.test(value.focusCode) ? value.focusCode : '' };
}
/** Only navigation metadata is stored in history; no financial rows or tokens. */
export function createHoldingNavigation({ browser = window, onChange }) {
  const path = () => browser.location.pathname + browser.location.search;
  const state = () => browser.history.state && typeof browser.history.state === 'object' ? browser.history.state : {};
  let closing = false, lastNotification = '';
  let context = returnContext(state()[listKey]);
  const previousRestoration = browser.history.scrollRestoration;
  if (previousRestoration) browser.history.scrollRestoration = 'manual';
  function update() {
    closing = false;
    context = returnContext(state()[listKey]) || context;
    const code = holdingRoute(browser.location.hash);
    const notification = JSON.stringify({ code, context });
    if (notification === lastNotification) return;
    lastNotification = notification;
    onChange({ code, context, restore: !code && Boolean(context) });
  }
  browser.addEventListener('popstate', update);
  browser.addEventListener('hashchange', update);
  update();
  return {
    open(code, view) {
      if (!codePattern.test(code) || holdingRoute(browser.location.hash)) return;
      code = code.toUpperCase();
      const nextContext = returnContext({ ...view, scrollY: Math.max(0, browser.scrollY || 0), focusCode: code });
      if (!nextContext) return;
      context = nextContext;
      const parent = { ...state(), [listKey]: context }; delete parent[holdingKey];
      browser.history.replaceState(parent, '', path());
      browser.history.pushState({ ...parent, [holdingKey]: { code, fromApp: true } }, '', path() + '#holding/' + encodeURIComponent(code));
      update();
    },
    back() {
      if (closing) return;
      const code = holdingRoute(browser.location.hash);
      if (code && state()[holdingKey]?.fromApp === true && state()[holdingKey]?.code === code && returnContext(state()[listKey])) {
        closing = true; browser.history.back();
      } else {
        context ||= { tab: 'holdings', query: '', market: '全部', sort: 'value', filtersOpen: false, scrollY: 0, focusCode: code || '' };
        const next = { ...state(), [listKey]: context }; delete next[holdingKey];
        browser.history.replaceState(next, '', path()); update();
      }
    },
    reset() {
      context = null; closing = false; lastNotification = '';
      const next = { ...state() }; delete next[holdingKey]; delete next[listKey];
      browser.history.replaceState(next, '', path());
      onChange({ code: null, context: null, restore: false });
    },
    dispose() {
      browser.removeEventListener('popstate', update); browser.removeEventListener('hashchange', update);
      if (previousRestoration) browser.history.scrollRestoration = previousRestoration;
    },
  };
}
