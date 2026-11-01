// Only the public app shell is cached. Never store captures or live positions.
const CACHE = 'azeroth-live-map-shell-v2';
const ROOT = new URL('./', self.location.href);
const SHELL = ['index.html','style.css','app.js','protocol.js','prefs.js','companion.js',
  'maps.json','icon.svg','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png'];
const URLS = SHELL.map(path => new URL(path, ROOT).href);
const INDEX = new URL('index.html', ROOT).href;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(URLS)));
  // An update waits for existing windows to close, preserving active captures.
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('azeroth-live-map-shell-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== ROOT.origin) return;
  const navigation = event.request.mode === 'navigate' && [ROOT.pathname, new URL(INDEX).pathname].includes(url.pathname);
  // Ignore query strings only for the app's launch URL, never arbitrary requests.
  if (!navigation && !URLS.includes(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      // Do not mask authentication errors or redirects with an old offline page.
      return await fetch(event.request);
    } catch {
      return await cache.match(navigation ? INDEX : event.request) || Response.error();
    }
  })());
});
