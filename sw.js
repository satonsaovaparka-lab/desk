// Service worker: keeps the app shell available offline. Never caches desk data (data/).
// Web push handlers per STEP 8 (plan B has no subscription endpoint, so nothing is ever pushed here).
const SHELL = "desk-shell-v4";
const FILES = ["./", "index.html", "app.css", "app.js", "chart.js", "manifest.json", "icons/apple-touch-icon.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.includes("/data/")) return;
  e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(SHELL).then((c) => c.put(e.request, cp)); return r; })
    .catch(() => caches.match(e.request)));
});
self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (_) {}
  e.waitUntil(self.registration.showNotification(d.title || "Grok Bot", { body: d.body || "", data: { url: d.url || null }, icon: "icons/apple-touch-icon.png" }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data && e.notification.data.url;   // exact links.coin_url string from the desk
  e.waitUntil(url ? clients.openWindow(url) : clients.openWindow("./"));
});
