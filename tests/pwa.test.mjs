import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
function worker(root = 'https://example.com/rugatha-trello/') {
  const handlers = {}, deleted = [];
  let skipped = false, claimed = false;
  const ownKeys = [`rugatha-offline-${new URL(root).pathname}-v0`, `rugatha-offline-${new URL(root).pathname}-v2`];
  const context = vm.createContext({URL,
    self: {
      location: {href: root + 'sw.js'},
      addEventListener: (name, fn) => {handlers[name] = fn;},
      skipWaiting: async () => {skipped = true;},
      clients: {claim: async () => {
        assert.deepEqual(deleted, ownKeys);
        claimed = true;
      }},
    },
    caches: {
      keys: async () => [...ownKeys, 'rugatha-offline-/other/-v2', 'unrelated'],
      delete: async key => {deleted.push(key); return true;},
    },
  });
  vm.runInContext(source, context);
  const dispatch = async name => {
    let pending;
    handlers[name]({waitUntil: value => {pending = value;}});
    await pending;
  };
  return {handlers, dispatch, deleted, ownKeys, get skipped() {return skipped;}, get claimed() {return claimed;}};
}

test('replacement worker activates without downloading an offline page', async () => {
  const w = worker();
  await w.dispatch('install');
  assert.equal(w.skipped, true);
});

test('activation removes every legacy cache in its own scope before taking control', async () => {
  for (const root of ['https://example.com/', 'https://example.com/rugatha-trello/']) {
    const w = worker(root);
    await w.dispatch('activate');
    assert.deepEqual(w.deleted, w.ownKeys);
    assert.equal(w.claimed, true);
  }
});

test('worker leaves navigation, APIs and assets to the browser without a fetch handler', () => {
  assert.equal(worker().handlers.fetch, undefined);
});
