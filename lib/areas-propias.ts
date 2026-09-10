// lib/areas-propias.ts
// Las áreas de las que está a cargo quien inició sesión. Solo servidor.
//
// Un empleado puede estar a cargo de VARIAS áreas: eso vive en
// empleados.areas_ids (ver sql/04_multiseleccion.sql). El JWT de sesión, en
// cambio, guarda un solo area_id —el principal— porque se firma al entrar y
// no se puede refrescar si la ficha cambia a mitad del turno.
//
// Por eso las áreas se leen de la base en cada pantalla que las necesita: si
// el administrador le suma un área a alguien, se ve en la próxima recarga y
// no en el próximo login.
//
// Ya no son un candado: un empleado ve, crea y atiende llamados de cualquier
// área. Se usan para ordenar —lo suyo primero— y para marcar esas filas.

import { db } from "./db";
import { COLUMNA_INEXISTENTE } from "./db";
import type { Sesion } from "./tipos";

type FilaUsuario = { area_id: number | null; empleado_id: number | null };
type FilaEmpleado = { area_id: number | null; areas_ids: number[] | null };

/**
 * Devuelve los ids de área a cargo, sin repetidos. Vacío es una respuesta
 * válida: un administrador sin ficha de empleado no tiene área propia y ve
 * todo con el mismo peso.
 */
export async function areasDelUsuario(sesion: Sesion): Promise<number[]> {
  const propias = new Set<number>();
  if (sesion.area_id !== null) propias.add(sesion.area_id);

  const { data: usuario } = await db()
    .from("usuarios")
    .select("area_id, empleado_id")
    .eq("id", sesion.id)
    .maybeSingle()
    .overrideTypes<FilaUsuario, { merge: false }>();

  if (!usuario) return [...propias];
  if (usuario.area_id !== null) propias.add(usuario.area_id);
  if (usuario.empleado_id === null) return [...propias];

  const { data: empleado, error } = await db()
    .from("empleados")
    .select("area_id, areas_ids")
    .eq("id", usuario.empleado_id)
    .maybeSingle()
    .overrideTypes<FilaEmpleado, { merge: false }>();

  // Sin sql/04_multiseleccion.sql corrido, areas_ids no existe: se cae al
  // área única, que es la que había antes.
  if (error?.code === COLUMNA_INEXISTENTE) {
    const { data: previo } = await db()
      .from("empleados")
      .select("area_id")
      .eq("id", usuario.empleado_id)
      .maybeSingle()
      .overrideTypes<{ area_id: number | null }, { merge: false }>();

    if (previo?.area_id != null) propias.add(previo.area_id);
    return [...propias];
  }

  if (empleado) {
    if (empleado.area_id !== null) propias.add(empleado.area_id);
    for (const id of empleado.areas_ids ?? []) propias.add(id);
  }

  return [...propias];
}

/**
 * Sube al principio lo que pertenece a las áreas propias, sin alterar el
 * orden dentro de cada grupo: los llamados siguen viniendo del más nuevo al
 * más viejo, y las emergencias primero donde así se pidió.
 *
 * Es un orden estable hecho a mano y no un sort: sort() en Node es estable,
 * pero dejarlo explícito evita que un cambio de criterio mezcle las fechas.
 */
export function propiasPrimero<T extends { area_id: number | null }>(
  filas: T[],
  propias: number[],
): T[] {
  if (propias.length === 0) return filas;

  const mias = new Set(propias);
  const arriba: T[] = [];
  const abajo: T[] = [];

  for (const fila of filas) {
    if (fila.area_id !== null && mias.has(fila.area_id)) arriba.push(fila);
    else abajo.push(fila);
  }

  return [...arriba, ...abajo];
}

/** Igual que propiasPrimero pero para las áreas mismas, que se ordenan por id. */
export function areasPropiasPrimero<T extends { id: number }>(
  filas: T[],
  propias: number[],
): T[] {
  if (propias.length === 0) return filas;

  const mias = new Set(propias);
  const arriba: T[] = [];
  const abajo: T[] = [];

  for (const fila of filas) {
    if (mias.has(fila.id)) arriba.push(fila);
    else abajo.push(fila);
  }

  return [...arriba, ...abajo];
}
