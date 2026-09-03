"use server";

// app/(panel)/areas/acciones.ts
// Toda acción arranca con exigirAdmin(): la verificación es del servidor.

import { revalidatePath } from "next/cache";
import { exigirAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { LARGO_MAXIMO_OPCION, normalizarOpcion } from "@/lib/catalogos";
import type { Resultado } from "@/lib/tipos";

export type EntradaArea = {
  codigo: string;
  nombre: string;
  tipo: string;
  temp_min: number;
  temp_max: number;
  hum_min: number;
  hum_max: number;
  activa: boolean;
};

const CODIGO_DUPLICADO = "23505";

function refrescar(): void {
  revalidatePath("/areas");
  // El tablero evalúa las alertas contra estos umbrales.
  revalidatePath("/");
}

/**
 * Una Server Action es un endpoint HTTP: el cuerpo puede venir con cualquier
 * forma. Antes de tocar un campo, normalizamos todo a los tipos esperados.
 */
function sanear(entrada: EntradaArea): EntradaArea {
  const crudo = entrada as unknown as Record<string, unknown>;

  const texto = (clave: string): string =>
    typeof crudo?.[clave] === "string" ? (crudo[clave] as string) : "";

  const numeroCampo = (clave: string): number =>
    typeof crudo?.[clave] === "number" ? (crudo[clave] as number) : Number.NaN;

  return {
    codigo: texto("codigo"),
    nombre: texto("nombre"),
    tipo: normalizarOpcion(texto("tipo")),
    temp_min: numeroCampo("temp_min"),
    temp_max: numeroCampo("temp_max"),
    hum_min: numeroCampo("hum_min"),
    hum_max: numeroCampo("hum_max"),
    activa: crudo?.activa !== false,
  };
}

function validar(entrada: EntradaArea): string | null {
  if (!entrada.codigo.trim()) return "El código es obligatorio.";
  if (entrada.codigo.trim().length > 12)
    return "El código no puede tener más de 12 caracteres.";
  if (!entrada.nombre.trim()) return "El nombre es obligatorio.";

  // El tipo es un catálogo abierto: se elige entre los ya creados o se crea uno
  // nuevo escribiéndolo. Solo se controla que exista y que entre en el campo.
  if (entrada.tipo === "") return "El tipo de área es obligatorio.";
  if (entrada.tipo.length > LARGO_MAXIMO_OPCION) {
    return `El tipo de área puede tener hasta ${LARGO_MAXIMO_OPCION} caracteres.`;
  }

  const numeros = [
    entrada.temp_min,
    entrada.temp_max,
    entrada.hum_min,
    entrada.hum_max,
  ];
  if (numeros.some((valor) => !Number.isFinite(valor))) {
    return "Los umbrales tienen que ser números.";
  }

  if (entrada.temp_min >= entrada.temp_max) {
    return "La temperatura mínima tiene que ser menor que la máxima.";
  }
  if (entrada.hum_min >= entrada.hum_max) {
    return "La humedad mínima tiene que ser menor que la máxima.";
  }
  if (entrada.hum_min < 0 || entrada.hum_max > 100) {
    return "La humedad tiene que estar entre 0 y 100.";
  }
  if (entrada.temp_min < -50 || entrada.temp_max > 100) {
    return "La temperatura tiene que estar entre -50 y 100 °C.";
  }

  return null;
}

function aFila(entrada: EntradaArea) {
  return {
    codigo: entrada.codigo.trim().toUpperCase(),
    nombre: entrada.nombre.trim(),
    tipo: entrada.tipo,
    temp_min: entrada.temp_min,
    temp_max: entrada.temp_max,
    hum_min: entrada.hum_min,
    hum_max: entrada.hum_max,
    activa: entrada.activa,
  };
}

export async function crearArea(entrada: EntradaArea): Promise<Resultado> {
  await exigirAdmin();

  const limpia = sanear(entrada);
  const problema = validar(limpia);
  if (problema) return { ok: false, error: problema };

  const { error } = await db().from("areas").insert(aFila(limpia));

  if (error) {
    if (error.code === CODIGO_DUPLICADO) {
      return { ok: false, error: "Ya existe un área con ese código." };
    }
    return { ok: false, error: `No se pudo crear el área: ${error.message}` };
  }

  refrescar();
  return { ok: true, mensaje: "Área creada." };
}

export async function actualizarArea(
  id: number,
  entrada: EntradaArea,
): Promise<Resultado> {
  await exigirAdmin();

  const limpia = sanear(entrada);
  const problema = validar(limpia);
  if (problema) return { ok: false, error: problema };

  const { error } = await db().from("areas").update(aFila(limpia)).eq("id", id);

  if (error) {
    if (error.code === CODIGO_DUPLICADO) {
      return { ok: false, error: "Ya existe otra área con ese código." };
    }
    return {
      ok: false,
      error: `No se pudo actualizar el área: ${error.message}`,
    };
  }

  refrescar();
  return { ok: true, mensaje: "Área actualizada. Los umbrales ya rigen." };
}

/** Baja lógica: el área queda con activa = false, nunca se borra la fila. */
export async function cambiarActivaArea(
  id: number,
  activa: boolean,
): Promise<Resultado> {
  await exigirAdmin();

  const { error } = await db().from("areas").update({ activa }).eq("id", id);

  if (error) {
    return {
      ok: false,
      error: `No se pudo cambiar el estado del área: ${error.message}`,
    };
  }

  refrescar();
  return {
    ok: true,
    mensaje: activa ? "Área reactivada." : "Área dada de baja.",
  };
}
