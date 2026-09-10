// lib/simulador.ts
// La credencial con la que el simulador golpea /api/ingest. SOLO servidor:
// nunca importar este módulo desde un componente marcado con "use client".
//
// POR QUÉ EXISTE ESTE ARCHIVO
//
// El simulador tiene que entrar por el camino real —HTTP contra /api/ingest,
// con una credencial de verdad— porque si entrara por un atajo lo que se
// demuestra no sería el sistema. Pero la credencial que use NO puede ser:
//
//   * la DEVICE_KEY global, porque esa clave es la del nodo físico y sale del
//     servidor en cada simulación (era el R2 del relevamiento), y porque
//     /api/ingest la acepta solo detrás de un flag de compatibilidad que
//     algún día se apaga;
//   * una credencial de un dispositivo FISICO, porque entonces la lectura
//     inventada quedaría atribuida al hardware real. Ese es exactamente el
//     defecto R1 que esta etapa viene a cerrar.
//
// Queda una sola opción sana: una credencial DEL DISPOSITIVO SIMULADO que se
// está simulando. Y como el secreto en claro se ve una sola vez y no se puede
// volver a consultar (invariante I-1 de 30-modelo-dispositivos.md), el
// servidor se la emite a sí mismo cuando la necesita.
//
// EL CICLO DE VIDA, DICHO SIN ADORNOS
//
//   1. La primera simulación de un dispositivo emite una credencial sha256-v1
//      con vencimiento corto y guarda el secreto en memoria del proceso.
//   2. Las simulaciones siguientes reusan ese secreto mientras siga vigente,
//      así una demo entera no deja una fila de credencial por clic.
//   3. Al vencer —o si el proceso se reinició y el secreto en memoria se
//      perdió— se revoca la anterior, si se la conoce, y se emite otra.
//
// El paso 3 es la razón del vencimiento. La caché es una variable de módulo:
// en serverless es best-effort, igual que el rate limit de revisarNodosCaidos()
// en lib/alertas.ts. Si el proceso muere, el secreto se pierde y nadie va a
// revocar esa fila nunca. Con `expira_en` la credencial huérfana deja de
// verificar sola, sin depender de que alguien se acuerde.
//
// EL SECRETO NO SE PERSISTE. Vive en el valor de retorno y en la caché de este
// módulo, y no se escribe en ningún log ni viaja al navegador.

import "server-only";
import { crearCredencial, revocarCredencial } from "./credenciales";
import { esFisico, puedeOperar } from "./dispositivos";
import type { Dispositivo } from "./tipos";

/**
 * Cuánto vive la credencial del simulador.
 *
 * Corto a propósito: es una credencial que solo usa el servidor para hablar
 * consigo mismo. Quince minutos alcanzan de sobra para una demostración y
 * acotan la ventana de una fila huérfana a ese mismo rato.
 */
export const MINUTOS_CREDENCIAL_SIMULADOR = 15;

/**
 * Margen con el que se considera "por vencer". Se renueva un poco antes de
 * tiempo para que no se emita una lectura con una credencial que expira entre
 * que se arma la request y que /api/ingest la verifica.
 */
const SEGUNDOS_MARGEN = 30;

/** Motivo que queda escrito en la fila, para que la auditoría diga qué es. */
const MOTIVO = "Credencial efímera del simulador (/diagnostico).";

type ClaveEnMemoria = {
  secreto: string;
  credencialId: number;
  prefijo: string | null;
  /** Momento de vencimiento, en milisegundos. */
  vence: number;
};

/**
 * dispositivo_id -> clave viva. Variable de módulo, no base de datos: el
 * secreto en claro no se persiste nunca.
 */
const enMemoria = new Map<number, ClaveEnMemoria>();

export type ClaveSimulacion =
  | { ok: true; secreto: string; credencialId: number; prefijo: string | null }
  | { ok: false; error: string };

/**
 * Devuelve una clave utilizable para simular contra este dispositivo.
 *
 * Las dos primeras verificaciones repiten las que hace la Server Action, y no
 * es redundancia inútil: esta función es la única que puede fabricar una
 * credencial de simulación, así que la regla vive también acá. Si mañana la
 * llama otro camino, la regla lo acompaña.
 *
 * Nunca devuelve una credencial de un dispositivo FISICO. No es una validación
 * que haya que acordarse de escribir en el llamador: es que este módulo no
 * emite esa credencial.
 */
export async function claveDeSimulacion(
  dispositivo: Dispositivo,
  usuario: string,
): Promise<ClaveSimulacion> {
  if (esFisico(dispositivo)) {
    return {
      ok: false,
      error:
        `${dispositivo.codigo} es un dispositivo FÍSICO. El simulador no emite ` +
        `credenciales de hardware real: una lectura inventada no puede quedar ` +
        `atribuida a un aparato que mide de verdad.`,
    };
  }

  if (!puedeOperar(dispositivo)) {
    return {
      ok: false,
      error:
        `${dispositivo.codigo} está dado de baja. Reactivalo desde Dispositivos ` +
        `si querés volver a simular con él.`,
    };
  }

  const ahora = Date.now();
  const vigente = enMemoria.get(dispositivo.id);

  if (vigente && vigente.vence - SEGUNDOS_MARGEN * 1000 > ahora) {
    return {
      ok: true,
      secreto: vigente.secreto,
      credencialId: vigente.credencialId,
      prefijo: vigente.prefijo,
    };
  }

  // La anterior, si la conocemos, se revoca antes de emitir la nueva: no tiene
  // sentido dejar dos credenciales del simulador vivas a la vez.
  if (vigente) {
    enMemoria.delete(dispositivo.id);
    await revocarCredencial(
      vigente.credencialId,
      usuario,
      "Reemplazada por una credencial nueva del simulador.",
    );
  }

  const vence = new Date(ahora + MINUTOS_CREDENCIAL_SIMULADOR * 60 * 1000);
  const emitida = await crearCredencial(dispositivo.id, usuario, {
    motivo: MOTIVO,
    expiraEn: vence,
  });

  if (!emitida.ok) {
    return {
      ok: false,
      error: `No se pudo emitir la credencial del simulador: ${emitida.error}`,
    };
  }

  enMemoria.set(dispositivo.id, {
    secreto: emitida.emitida.secreto,
    credencialId: emitida.emitida.credencial.id,
    prefijo: emitida.emitida.credencial.prefijo,
    vence: vence.getTime(),
  });

  return {
    ok: true,
    secreto: emitida.emitida.secreto,
    credencialId: emitida.emitida.credencial.id,
    prefijo: emitida.emitida.credencial.prefijo,
  };
}

/**
 * Olvida y revoca la credencial efímera de un dispositivo.
 *
 * La llama la propia acción cuando /api/ingest rechaza la clave: si el
 * servidor dijo que no sirve, quedarse con ella en memoria haría fallar todas
 * las simulaciones siguientes hasta que venciera.
 */
export async function olvidarClaveDeSimulacion(
  dispositivoId: number,
  usuario: string,
): Promise<void> {
  const vigente = enMemoria.get(dispositivoId);
  if (!vigente) return;

  enMemoria.delete(dispositivoId);
  await revocarCredencial(
    vigente.credencialId,
    usuario,
    "Descartada: /api/ingest no la aceptó.",
  );
}
