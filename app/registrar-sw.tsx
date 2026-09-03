"use client";

import { useEffect } from "react";

// Registra el service worker después del primer render. No bloquea nada: si
// el navegador no lo soporta o el registro falla, la app sigue funcionando
// igual, solo que sin el banner de instalación.
export default function RegistrarSW() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    try {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    } catch {
      // Sin conexión, contexto no seguro o permisos denegados: se ignora.
    }
  }, []);

  return null;
}
