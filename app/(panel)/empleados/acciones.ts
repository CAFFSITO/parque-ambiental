"use server";

// app/(panel)/empleados/acciones.ts

import { revalidatePath } from "next/cache";
import { exigirAdmin } from "@/lib/auth";
import { COLUMNA_INEXISTENTE, COLUMNA_SIN_CACHE, db } from "@/lib/db";
import {
  esEstadoEmpleado,
  LARGO_MAXIMO_OPCION,
  normalizarOpcion,
  type EstadoEmpleado,
} from "@/lib/catalogos";
import type { Resultado } from "@/lib/tipos";

export type EntradaEmpleado = {
  legajo: string;
  nombre: string;
  apellido: string;
  dni: string;
  fecha_nacimiento: string;
  telefono: string;
  email: string;
  domicilio: string;
  areas_ids: number[];
  tareas: string[];
  turnos: string[];
  fecha_ingreso: string;
  estado: string;
  observaciones: string;
};

/** Tope defensivo: la ficha no es una bolsa infinita de etiquetas. */
const MAXIMO_SELECCIONES = 12;

const LEGAJO_DUPLICADO = "23505";

const FALTA_MIGRACION =
  "La base todavía no tiene las columnas de selección múltiple. Corré sql/04_multiseleccion.sql en el SQL Editor de Supabase y volvé a guardar.";

/** True si la base sigue con el esquema anterior a sql/04_multiseleccion.sql. */
function faltaMigracion(codigo: string | undefined): boolean {
  return codigo === COLUMNA_SIN_CACHE || codigo === COLUMNA_INEXISTENTE;
}

function refrescar(): void {
  revalidatePath("/empleados");
  revalidatePath("/areas");
  revalidatePath("/usuarios");
}

/** Los campos de texto opcionales vacíos van como null, no como "". */
function oNulo(valor: string): string | null {
  const limpio = valor.trim();
  return limpio === "" ? null : limpio;
}

/**
 * Una Server Action es un endpoint HTTP: el cuerpo puede venir con cualquier
 * forma. Antes de tocar un campo, normalizamos todo a los tipos esperados.
 */
function sanear(entrada: EntradaEmpleado): EntradaEmpleado {
  const crudo = entrada as unknown as Record<string, unknown>;

  const texto = (clave: string): string =>
    typeof crudo?.[clave] === "string" ? (crudo[clave] as string) : "";

  /** Ids de área: solo enteros positivos, sin repetir y acotados. */
  const ids = (clave: string): number[] => {
    const bruto = Array.isArray(crudo?.[clave]) ? (crudo[clave] as unknown[]) : [];
    const limpios = bruto
      .map((valor) => Number(valor))
      .filter((valor) => Number.isInteger(valor) && valor > 0);
    return [...new Set(limpios)].slice(0, MAXIMO_SELECCIONES);
  };

  /** Etiquetas escritas a mano: normalizadas, sin vacías y sin repetir. */
  const etiquetas = (clave: string): string[] => {
    const bruto = Array.isArray(crudo?.[clave]) ? (crudo[clave] as unknown[]) : [];
    const limpias = bruto
      .filter((valor): valor is string => typeof valor === "string")
      .map(normalizarOpcion)
      .filter((valor) => valor !== "");
    return [...new Set(limpias)].slice(0, MAXIMO_SELECCIONES);
  };

  return {
    legajo: texto("legajo"),
    nombre: texto("nombre"),
    apellido: texto("apellido"),
    dni: texto("dni"),
    fecha_nacimiento: texto("fecha_nacimiento"),
    telefono: texto("telefono"),
    email: texto("email"),
    domicilio: texto("domicilio"),
    areas_ids: ids("areas_ids"),
    tareas: etiquetas("tareas"),
    turnos: etiquetas("turnos"),
    fecha_ingreso: texto("fecha_ingreso"),
    estado: texto("estado"),
    observaciones: texto("observaciones"),
  };
}

function validar(entrada: EntradaEmpleado): string | null {
  if (!entrada.legajo.trim()) return "El legajo es obligatorio.";
  if (!entrada.nombre.trim()) return "El nombre es obligatorio.";
  if (!entrada.apellido.trim()) return "El apellido es obligatorio.";

  const dni = entrada.dni.trim();
  if (!/^\d{7,8}$/.test(dni)) {
    return "El DNI tiene que tener 7 u 8 dígitos, sin puntos.";
  }

  const email = entrada.email.trim();
  if (email !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "El email no tiene un formato válido.";
  }

  // Tareas y turnos son catálogos abiertos: se pueden crear escribiéndolos.
  // Lo único que se exige es que cada etiqueta entre en el largo permitido.
  const largas = [...entrada.tareas, ...entrada.turnos].some(
    (valor) => valor.length > LARGO_MAXIMO_OPCION,
  );
  if (largas) {
    return `Cada tarea o turno puede tener hasta ${LARGO_MAXIMO_OPCION} caracteres.`;
  }

  if (!esEstadoEmpleado(entrada.estado)) {
    return "El estado tiene que ser activo, licencia o baja.";
  }

  return null;
}

/**
 * Además de los arreglos se sigue escribiendo la columna de un solo valor con
 * el primero de cada selección. De eso viven el tablero, el filtro de llamados
 * por área y el área que hereda el usuario del empleado: mientras exista un
 * valor principal, nada de eso se entera del cambio.
 */
function aFila(entrada: EntradaEmpleado) {
  return {
    legajo: entrada.legajo.trim().toUpperCase(),
    nombre: entrada.nombre.trim(),
    apellido: entrada.apellido.trim(),
    dni: entrada.dni.trim(),
    fecha_nacimiento: oNulo(entrada.fecha_nacimiento),
    telefono: oNulo(entrada.telefono),
    email: oNulo(entrada.email),
    domicilio: oNulo(entrada.domicilio),
    areas_ids: entrada.areas_ids,
    tareas: entrada.tareas,
    turnos: entrada.turnos,
    area_id: entrada.areas_ids[0] ?? null,
    tarea: entrada.tareas[0] ?? null,
    turno: entrada.turnos[0] ?? null,
    fecha_ingreso: oNulo(entrada.fecha_ingreso),
    estado: entrada.estado,
    observaciones: oNulo(entrada.observaciones),
  };
}

export async function crearEmpleado(
  entrada: EntradaEmpleado,
): Promise<Resultado> {
  await exigirAdmin();

  const limpia = sanear(entrada);
  const problema = validar(limpia);
  if (problema) return { ok: false, error: problema };

  const { error } = await db().from("empleados").insert(aFila(limpia));

  if (error) {
    if (faltaMigracion(error.code)) {
      return { ok: false, error: FALTA_MIGRACION };
    }
    if (error.code === LEGAJO_DUPLICADO) {
      return { ok: false, error: "Ya existe un empleado con ese legajo." };
    }
    return {
      ok: false,
      error: `No se pudo crear el empleado: ${error.message}`,
    };
  }

  refrescar();
  return { ok: true, mensaje: "Empleado dado de alta." };
}

export async function actualizarEmpleado(
  id: number,
  entrada: EntradaEmpleado,
): Promise<Resultado> {
  await exigirAdmin();

  const limpia = sanear(entrada);
  const problema = validar(limpia);
  if (problema) return { ok: false, error: problema };

  const { error } = await db()
    .from("empleados")
    .update(aFila(limpia))
    .eq("id", id);

  if (error) {
    if (faltaMigracion(error.code)) {
      return { ok: false, error: FALTA_MIGRACION };
    }
    if (error.code === LEGAJO_DUPLICADO) {
      return { ok: false, error: "Ya existe otro empleado con ese legajo." };
    }
    return {
      ok: false,
      error: `No se pudo actualizar el empleado: ${error.message}`,
    };
  }

  refrescar();
  return { ok: true, mensaje: "Ficha actualizada." };
}

/**
 * Baja lógica: el empleado pasa a estado 'baja'. La fila no se borra nunca,
 * porque los llamados históricos referencian su legajo.
 */
export async function cambiarEstadoEmpleado(
  id: number,
  estado: EstadoEmpleado,
): Promise<Resultado> {
  await exigirAdmin();

  if (!esEstadoEmpleado(estado)) {
    return { ok: false, error: "Estado inválido." };
  }

  const { error } = await db().from("empleados").update({ estado }).eq("id", id);

  if (error) {
    return {
      ok: false,
      error: `No se pudo cambiar el estado: ${error.message}`,
    };
  }

  refrescar();
  return {
    ok: true,
    mensaje:
      estado === "baja"
        ? "Empleado dado de baja."
        : `Empleado marcado como ${estado}.`,
  };
}
