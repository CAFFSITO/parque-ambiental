"use server";

// app/(panel)/areas/acciones.ts
// Toda acción arranca con exigirAdmin(): la verificación es del servidor.
//
// Esta pantalla configura DOS cosas que no hay que confundir:
//
//   * Los UMBRALES (temp_min, temp_max, hum_min, hum_max) definen la
//     normalidad. Salirse de ellos genera un llamado, siempre, sin excepción.
//   * La AUTOMATIZACIÓN (auto_temp_baja, auto_temp_alta, auto_hum_baja,
//     auto_hum_alta) decide cuál de esos cuatro desvíos, además, enciende el
//     actuador del nodo.
//
// Desmarcar una casilla apaga una bomba, nunca apaga una alarma. Ver
// lib/automatizacion.ts y documents/contexto/50-alertas-vs-automatizacion.md.
//
// POR QUÉ NO HAY ACÁ UNA ACCIÓN DE ASIGNAR DISPOSITIVOS
// La ficha del área permite asignar y desasignar nodos, pero esa operación NO
// se implementa en este archivo: usa cambiarAreaDispositivo(), la misma Server
// Action que la pantalla de Dispositivos.
//
// Es una decisión, no un olvido. La cardinalidad —un dispositivo tiene un área
// vigente, y asignarlo a otra lo reasigna en vez de duplicarlo— está sostenida
// por una sola columna escalar, dispositivos.area_id. Una segunda acción que
// escribiera esa misma columna sería una segunda copia de la regla: dos lugares
// donde validar el id, dos lugares donde decidir qué significa null, y dos
// lugares que alguien va a tocar por separado. Con una sola acción, asignar
// desde Áreas y asignar desde Dispositivos son literalmente la misma escritura.

import { revalidatePath } from "next/cache";
import { exigirAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { eliminarArea as borrarArea } from "@/lib/borrado";
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
  // Automatización del actuador. Ver sql/07_automatizacion_areas.sql.
  auto_temp_baja: boolean;
  auto_temp_alta: boolean;
  auto_hum_baja: boolean;
  auto_hum_alta: boolean;
};

const CODIGO_DUPLICADO = "23505";

/** Las cuatro columnas de automatización, en el orden del formulario. */
const CAMPOS_AUTOMATIZACION = [
  "auto_temp_baja",
  "auto_temp_alta",
  "auto_hum_baja",
  "auto_hum_alta",
] as const;

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

  // Los interruptores de automatización se saneen al revés que 'activa': lo
  // que no venga explícitamente en true queda apagado. Un área nueva que
  // llegue por HTTP sin estos campos no debería accionar nada por su cuenta:
  // encender un actuador tiene que ser una decisión escrita, no un default.
  const interruptor = (clave: string): boolean => crudo?.[clave] === true;

  return {
    codigo: texto("codigo"),
    nombre: texto("nombre"),
    tipo: normalizarOpcion(texto("tipo")),
    temp_min: numeroCampo("temp_min"),
    temp_max: numeroCampo("temp_max"),
    hum_min: numeroCampo("hum_min"),
    hum_max: numeroCampo("hum_max"),
    activa: crudo?.activa !== false,
    auto_temp_baja: interruptor("auto_temp_baja"),
    auto_temp_alta: interruptor("auto_temp_alta"),
    auto_hum_baja: interruptor("auto_hum_baja"),
    auto_hum_alta: interruptor("auto_hum_alta"),
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

  // Después de sanear() los cuatro son booleanos por construcción. Se verifica
  // igual, para que si alguien cambia sanear() y rompe esa garantía, falle acá
  // y no escribiendo un null en una columna not null.
  if (
    CAMPOS_AUTOMATIZACION.some((campo) => typeof entrada[campo] !== "boolean")
  ) {
    return "La automatización tiene que ser sí o no en las cuatro condiciones.";
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
    auto_temp_baja: entrada.auto_temp_baja,
    auto_temp_alta: entrada.auto_temp_alta,
    auto_hum_baja: entrada.auto_hum_baja,
    auto_hum_alta: entrada.auto_hum_alta,
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
  return {
    ok: true,
    mensaje: "Área actualizada. Los umbrales y la automatización ya rigen.",
  };
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

/**
 * BORRADO DEFINITIVO del área. No es lo mismo que darla de baja.
 *
 *   * Dar de baja (cambiarActivaArea) dice "esta área ya no opera". Toda su
 *     historia queda y se puede reactivar.
 *   * Borrar dice "esta área nunca tuvo que existir". Es para el área creada
 *     con el código mal escrito o duplicada por error. NO se puede deshacer.
 *
 * Por eso solo procede si al área no le cuelga NADA: ni lecturas, ni llamados,
 * ni dispositivos, ni empleados, ni usuarios. Un área con historia se da de
 * baja; la historia no se tira.
 *
 * La regla y el recuento viven en lib/borrado.ts, que vuelve a contar antes de
 * borrar: el conteo que dibujó el botón puede tener minutos, y en el medio
 * alguien pudo asignarle un dispositivo.
 */
export async function eliminarAreaVacia(id: number): Promise<Resultado> {
  await exigirAdmin();

  if (typeof id !== "number" || !Number.isInteger(id)) {
    return { ok: false, error: "Identificador inválido." };
  }

  const resultado = await borrarArea(id);
  if (!resultado.ok) return { ok: false, error: resultado.error };

  refrescar();
  // Empleados y Usuarios muestran el área de cada ficha.
  revalidatePath("/empleados");
  revalidatePath("/usuarios");

  return { ok: true, mensaje: "Área eliminada." };
}
