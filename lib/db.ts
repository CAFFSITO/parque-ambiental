// lib/db.ts
// Cliente de Supabase con service role key. SOLO servidor: nunca importar
// este módulo desde un componente marcado con "use client".
// No se usa Supabase Auth ni RLS; el control de acceso lo hace la app.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cliente: SupabaseClient | null = null;

function requerido(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) {
    throw new Error(
      `Falta la variable de entorno ${nombre}. Cargala en .env.local y en Vercel.`,
    );
  }
  return valor;
}

/**
 * createClient espera la URL del proyecto (https://xxxx.supabase.co) y le
 * agrega /rest/v1 por su cuenta. Si la variable de entorno ya trae ese sufijo
 * las peticiones terminan en /rest/v1/rest/v1/... y Supabase responde
 * PGRST125 "Invalid path specified in request URL". Lo recortamos acá.
 */
function urlDelProyecto(): string {
  return requerido("SUPABASE_URL")
    .trim()
    .replace(/\/rest\/v1\/?$/, "")
    .replace(/\/+$/, "");
}

/**
 * Devuelve el cliente de Supabase (singleton perezoso). Se crea en el primer
 * uso para que la ausencia de variables de entorno falle en la petición y no
 * durante el build.
 */
export function db(): SupabaseClient {
  if (!cliente) {
    cliente = createClient(
      urlDelProyecto(),
      requerido("SUPABASE_SERVICE_KEY"),
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    );
  }
  return cliente;
}
