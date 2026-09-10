// lib/db.ts
// Cliente de Supabase con service role key. SOLO servidor: nunca importar
// este módulo desde un componente marcado con "use client".
// No se usa Supabase Auth ni RLS; el control de acceso lo hace la app.

import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Empleado } from "./tipos";

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

/** Columnas de la ficha de empleado anteriores a sql/04_multiseleccion.sql. */
const COLUMNAS_EMPLEADO_PREVIAS =
  "id, legajo, nombre, apellido, dni, fecha_nacimiento, telefono, email, domicilio, area_id, tarea, turno, fecha_ingreso, estado, observaciones, creado_en";

/**
 * Columnas de la ficha de empleado. Está acá para que las páginas que la leen
 * (Empleados y Usuarios) no queden desincronizadas cuando se agrega un campo.
 */
export const COLUMNAS_EMPLEADO = `${COLUMNAS_EMPLEADO_PREVIAS}, areas_ids, tareas, turnos`;

/** Postgres: columna inexistente. PostgREST: columna fuera del schema cache. */
export const COLUMNA_INEXISTENTE = "42703";
export const COLUMNA_SIN_CACHE = "PGRST204";

type EmpleadoPrevio = Omit<Empleado, "areas_ids" | "tareas" | "turnos">;

/**
 * Lee la nómina completa. Si todavía no se corrió sql/04_multiseleccion.sql,
 * las columnas de arreglo no existen: en ese caso se relee con el esquema
 * anterior y se arma cada arreglo con el valor único, así el panel sigue
 * funcionando y la migración se puede correr cuando convenga.
 */
export async function leerEmpleados(): Promise<Empleado[]> {
  const ordenada = (columnas: string) =>
    db()
      .from("empleados")
      .select(columnas)
      .order("apellido", { ascending: true })
      .order("nombre", { ascending: true });

  const conArreglos = await ordenada(COLUMNAS_EMPLEADO).overrideTypes<
    Empleado[],
    { merge: false }
  >();

  if (!conArreglos.error) return conArreglos.data ?? [];
  if (conArreglos.error.code !== COLUMNA_INEXISTENTE) return [];

  const previa = await ordenada(COLUMNAS_EMPLEADO_PREVIAS).overrideTypes<
    EmpleadoPrevio[],
    { merge: false }
  >();

  return (previa.data ?? []).map((fila) => ({
    ...fila,
    areas_ids: fila.area_id === null ? [] : [fila.area_id],
    tareas: fila.tarea ? [fila.tarea] : [],
    turnos: fila.turno ? [fila.turno] : [],
  }));
}
