// Service worker: keeps the app shell available offline. Plan B: no web push. Never caches desk data (data/).
const SHELL = "desk-shell-v3";
const FILES = ["./", "index.html", "app.css", "app.js", "chart.js", "manifest.json", "icons/apple-touch-icon.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.includes("/data/")) return;
  e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(SHELL).then((c) => c.put(e.request, cp)); return r; })
    .catch(() => caches.match(e.request)));
});
