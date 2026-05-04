self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open('smart-cut-pwa-v1').then((cache) => cache.addAll([
      '/',
      '/index.html',
      '/ico/favicon-32x32.png',
      '/ico/android-chrome-192x192.png',
      '/ico/site.webmanifest'
    ]))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith('smart-cut-pwa-') && key !== 'smart-cut-pwa-v1')
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open('smart-cut-pwa-v1').then((cache) => cache.put(event.request, copy));
      return response;
    }).catch(() => cached))
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || '/';

  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if ('focus' in client) {
        await client.focus();
        if (targetUrl && 'navigate' in client) {
          client.navigate(targetUrl);
        }
        return;
      }
    }
    if (clients.openWindow) {
      await clients.openWindow(targetUrl);
    }
  })());
});
