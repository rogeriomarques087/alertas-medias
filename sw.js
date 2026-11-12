const CACHE = "medias-v4";
const ARQUIVOS = ["./", "index.html", "style.css", "app.js", "config.js", "manifest.webmanifest",
  "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Rede primeiro (dados sempre frescos); cache só se estiver sem internet
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok && new URL(e.request.url).origin === location.origin) {
      const copia = r.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copia));
    }
    return r;
  }).catch(() => caches.match(e.request)));
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { corpo: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.titulo || "Alertas de médias", {
    body: d.corpo || "",
    tag: d.tag,
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    data: { url: d.url || "./#alertas" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const alvo = new URL(e.notification.data?.url || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((abertas) => {
    for (const j of abertas) if (j.url.startsWith(self.registration.scope)) return j.focus();
    return self.clients.openWindow(alvo);
  }));
});
