"use server";

// app/(panel)/llamados/acciones.ts
//
// Regla de área verificada en el servidor: un EMPLEADO solo atiende llamados
// de su area_id, y los que crea quedan en su área sí o sí. Lo que mande el
// cliente en area_id se ignora para ese rol.

import { revalidatePath } from "next/cache";
import { exigirSesion } from "@/lib/auth";
import { db } from "@/lib/db";
import { LISTA_MOTIVOS } from "@/lib/catalogos";
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

  // El candado de área: no alcanza con que la UI no muestre el botón.
  if (sesion.rol === "EMPLEADO" && llamado.area_id !== sesion.area_id) {
    return {
      ok: false,
      error: "No podés atender llamados de otra área.",
    };
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

  if (sesion.rol === "EMPLEADO" && llamado.area_id !== sesion.area_id) {
    return {
      ok: false,
      error: "No podés cambiar llamados de otra área.",
    };
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
  if (!LISTA_MOTIVOS.includes(motivo)) {
    return { ok: false, error: "El motivo no pertenece al catálogo." };
  }

  // Para EMPLEADO el área es la suya, venga lo que venga del cliente.
  const areaId = sesion.rol === "EMPLEADO" ? sesion.area_id : areaPedida;

  if (areaId === null) {
    return {
      ok: false,
      error:
        sesion.rol === "EMPLEADO"
          ? "Tu usuario no tiene área asignada."
          : "Elegí un área para el llamado.",
    };
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
