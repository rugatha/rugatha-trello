// Keep the worker URL so existing installations can retire their offline caches.
// All requests use the browser's normal network behavior.
const ROOT = new URL('./', self.location.href);
const CACHE_PREFIX = `rugatha-offline-${ROOT.pathname}-`;

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith(CACHE_PREFIX))
      .map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
