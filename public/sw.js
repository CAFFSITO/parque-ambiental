// Service worker mínimo a propósito.
//
// El sistema muestra llamados y lecturas que cambian todo el tiempo: no se
// cachea ninguna respuesta. El único propósito de este archivo es que el
// navegador considere la app instalable.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
