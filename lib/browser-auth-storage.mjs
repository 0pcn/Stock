/** Device-only backup. Resolve writes after the transaction commits, not just put(). */
export function createIndexedAuthStorage({ getIndexedDB = () => globalThis.indexedDB, timeoutMs = 3000 } = {}) {
  async function run(mode, operation) {
    let database, transaction;
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        try { transaction?.abort(); } catch {}
        finish(new Error('Authorization storage timed out'));
      }, timeoutMs);
      function finish(error, result) {
        if (settled) return;
        settled = true; clearTimeout(timer); database?.close();
        if (error) reject(error); else resolve(result);
      }
      try {
        const factory = getIndexedDB();
        if (!factory) { finish(new Error('Authorization storage unavailable')); return; }
        const opening = factory.open('stockfolio-authorization', 1);
        opening.onupgradeneeded = () => {
          if (!opening.result.objectStoreNames.contains('tokens')) opening.result.createObjectStore('tokens');
        };
        opening.onerror = () => finish(new Error('Cannot open authorization storage'));
        opening.onblocked = () => finish(new Error('Authorization storage blocked'));
        opening.onsuccess = () => {
          database = opening.result;
          if (settled) { database.close(); return; }
          database.onversionchange = () => database.close();
          try {
            try { transaction = database.transaction('tokens', mode, { durability: 'strict' }); }
            catch { transaction = database.transaction('tokens', mode); }
            let result;
            transaction.oncomplete = () => finish(null, result);
            transaction.onabort = transaction.onerror = () => finish(new Error('Authorization storage operation failed'));
            operation(transaction.objectStore('tokens'), value => { result = value; });
          } catch { finish(new Error('Authorization storage operation failed')); }
        };
      } catch { finish(new Error('Authorization storage unavailable')); }
    });
  }
  return {
    read(key) { return run('readonly', (store, done) => { store.get(key).onsuccess = event => done(event.target.result ?? null); }); },
    async write(key, value) {
      await run('readwrite', store => { store.put(value, key); });
      return await this.read(key) === value;
    },
    remove(key, expected) {
      return run('readwrite', store => {
        store.get(key).onsuccess = event => { if (event.target.result === expected) store.delete(key); };
      });
    },
  };
}
