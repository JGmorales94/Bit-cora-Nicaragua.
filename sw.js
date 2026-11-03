/* Service worker de la Bitácora de Obra: abre la app sin conexión y envía reportes en segundo plano. */
var VERSION = "bitacora-v1";
var FUENTES = "bitacora-fuentes";
var SHELL = ["./", "index.html", "config.js", "cola.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"];
importScripts("config.js", "cola.js");

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== VERSION && k !== FUENTES; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin === self.location.origin) {
    // Archivos de la app: responde desde el celular y actualiza por detrás.
    var key = req.mode === "navigate" ? "index.html" : req;
    e.respondWith(caches.open(VERSION).then(function (c) {
      return c.match(key, { ignoreSearch: true }).then(function (hit) {
        var net = fetch(req).then(function (r) { if (r && r.ok) c.put(key, r.clone()); return r; }).catch(function () { return null; });
        if (hit) { e.waitUntil(net); return hit; }
        return net.then(function (r) { return r || new Response("Sin conexión", { status: 503 }); });
      });
    }));
    return;
  }
  if (url.host === "fonts.googleapis.com" || url.host === "fonts.gstatic.com") {
    e.respondWith(caches.open(FUENTES).then(function (c) {
      return c.match(req).then(function (hit) {
        return hit || fetch(req).then(function (r) { c.put(req, r.clone()); return r; }).catch(function () { return new Response("", { status: 503 }); });
      });
    }));
  }
});

// Android: envía la cola cuando vuelve la señal, aunque la app esté cerrada.
self.addEventListener("sync", function (e) {
  if (e.tag !== "enviar-reportes") return;
  e.waitUntil(BitacoraCola.enviarCola().then(function (r) {
    return self.clients.matchAll().then(function (cs) {
      cs.forEach(function (c) { c.postMessage({ tipo: "enviados", n: r.enviados }); });
      if (r.pendientes) throw new Error("Quedan reportes pendientes");
    });
  }));
});
self.addEventListener("message", function (e) {
  if (e.data && e.data.tipo === "enviar") e.waitUntil(BitacoraCola.enviarCola());
});
