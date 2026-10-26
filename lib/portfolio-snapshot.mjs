import { PORTFOLIO_SOURCES, SPREADSHEET_ID } from './portfolio-sources.mjs';
import { createIndexedAuthStorage } from './browser-auth-storage.mjs';

export function rowsFrom(result) {
  if (Array.isArray(result?.values)) return result.values;
  if (result?.structuredContent) return rowsFrom(result.structuredContent);
  for (const block of result?.content || []) if (block.type === 'text') {
    try { const data = JSON.parse(block.text); if (data.values || data.structuredContent) return rowsFrom(data); } catch {}
  }
  throw new Error('未收到完整的試算表資料，請重新同步。');
}

function validSource(source, entry) {
  if (!Object.hasOwn(PORTFOLIO_SOURCES, source) || !Number.isSafeInteger(entry?.savedAt) || entry.savedAt <= 0 || !Array.isArray(entry.rows)) return false;
  const range = PORTFOLIO_SOURCES[source][1].match(/:([A-Z]+)(\d+)$/);
  const columns = [...range[1]].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0);
  return entry.rows.length <= Number(range[2]) && entry.rows.every(row => Array.isArray(row) && row.length <= columns && row.every(cell => cell === null || typeof cell === 'string' || (typeof cell === 'number' && Number.isFinite(cell))));
}
function decode(value) {
  try {
    const saved = JSON.parse(value);
    if (saved?.version !== 1 || saved.spreadsheetId !== SPREADSHEET_ID || typeof saved.epoch !== 'string' || !saved.epoch || !saved.sources || Array.isArray(saved.sources) || typeof saved.sources !== 'object' || !Object.entries(saved.sources).every(([source, entry]) => validSource(source, entry))) return null;
    return saved;
  } catch { return null; }
}

/** Financial rows are device-only, separate from Google authorization. */
export function createPortfolioSnapshot({ store = createIndexedAuthStorage({ databaseName: 'stockfolio-portfolio', storeName: 'snapshots' }), id = () => crypto.randomUUID() } = {}) {
  const key = SPREADSHEET_ID;
  const empty = () => ({ version: 1, spreadsheetId: SPREADSHEET_ID, epoch: id(), sources: {} });
  let snapshot = empty(), persisted = false, generation = 0;
  const ready = (async () => {
    const version = generation;
    try {
      const value = await store.update(key, current => decode(current) ? undefined : JSON.stringify(snapshot));
      if (version === generation) { snapshot = decode(value) || snapshot; persisted = true; }
    } catch { /* A tab can still show data when device storage is unavailable. */ }
  })();
  return {
    async load() { await ready; return structuredClone({ sources: snapshot.sources, persisted }); },
    async reload() {
      const version = ++generation;
      await ready;
      try {
        const value = await store.read(key);
        if (version === generation) { snapshot = decode(value) || empty(); persisted = Boolean(decode(value)); }
      } catch { if (version === generation) { snapshot = empty(); persisted = false; } }
    },
    async save(source, rows, savedAt) {
      if (!validSource(source, { rows, savedAt })) return false;
      const version = generation;
      await ready;
      if (version !== generation) return false;
      const expectedEpoch = snapshot.epoch;
      const entry = structuredClone({ rows, savedAt });
      snapshot.sources[source] = entry;
      try {
        const value = await store.update(key, current => {
          const saved = decode(current);
          if (!saved || saved.epoch !== expectedEpoch) return undefined;
          // Concurrent reads may finish out of order; keep the newer source.
          if ((saved.sources[source]?.savedAt || 0) > savedAt) return undefined;
          return JSON.stringify({ ...saved, sources: { ...saved.sources, [source]: entry } });
        });
        const saved = decode(value);
        if (version !== generation || saved?.epoch !== expectedEpoch) return false;
        snapshot = saved; persisted = true;
        return saved.sources[source]?.savedAt === savedAt;
      } catch { persisted = false; return false; }
    },
    async clear() {
      const wasPersisted = persisted;
      generation++; snapshot = empty(); persisted = false;
      await ready;
      try { await store.update(key, () => JSON.stringify(snapshot)); persisted = true; return true; }
      catch { return !wasPersisted; }
    },
  };
}

export function createSavedPortfolioApi({ api, cache = createPortfolioSnapshot(), now = Date.now, events = globalThis, getStorage = () => globalThis.localStorage } = {}) {
  let generation = 0, resetting = Promise.resolve();
  const listeners = new Set();
  const marker = `stockfolio.portfolio-cleared.v1:${SPREADSHEET_ID}`;
  function storageChanged(event) {
    if (event.key !== marker && event.key !== null) return;
    generation++;
    resetting = cache.reload();
    for (const listener of listeners) listener('cleared');
  }
  const clearSaved = async () => {
    generation++;
    const cleared = await cache.clear();
    try { getStorage()?.setItem(marker, crypto.randomUUID()); } catch {}
    for (const listener of listeners) listener('cleared');
    if (!cleared) throw new Error('Cannot clear saved device data');
  };
  return {
    ...api,
    saved: async () => { await resetting; return cache.load(); },
    clearSaved,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) events.addEventListener?.('storage', storageChanged);
      const unsubscribe = api.subscribe?.(listener);
      return () => { unsubscribe?.(); listeners.delete(listener); if (!listeners.size) events.removeEventListener?.('storage', storageChanged); };
    },
    async read(source) {
      const version = generation;
      await resetting;
      if (version !== generation) return { status: 'cancelled' };
      const result = await api.read(source);
      if (version !== generation) return { status: 'cancelled' };
      if (result.status !== 'success') return result;
      const savedAt = now();
      const savedLocally = await cache.save(source, rowsFrom(result.result), savedAt);
      return version === generation ? { ...result, savedAt, savedLocally } : { status: 'cancelled' };
    },
    async logout() {
      let cleared = true;
      try { await clearSaved(); } catch { cleared = false; }
      const result = await api.logout();
      return cleared ? result : { status: 'storage_error', message: 'Google 已登出，但此裝置保存的資料未能清除，請清除瀏覽器的網站資料。' };
    },
  };
}
