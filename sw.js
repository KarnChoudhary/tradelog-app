/* ═══════════════════════════════════════════════
   TradeLog Service Worker
   Strategy:
   - HTML + JS  → Network-first (always get latest code)
   - CSS        → Network-first (always get latest styles)
   - Fonts/images → Cache-first (rarely change)
   - Supabase   → Network only
   This prevents stale code from running after a deployment.
═══════════════════════════════════════════════ */

const CACHE_NAME  = 'tradelog-static-v3';
const FONT_CACHE  = 'tradelog-fonts-v1';

// Files to pre-cache for offline support (static assets only)
const OFFLINE_SHELL = ['./index.html', './app.js', './style.css'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(OFFLINE_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== FONT_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // ── Supabase / external APIs → network only, no cache
  if (url.includes('supabase.co') || url.includes('googleapis.com/css')) {
    e.respondWith(
      fetch(e.request).catch(() => new Response('', { status: 503 }))
    );
    return;
  }

  // ── Google Fonts files (woff2) → cache-first (they never change)
  if (url.includes('fonts.gstatic.com')) {
    e.respondWith(
      caches.open(FONT_CACHE).then(c =>
        c.match(e.request).then(cached => {
          if (cached) return cached;
          return fetch(e.request).then(resp => {
            c.put(e.request, resp.clone());
            return resp;
          });
        })
      )
    );
    return;
  }

  // ── App shell: HTML, JS, CSS → NETWORK-FIRST
  // Always try to get the latest code from the server.
  // Only fall back to cache if completely offline.
  if (
    url.endsWith('.html') || url.endsWith('.js') ||
    url.endsWith('.css')  || url.endsWith('/')   ||
    e.request.mode === 'navigate'
  ) {
    e.respondWith(
      fetch(e.request)
        .then(resp => {
          // Cache the fresh response for offline fallback
          if (resp && resp.status === 200) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          }
          return resp;
        })
        .catch(() =>
          // Offline fallback: serve from cache
          caches.match(e.request).then(cached =>
            cached || caches.match('./index.html')
          )
        )
    );
    return;
  }

  // ── Everything else (icons, manifests) → cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        if (resp && resp.status === 200) {
          caches.open(CACHE_NAME).then(c => c.put(e.request, resp.clone()));
        }
        return resp;
      });
    })
  );
});
