/* =========================================================
   service-worker.js — دعم التثبيت والعمل أوفلاين (PWA) — كامل الملفات
   ========================================================= */
const CACHE_NAME = 'reports-app-v3.1';
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

  // إذا كان الطلب إلى API، يتم إرساله للشبكة أولاً
  if (url.pathname.startsWith('/api')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({ error: 'أنت في وضع عدم الاتصال بالخادم حالياً' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      })
    );
    return;
  }

  // بالنسبة للملفات الثابتة (HTML, CSS, JS, Images)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
          }
        }).catch(() => {});
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return networkResponse;
      }).catch(async () => {
        if (event.request.mode === 'navigate') {
          const navFallback = (await caches.match('./entry.html')) || (await caches.match('./login.html'));
          if (navFallback) return navFallback;
        }
        return new Response('', { status: 408, statusText: 'Offline' });
      });
    })
  );
});
