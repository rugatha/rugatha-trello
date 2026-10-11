// Resolve from the module URL so both a domain root and GitHub Pages subpaths work.
const root = new URL('../', import.meta.url);
if ('serviceWorker' in navigator && window.isSecureContext &&
    [root.pathname, `${root.pathname}index.html`].includes(location.pathname)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('sw.js', root), {
      scope: root.pathname,
      updateViaCache: 'none',
    }).catch(error => console.warn('PWA registration failed:', error));
  });
}
