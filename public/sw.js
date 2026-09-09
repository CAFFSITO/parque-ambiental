// Service worker del panel.
//
// No cachea nada a propósito: el sistema muestra llamados y lecturas que
// cambian todo el tiempo. Está para dos cosas: que la app sea instalable y
// que pueda recibir avisos push aunque esté cerrada.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});

// El servidor manda { titulo, cuerpo, tipo, url } (ver lib/push.ts). Si el
// mensaje viniera vacío o ilegible igual hay que mostrar algo: el navegador
// revoca el permiso de push a los sitios que reciben y no notifican.
self.addEventListener("push", (event) => {
  let aviso = {};

  try {
    aviso = event.data ? event.data.json() : {};
  } catch {
    aviso = {};
  }

  const emergencia = aviso.tipo === "EMERGENCIA";
  const titulo = aviso.titulo || "Parque Ambiental";

  event.waitUntil(
    self.registration.showNotification(titulo, {
      body: aviso.cuerpo || "Hay un llamado nuevo.",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      // Las emergencias suenan y quedan hasta que alguien las toca; un
      // llamado normal no interrumpe.
      requireInteraction: emergencia,
      silent: !emergencia,
      vibrate: emergencia ? [120, 60, 120, 60, 240] : [80],
      // Un tag por tipo: dos llamados seguidos se apilan en un solo aviso en
      // vez de tapar la pantalla.
      tag: emergencia ? "pab-emergencia" : "pab-llamado",
      renotify: true,
      data: { url: aviso.url || "/llamados" },
    }),
  );
});

// Al tocar el aviso: si ya hay una pestaña del panel abierta se la trae al
// frente en vez de abrir otra.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destino = new URL(
    (event.notification.data && event.notification.data.url) || "/llamados",
    self.location.origin,
  ).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((ventanas) => {
        for (const ventana of ventanas) {
          if (ventana.url === destino && "focus" in ventana) {
            return ventana.focus();
          }
        }
        for (const ventana of ventanas) {
          if ("navigate" in ventana) {
            return ventana.navigate(destino).then((v) => v && v.focus());
          }
        }
        return self.clients.openWindow(destino);
      }),
  );
});
