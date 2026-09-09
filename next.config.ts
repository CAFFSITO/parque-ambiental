import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
