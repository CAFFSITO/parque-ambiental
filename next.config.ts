import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // web-push arma la firma VAPID con los módulos de crypto de Node y hace
  // requires dinámicos: empaquetado se rompe en tiempo de ejecución, y el
  // fallo queda enterrado dentro del after() que manda el aviso.
  serverExternalPackages: ["web-push"],

  experimental: {
    // Habilita forbidden() y app/forbidden.tsx, que devuelven un 403 real.
    authInterrupts: true,
  },

  async headers() {
    return [
      {
        // El service worker no se cachea: es el que recibe los avisos push, y
        // si el navegador se queda con una copia vieja los avisos nuevos no
        // llegan hasta que caduque.
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
