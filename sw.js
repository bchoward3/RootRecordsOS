// ══════════════════════════════════════════
// RootRecords Service Worker
// Caches app shell + map tiles for offline use
// ══════════════════════════════════════════

const CACHE_VERSION = 'rootrecords-v10';
const TILE_CACHE = 'rootrecords-tiles-v1';

// Core app files cached on install
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './db.js',
  './route.js',
  './grave.png',
  './manifest.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/lite.umd.js'
];

// ── Install: cache app shell ──
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(APP_SHELL).catch(err => {
        console.warn('[SW] Some assets failed to cache:', err);
      }))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_VERSION && k !== TILE_CACHE)
            .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: serve from cache, fall back to network ──
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache Supabase API calls — always need fresh data
  if (url.hostname.includes('supabase.co')) {
    return; // let it go straight to network
  }

  // Map tiles — cache-first with runtime caching
  const isTile = url.hostname.includes('basemaps.cartocdn.com') ||
                 url.hostname.includes('tile.openstreetmap.org') ||
                 url.hostname.includes('tile.opentopomap.org') ||
                 url.hostname.includes('server.arcgisonline.com') ||
                 url.hostname.includes('basemap.nationalmap.gov') ||
                 url.hostname.includes('api.mapbox.com');

  if (isTile) {
    event.respondWith(
      caches.open(TILE_CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(response => {
            // Cache successful responses (status 200) and opaque responses
            // (status 0 from no-cors requests used during bulk download)
            if (response.status === 200 || response.type === 'opaque') {
              cache.put(event.request, response.clone());
            }
            return response;
          }).catch(() => {
            // Offline and tile not cached — transparent placeholder
            return new Response('', { status: 204 });
          });
        })
      )
    );
    return;
  }

  // App shell — cache-first, network fallback
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Cache new same-origin requests
        if (response.status === 200 && url.origin === location.origin) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

// ── Message handler for cache management ──
self.addEventListener('message', (event) => {
  if (event.data?.action === 'clearTileCache') {
    caches.delete(TILE_CACHE).then(() => {
      event.ports[0]?.postMessage({ success: true });
    });
  }
});
