/*
  Mr Techlab Studio — service worker (structure only, not yet registered from index.html).
  Kept intentionally minimal: caches only the static app shell, never app/catalog data
  (which must always come fresh from Firebase). To activate, register it from index.html:
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
*/
const CACHE_NAME = "mr-apk-bazar-shell-v1";
const SHELL_ASSETS = [
  "./index.html",
  "./manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for everything; falls back to the cached app shell only when offline.
// Firebase requests are always left to hit the network normally.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(event.request).then((cached) => cached || caches.match("./index.html"))
    )
  );
});