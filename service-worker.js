const CACHE_NAME = "noahfarm-v4";
const ASSETS =[
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request);
    }).catch(() => console.warn("Offline & file not cached:", event.request.url))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => {
    return Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)));
  }));
  self.clients.claim();
});