/* Bitácora de Obra — almacenamiento local y envío al servidor.
 * Lo usan la página y el service worker (envío en segundo plano). */
(function (g) {
  "use strict";
  var DB = "bitacora-obra", V = 1, dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      var q = indexedDB.open(DB, V);
      q.onupgradeneeded = function () {
        var d = q.result;
        if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv");
        if (!d.objectStoreNames.contains("cola")) d.createObjectStore("cola", { keyPath: "id" });
        if (!d.objectStoreNames.contains("fotos")) d.createObjectStore("fotos");
      };
      q.onsuccess = function () { res(q.result); };
      q.onerror = function () { dbp = null; rej(q.error); };
    });
    return dbp;
  }
  function req(r) { return new Promise(function (res, rej) { r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }
  function store(name, mode) { return open().then(function (d) { return d.transaction(name, mode || "readonly").objectStore(name); }); }
  function get(name, key) { return store(name).then(function (s) { return req(s.get(key)); }); }
  function put(name, val, key) { return store(name, "readwrite").then(function (s) { return req(key === undefined ? s.put(val) : s.put(val, key)); }); }
  function del(name, key) { return store(name, "readwrite").then(function (s) { return req(s.delete(key)); }); }
  function all(name) { return store(name).then(function (s) { return req(s.getAll()); }); }
  function keys(name) { return store(name).then(function (s) { return req(s.getAllKeys()); }); }

  function err(msg, red) { var e = new Error(msg); e.red = !!red; return e; }
  function api(accion) {
    var args = Array.prototype.slice.call(arguments, 1);
    var url = g.BITACORA_API;
    if (!url || url.indexOf("script.google.com") < 0) return Promise.reject(err("Falta configurar la dirección del servidor en el archivo config.js.", true));
    return fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ accion: accion, args: args }), redirect: "follow" })
      .catch(function () { throw err("Sin conexión con el servidor.", true); })
      .then(function (r) {
        if (!r.ok) throw err("El servidor respondió con error " + r.status + ".", true);
        return r.json().catch(function () { throw err("Respuesta no válida del servidor. Revise que la implementación tenga acceso para \"Cualquier persona\".", true); });
      })
      .then(function (j) {
        if (!j.ok) throw err(j.error, /ya se está enviando/i.test(j.error || ""));
        return j.data;
      });
  }

  var enviando = null;
  /** Envía los reportes en cola, del más antiguo al más nuevo. onEach(item, respuesta) tras cada éxito. */
  function enviarCola(onEach) {
    if (enviando) return enviando;
    enviando = (async function () {
      var n = 0, items = (await all("cola")).sort(function (a, b) { return a.creadoLocal - b.creadoLocal; });
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        try {
          var res = await api("guardarReporte", it.doc, it.fotos);
          await put("fotos", { t: Date.now(), b64: it.fotos }, it.id);
          await del("cola", it.id);
          n++;
          if (onEach) await onEach(it, res);
        } catch (e) {
          if (e.red) break;
          it.error = e.message; it.intentos = (it.intentos || 0) + 1;
          await put("cola", it);
        }
      }
      return { enviados: n, pendientes: (await keys("cola")).length };
    })();
    enviando.finally(function () { enviando = null; });
    return enviando;
  }

  /** Borra fotos locales de reportes ya enviados con más de 15 días. */
  function limpiarFotos() {
    var lim = Date.now() - 15 * 864e5;
    return all("fotos").then(function () { return keys("fotos"); }).then(function (ks) {
      return Promise.all(ks.map(function (k) { return get("fotos", k).then(function (v) { if (v && v.t < lim) return del("fotos", k); }); }));
    });
  }

  g.BitacoraCola = { get: get, put: put, del: del, all: all, keys: keys, api: api, enviarCola: enviarCola, limpiarFotos: limpiarFotos };
})(self);
