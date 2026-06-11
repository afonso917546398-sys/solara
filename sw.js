const CACHE = "solara-v3";
const DATA_CACHE = "solara-data-v1";
const STATIC = ["./", "./index.html"];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE && k !== DATA_CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);

  // Weather/geocoding data: network first, fall back to the last good
  // response so the app still shows data offline or on flaky connections.
  // Freshness while online is handled by react-query's staleTime.
  if (url.hostname.includes("open-meteo")) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(DATA_CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Nominatim (search/reverse geocode): network only — low cache value
  if (url.hostname.includes("nominatim")) {
    e.respondWith(fetch(e.request));
    return;
  }

  // App shell and assets: network first, fall back to cache
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
