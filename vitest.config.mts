import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// vitest.config.ts
// Corre solo los tests unitarios de lib/. No levanta la app ni toca Supabase:
// las funciones que se prueban acá son las decisiones puras, que reciben filas
// ya leídas y devuelven el resultado. Lo que habla con la base se prueba contra
// una base de verdad, no con un cliente simulado que solo confirmaría que el
// simulacro coincide consigo mismo.

const raiz = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    // Mismo alias que tsconfig.json, para que los imports "@/lib/..." resuelvan.
    alias: {
      "@": raiz,
      // Los tests corren en Node; Next aplica su propio límite al compilar.
      "server-only": `${raiz}node_modules/next/dist/compiled/server-only/empty.js`,
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
