import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Habilita forbidden() y app/forbidden.tsx, que devuelven un 403 real.
    authInterrupts: true,
  },
};

export default nextConfig;
