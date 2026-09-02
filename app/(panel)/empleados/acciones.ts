"use server";

// app/(panel)/empleados/acciones.ts

import { revalidatePath } from "next/cache";
import { exigirAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  esEstadoEmpleado,
  esTurno,
  TAREAS,
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
  area_id: number | null;
  tarea: string;
  turno: string;
  fecha_ingreso: string;
  estado: string;
  observaciones: string;
};

const LEGAJO_DUPLICADO = "23505";

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

  const areaId = crudo?.area_id;

  return {
    legajo: texto("legajo"),
    nombre: texto("nombre"),
    apellido: texto("apellido"),
    dni: texto("dni"),
    fecha_nacimiento: texto("fecha_nacimiento"),
    telefono: texto("telefono"),
    email: texto("email"),
    domicilio: texto("domicilio"),
    area_id: typeof areaId === "number" ? areaId : null,
    tarea: texto("tarea"),
    turno: texto("turno"),
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

  if (entrada.tarea.trim() !== "" && !TAREAS.includes(entrada.tarea)) {
    return "La tarea no pertenece al catálogo.";
  }
  if (entrada.turno.trim() !== "" && !esTurno(entrada.turno)) {
    return "El turno tiene que ser M, T o N.";
  }
  if (!esEstadoEmpleado(entrada.estado)) {
    return "El estado tiene que ser activo, licencia o baja.";
  }

  return null;
}

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
    area_id: entrada.area_id,
    tarea: oNulo(entrada.tarea),
    turno: oNulo(entrada.turno),
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
