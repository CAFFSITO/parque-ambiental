"use server";

// app/(panel)/llamados/acciones.ts
//
// El área no restringe: cualquiera con sesión puede crear y atender llamados
// de cualquier área. El parque se recorre entero y quien ve un problema lo
// reporta donde lo ve, sin importar de qué sector esté a cargo.
//
// Las áreas a cargo (empleados.areas_ids, que pueden ser varias) se usan solo
// para ordenar las pantallas: lo propio arriba. Ver lib/areas-propias.ts.

import { revalidatePath } from "next/cache";
import { exigirSesion } from "@/lib/auth";
import { db } from "@/lib/db";
import { agregarMotivo, leerMotivos, type MotivosPorTipo } from "@/lib/motivos";
import { avisarNuevoLlamado } from "@/lib/avisos";
import type { Resultado, TipoLlamado } from "@/lib/tipos";

export type EntradaLlamado = {
  area_id: number | null;
  tipo: string;
  motivo: string;
  detalle: string;
};

function refrescar(): void {
  revalidatePath("/llamados");
  revalidatePath("/");
}

function esTipo(valor: string): valor is TipoLlamado {
  return valor === "NORMAL" || valor === "EMERGENCIA";
}

export async function atenderLlamado(id: number): Promise<Resultado> {
  const sesion = await exigirSesion();

  if (typeof id !== "number" || !Number.isInteger(id)) {
    return { ok: false, error: "Identificador de llamado inválido." };
  }

  const { data: llamado, error: errorLectura } = await db()
    .from("llamados")
    .select("id, area_id, estado")
    .eq("id", id)
    .maybeSingle()
    .overrideTypes<
      { id: number; area_id: number | null; estado: string },
      { merge: false }
    >();

  if (errorLectura || !llamado) {
    return { ok: false, error: "El llamado no existe." };
  }

  if (llamado.estado === "ATENDIDO") {
    return { ok: false, error: "Ese llamado ya estaba atendido." };
  }

  const { error } = await db()
    .from("llamados")
    .update({
      estado: "ATENDIDO",
      atendido_por: sesion.usuario,
      atendido_en: new Date().toISOString(),
    })
    .eq("id", id)
    // Si otro operador lo atendió mientras tanto, este update no toca nada.
    .eq("estado", "NO_ATENDIDO");

  if (error) {
    return { ok: false, error: `No se pudo atender: ${error.message}` };
  }

  refrescar();
  return { ok: true, mensaje: `Llamado #${id} atendido.` };
}

/**
 * Deshace un "atendido" puesto por error: el llamado vuelve a NO_ATENDIDO y
 * pierde la firma de quien lo había atendido. Rige el mismo candado de área
 * que para atenderlo.
 */
export async function cancelarAtencion(id: number): Promise<Resultado> {
  // Sigue exigiendo sesión: lo que ya no exige es que el llamado sea del
  // área de quien lo deshace.
  await exigirSesion();

  if (typeof id !== "number" || !Number.isInteger(id)) {
    return { ok: false, error: "Identificador de llamado inválido." };
  }

  const { data: llamado, error: errorLectura } = await db()
    .from("llamados")
    .select("id, area_id, estado")
    .eq("id", id)
    .maybeSingle()
    .overrideTypes<
      { id: number; area_id: number | null; estado: string },
      { merge: false }
    >();

  if (errorLectura || !llamado) {
    return { ok: false, error: "El llamado no existe." };
  }

  if (llamado.estado !== "ATENDIDO") {
    return { ok: false, error: "Ese llamado no está atendido." };
  }

  const { error } = await db()
    .from("llamados")
    .update({
      estado: "NO_ATENDIDO",
      atendido_por: null,
      atendido_en: null,
    })
    .eq("id", id)
    // Si alguien más ya lo reabrió, este update no toca nada.
    .eq("estado", "ATENDIDO");

  if (error) {
    return { ok: false, error: `No se pudo cancelar: ${error.message}` };
  }

  refrescar();
  return { ok: true, mensaje: `Llamado #${id} vuelve a estar sin atender.` };
}

export async function crearLlamado(
  entrada: EntradaLlamado,
): Promise<Resultado> {
  const sesion = await exigirSesion();

  const crudo = entrada as unknown as Record<string, unknown>;
  const tipo = typeof crudo?.tipo === "string" ? crudo.tipo : "";
  const motivo = typeof crudo?.motivo === "string" ? crudo.motivo : "";
  const detalle = typeof crudo?.detalle === "string" ? crudo.detalle.trim() : "";
  const areaPedida =
    typeof crudo?.area_id === "number" ? crudo.area_id : null;

  if (!esTipo(tipo)) {
    return { ok: false, error: "El tipo tiene que ser NORMAL o EMERGENCIA." };
  }
  // El motivo tiene que ser de ESE tipo: la ficha solo ofrece los del tipo
  // elegido, y la acción lo vuelve a exigir porque se puede invocar a mano.
  const motivos = await leerMotivos();
  if (!motivos[tipo].includes(motivo)) {
    return {
      ok: false,
      error:
        tipo === "NORMAL"
          ? "Elegí un motivo de llamado normal."
          : "Elegí un motivo de emergencia.",
    };
  }

  // El área es la que se eligió, sea cual sea el rol.
  const areaId = areaPedida;

  if (areaId === null) {
    return { ok: false, error: "Elegí un área para el llamado." };
  }

  const { error } = await db().from("llamados").insert({
    area_id: areaId,
    tipo,
    origen: "EMPLEADO",
    estado: "NO_ATENDIDO",
    motivo,
    detalle: detalle === "" ? null : detalle,
    creado_por: sesion.usuario,
  });

  if (error) {
    return { ok: false, error: `No se pudo crear el llamado: ${error.message}` };
  }

  // Un alta manual también es un llamado nuevo, así que avisa. Va en segundo
  // plano: si Telegram falla, el llamado ya quedó creado igual.
  const { data: area } = await db()
    .from("areas")
    .select("nombre")
    .eq("id", areaId)
    .maybeSingle()
    .overrideTypes<{ nombre: string }, { merge: false }>();

  avisarNuevoLlamado({
    tipo,
    area: area?.nombre ?? `Área ${areaId}`,
    motivo,
    detalle: detalle === "" ? null : detalle,
    creadoEn: new Date(),
  });

  refrescar();
  return { ok: true, mensaje: "Llamado creado." };
}

export type ResultadoMotivo =
  | { ok: true; mensaje: string; motivo: string; motivos: MotivosPorTipo }
  | { ok: false; error: string };

/**
 * Crea un motivo dentro de un tipo, desde la misma ficha de nuevo llamado.
 * Cualquiera con sesión puede, igual que cualquiera puede crear un llamado.
 * Las reglas —un motivo pertenece a un solo tipo, y los del sistema no se
 * cargan a mano— viven en lib/motivos.ts.
 */
export async function crearMotivo(
  tipo: string,
  texto: string,
): Promise<ResultadoMotivo> {
  const sesion = await exigirSesion();

  if (typeof tipo !== "string" || !esTipo(tipo)) {
    return { ok: false, error: "El tipo tiene que ser NORMAL o EMERGENCIA." };
  }
  if (typeof texto !== "string") {
    return { ok: false, error: "Escribí el motivo." };
  }

  const resultado = await agregarMotivo(tipo, texto, sesion.usuario);
  if (!resultado.ok) return resultado;

  revalidatePath("/llamados");
  revalidatePath("/movil");

  return {
    ok: true,
    mensaje: `Motivo "${resultado.motivo}" agregado.`,
    motivo: resultado.motivo,
    motivos: resultado.motivos,
  };
}
