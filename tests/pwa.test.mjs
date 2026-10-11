import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
function worker(root = 'https://example.com/rugatha-trello/', online = true) {
  const handlers = {}, added = [], deleted = [];
  const fallback = new Response('offline notice');
  const context = vm.createContext({URL, Response,
    self: {location: {href: root + 'sw.js'}, addEventListener: (name, fn) => {handlers[name] = fn;}},
    fetch: async () => {if (!online) throw Error('offline'); return new Response('network page');},
    caches: {
      open: async () => ({add: async url => added.push(url), match: async () => fallback}),
      keys: async () => ['rugatha-offline-/rugatha-trello/-v0', 'rugatha-offline-/other/-v0', 'unrelated'],
      delete: async key => deleted.push(key),
    },
  });
  vm.runInContext(source, context);
  const navigate = (path, mode = 'navigate', method = 'GET') => {
    let response;
    handlers.fetch({request: {url: new URL(path, root).href, mode, method}, respondWith: value => {response = value;}});
    return response;
  };
  return {handlers, added, deleted, fallback, navigate};
}

test('worker caches only the offline notice and cleans only its own scope', async () => {
  const w = worker(); let pending;
  w.handlers.install({waitUntil: value => {pending = value;}}); await pending;
  assert.deepEqual(w.added, ['https://example.com/rugatha-trello/offline.html']);
  w.handlers.activate({waitUntil: value => {pending = value;}}); await pending;
  assert.deepEqual(w.deleted, ['rugatha-offline-/rugatha-trello/-v0']);
});

test('home navigation uses live network and falls back only when offline at root or Pages subpath', async () => {
  for (const root of ['https://example.com/', 'https://example.com/rugatha-trello/']) {
    assert.equal(await (await worker(root).navigate('./')).text(), 'network page');
    const w = worker(root, false);
    for (const path of ['./', './index.html?installed=1']) assert.equal(await w.navigate(path), w.fallback);
  }
});

test('worker leaves APIs, attachments, modules, tests and other apps untouched', () => {
  const w = worker(undefined, false);
  for (const [url, mode, method] of [
    ['./src/auth.js', 'cors', 'GET'], ['./assets/private.png', 'no-cors', 'GET'],
    ['./tests/browser/phase6-live.html', 'navigate', 'GET'], ['/other/', 'navigate', 'GET'],
    ['https://firestore.googleapis.com/', 'cors', 'GET'], ['./', 'navigate', 'POST'],
  ]) assert.equal(w.navigate(url, mode, method), undefined);
});
