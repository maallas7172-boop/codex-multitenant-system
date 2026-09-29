/* =========================================================
   service-worker.js — دعم التثبيت والعمل أوفلاين للمنظومة المتعددة (PWA)
   ========================================================= */
const CACHE_NAME = 'reports-multitenant-v5.0';
const STATIC_ASSETS = [
  './',
  './index.html',
  './login.html',
  './entry.html',
  './admin.html',
  './super_admin.html',
  './manifest.json',
  './css/styles.css',
  './js/config.js',
  './js/app.js',
  './js/login.js',
  './js/entry.js',
  './js/admin.js',
  './js/super_admin.js',
  './js/report-header.js',
  './js/qrcode.min.js',
  './js/crypto-js.js',
  './Image/app_logo.jpg',
  './Image/codex_logo.jpg',
  './Image/1754379379088.jpg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        STATIC_ASSETS.map(url => cache.add(url).catch(() => {}))
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // إذا كان الطلب إلى API، يتم إرساله للشبكة مباشرة دون اعتراض
  if (url.pathname.startsWith('/api')) {
    return;
  }

  // Network first with cache fallback for static assets
  event.respondWith(
    fetch(event.request).then((networkResponse) => {
      if (networkResponse && networkResponse.status === 200) {
        const copy = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      }
      return networkResponse;
    }).catch(async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      if (event.request.mode === 'navigate') {
        const navFallback = (await caches.match('./login.html')) || (await caches.match('./entry.html'));
        if (navFallback) return navFallback;
      }
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    })
  );
});
