const CACHE = 'picking-sn-v2';
const STATIC = ['/', '/index.html', '/manifest.json', '/icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Deixa passar sem cache: API, CDNs externos
  if (url.pathname.startsWith('/api/') ||
      url.hostname.includes('jsdelivr.net') ||
      url.hostname.includes('unpkg.com') ||
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('gstatic.com')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Arquivos estáticos: cache first
  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
