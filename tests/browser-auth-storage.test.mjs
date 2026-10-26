import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedAuthStorage } from '../lib/browser-auth-storage.mjs';

test('committed authorization survives closing and reopening the database', async () => {
  const indexedDB = new IDBFactory();
  const first = createIndexedAuthStorage({ getIndexedDB: () => indexedDB });
  assert.equal(await first.write('client-a', 'authorization-a'), true);
  const reopened = createIndexedAuthStorage({ getIndexedDB: () => indexedDB });
  assert.equal(await reopened.read('client-a'), 'authorization-a');
  assert.equal(await reopened.read('client-b'), null);
  await reopened.remove('client-a', 'authorization-a');
  assert.equal(await first.read('client-a'), null);
});
test('an older page cannot delete a newer saved authorization', async () => {
  const indexedDB = new IDBFactory();
  const storage = createIndexedAuthStorage({ getIndexedDB: () => indexedDB });
  await storage.write('client', 'old'); await storage.write('client', 'new');
  await storage.remove('client', 'old');
  assert.equal(await storage.read('client'), 'new');
});
test('blocked or unavailable storage fails in bounded time without hanging login', async () => {
  const unavailable = createIndexedAuthStorage({ getIndexedDB: () => undefined });
  await assert.rejects(unavailable.read('client'));
  const blocked = createIndexedAuthStorage({ getIndexedDB: () => ({ open: () => ({}) }), timeoutMs: 10 });
  await assert.rejects(blocked.write('client', 'authorization'));
});
