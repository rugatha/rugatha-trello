// Cache only a static offline notice. Workspace data and attachments stay on the network.
const ROOT = new URL('./', self.location.href);
const CACHE_PREFIX = `rugatha-offline-${ROOT.pathname}-`;
const CACHE = `${CACHE_PREFIX}v2`;
const OFFLINE = new URL('offline.html', ROOT).href;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add(OFFLINE)));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE)
      .map(key => caches.delete(key))
  )));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || event.request.mode !== 'navigate' ||
      url.origin !== ROOT.origin ||
      ![ROOT.pathname, `${ROOT.pathname}index.html`].includes(url.pathname)) return;
  event.respondWith(fetch(event.request).catch(async () => {
    const cache = await caches.open(CACHE);
    return (await cache.match(OFFLINE)) || Response.error();
  }));
});
