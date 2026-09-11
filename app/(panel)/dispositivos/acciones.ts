"use server";

// app/(panel)/dispositivos/acciones.ts
//
// Administración de la flota de nodos. TODA acción de este archivo arranca con
// exigirAdmin(): la verificación es del servidor. Que el ítem del menú esté
// oculto para un EMPLEADO no protege nada — una Server Action es un endpoint
// HTTP y se puede invocar sin pasar por la pantalla.
//
// EL SIMULADOR NO VIVE ACÁ. Se fue a app/(panel)/diagnostico/, y no es una
// mudanza cosmética: la versión que estaba en este archivo recibía el nombre
// del nodo como texto libre desde el navegador y lo mandaba con la DEVICE_KEY
// global, así que podía escribir bajo la identidad del hardware real. Ahora el
// simulador se autentica con una credencial del dispositivo SIMULADO que
// simula, y en este archivo no queda ninguna acción que escriba una lectura.
//
// Ver documents/contexto/80-simulador.md.

import { revalidatePath } from "next/cache";
import { exigirAdmin } from "@/lib/auth";
import {
  crearCredencial,
  revocarCredencial,
  rotarCredencial,
} from "@/lib/credenciales";
import {
  actualizarDispositivo,
  asignarArea,
  cambiarActivo,
  crearDispositivo,
  eliminarDispositivo,
  type CambiosDispositivo,
  type EntradaDispositivo,
} from "@/lib/dispositivos";
import type { NaturalezaDispositivo, Resultado } from "@/lib/tipos";

// ---------------------------------------------------------------------
// ADMINISTRACIÓN DE LA FLOTA
// ---------------------------------------------------------------------

function refrescar(): void {
  revalidatePath("/dispositivos");
  // El simulador lista los dispositivos SIMULADO y su estado.
  revalidatePath("/diagnostico");
  // El tablero muestra la frescura del sensor de cada área.
  revalidatePath("/");
}

/** Lo que llega del formulario. Se sanea antes de mirarlo. */
export type EntradaFichaDispositivo = {
  codigo: string;
  nombre: string;
  modelo: string;
  area_id: number | null;
  naturaleza: string;
  reporta_temperatura: boolean;
  reporta_humedad: boolean;
  reporta_boton: boolean;
  acciona_rele: boolean;
  acciona_alarma: boolean;
  observaciones: string;
};

/**
 * Una Server Action es un endpoint HTTP: el cuerpo puede venir con cualquier
 * forma. Antes de tocar un campo, normalizamos todo a los tipos esperados.
 */
function sanear(entrada: EntradaFichaDispositivo) {
  const crudo = entrada as unknown as Record<string, unknown>;

  const texto = (clave: string): string =>
    typeof crudo?.[clave] === "string" ? (crudo[clave] as string).trim() : "";

  // Las capacidades se saneen en positivo: lo que no venga explícitamente en
  // false queda encendido, que es el default de sql/06_dispositivos.sql.
  const capacidad = (clave: string): boolean => crudo?.[clave] !== false;

  const areaCruda = crudo?.area_id;
  const area_id =
    typeof areaCruda === "number" && Number.isInteger(areaCruda)
      ? areaCruda
      : null;

  const naturalezaCruda = texto("naturaleza").toUpperCase();
  const naturaleza: NaturalezaDispositivo =
    naturalezaCruda === "SIMULADO" ? "SIMULADO" : "FISICO";

  return {
    codigo: texto("codigo"),
    nombre: texto("nombre"),
    modelo: texto("modelo"),
    area_id,
    naturaleza,
    reporta_temperatura: capacidad("reporta_temperatura"),
    reporta_humedad: capacidad("reporta_humedad"),
    reporta_boton: capacidad("reporta_boton"),
    acciona_rele: capacidad("acciona_rele"),
    acciona_alarma: capacidad("acciona_alarma"),
    observaciones: texto("observaciones"),
  };
}

function validar(limpia: ReturnType<typeof sanear>): string | null {
  if (limpia.codigo === "") return "El código es obligatorio.";
  if (limpia.nombre === "") return "El nombre es obligatorio.";
  return null;
}

/**
 * Alta. El código y la naturaleza se fijan acá y no se vuelven a poder
 * cambiar: el código está grabado en el firmware y es lo que ata las lecturas
 * al dispositivo; la naturaleza separa el hardware real de la simulación.
 */
export async function crearDispositivoNuevo(
  entrada: EntradaFichaDispositivo,
): Promise<Resultado> {
  await exigirAdmin();

  const limpia = sanear(entrada);
  const problema = validar(limpia);
  if (problema) return { ok: false, error: problema };

  const ficha: EntradaDispositivo = {
    codigo: limpia.codigo,
    nombre: limpia.nombre,
    modelo: limpia.modelo === "" ? null : limpia.modelo,
    area_id: limpia.area_id,
    naturaleza: limpia.naturaleza,
    reporta_temperatura: limpia.reporta_temperatura,
    reporta_humedad: limpia.reporta_humedad,
    reporta_boton: limpia.reporta_boton,
    acciona_rele: limpia.acciona_rele,
    acciona_alarma: limpia.acciona_alarma,
    observaciones: limpia.observaciones === "" ? null : limpia.observaciones,
  };

  const resultado = await crearDispositivo(ficha);
  if (!resultado.ok) return { ok: false, error: resultado.error };

  refrescar();
  return {
    ok: true,
    mensaje: `Dispositivo ${resultado.dispositivo.codigo} creado. Emitile una credencial para que pueda reportar.`,
  };
}

/** Edición. No acepta código ni naturaleza: ver crearDispositivoNuevo(). */
export async function guardarDispositivo(
  id: number,
  entrada: EntradaFichaDispositivo,
): Promise<Resultado> {
  await exigirAdmin();

  if (typeof id !== "number" || !Number.isInteger(id)) {
    return { ok: false, error: "Identificador inválido." };
  }

  const limpia = sanear(entrada);
  if (limpia.nombre === "") return { ok: false, error: "El nombre es obligatorio." };

  const cambios: CambiosDispositivo = {
    nombre: limpia.nombre,
    modelo: limpia.modelo === "" ? null : limpia.modelo,
    reporta_temperatura: limpia.reporta_temperatura,
    reporta_humedad: limpia.reporta_humedad,
    reporta_boton: limpia.reporta_boton,
    acciona_rele: limpia.acciona_rele,
    acciona_alarma: limpia.acciona_alarma,
    observaciones: limpia.observaciones === "" ? null : limpia.observaciones,
  };

  const resultado = await actualizarDispositivo(id, cambios);
  if (!resultado.ok) return { ok: false, error: resultado.error };

  refrescar();
  return { ok: true, mensaje: "Dispositivo actualizado." };
}

/**
 * Asignar, reasignar o desasignar el área. `null` desasigna.
 *
 * No toca ninguna lectura ni ningún llamado histórico: esas filas conservan el
 * área que tenían cuando se grabaron. Por eso los reportes no se mueven cuando
 * un nodo cambia de área.
 */
export async function cambiarAreaDispositivo(
  id: number,
  areaId: number | null,
): Promise<Resultado> {
  await exigirAdmin();

  if (typeof id !== "number" || !Number.isInteger(id)) {
    return { ok: false, error: "Identificador inválido." };
  }

  const destino =
    typeof areaId === "number" && Number.isInteger(areaId) ? areaId : null;

  const resultado = await asignarArea(id, destino);
  if (!resultado.ok) return { ok: false, error: resultado.error };

  refrescar();
  return {
    ok: true,
    mensaje:
      destino === null
        ? "Dispositivo sin área. No va a tener umbrales ni automatización hasta que se le asigne una."
        : "Área asignada. Rige desde la próxima lectura.",
  };
}

/** Baja y alta lógica. Nunca borra la fila. */
export async function cambiarActivoDispositivo(
  id: number,
  activo: boolean,
): Promise<Resultado> {
  await exigirAdmin();

  if (typeof id !== "number" || !Number.isInteger(id)) {
    return { ok: false, error: "Identificador inválido." };
  }

  const resultado = await cambiarActivo(id, activo === true);
  if (!resultado.ok) return { ok: false, error: resultado.error };

  refrescar();
  return {
    ok: true,
    mensaje:
      activo === true
        ? "Dispositivo reactivado: vuelve a poder autenticarse."
        : "Dispositivo dado de baja: sus lecturas dejan de guardarse y su relé queda apagado.",
  };
}

/**
 * Borrado físico. Solo para dispositivos sin ni una lectura. Un dispositivo
 * con historia se da de baja, no se borra.
 */
export async function eliminarDispositivoSinLecturas(
  id: number,
): Promise<Resultado> {
  await exigirAdmin();

  if (typeof id !== "number" || !Number.isInteger(id)) {
    return { ok: false, error: "Identificador inválido." };
  }

  const resultado = await eliminarDispositivo(id);
  if (!resultado.ok) return { ok: false, error: resultado.error };

  refrescar();
  return { ok: true, mensaje: "Dispositivo eliminado." };
}

// ---------------------------------------------------------------------
// CREDENCIALES
//
// El secreto en claro viaja UNA sola vez, en la respuesta de estas dos
// acciones. No se guarda en la base y no se puede volver a consultar.
// El hash nunca sale de lib/credenciales.ts.
// ---------------------------------------------------------------------

export type ResultadoCredencial =
  | { ok: true; mensaje: string; secreto: string; codigo: string }
  | { ok: false; error: string };

/** Emite una credencial nueva. No toca las anteriores. */
export async function emitirCredencial(
  dispositivoId: number,
  codigo: string,
): Promise<ResultadoCredencial> {
  const sesion = await exigirAdmin();

  if (typeof dispositivoId !== "number" || !Number.isInteger(dispositivoId)) {
    return { ok: false, error: "Identificador inválido." };
  }

  const resultado = await crearCredencial(dispositivoId, sesion.usuario, {
    motivo: "Emitida desde la pantalla de Dispositivos.",
  });
  if (!resultado.ok) return { ok: false, error: resultado.error };

  refrescar();
  return {
    ok: true,
    mensaje: "Credencial emitida.",
    secreto: resultado.emitida.secreto,
    codigo: typeof codigo === "string" ? codigo : "",
  };
}

/**
 * Rota la credencial: cierra las anteriores y emite una nueva.
 *
 * `graciaSegundos` mayor que cero deja las viejas sirviendo durante ese rato.
 * Es lo que hay que usar con un nodo físico, que tiene el secreto grabado y no
 * se puede cambiar sin ir hasta el invernadero: sin ventana, rotar desde acá lo
 * deja sin autenticar en el acto.
 */
export async function rotarCredencialDispositivo(
  dispositivoId: number,
  codigo: string,
  graciaSegundos: number,
): Promise<ResultadoCredencial> {
  const sesion = await exigirAdmin();

  if (typeof dispositivoId !== "number" || !Number.isInteger(dispositivoId)) {
    return { ok: false, error: "Identificador inválido." };
  }

  const gracia =
    typeof graciaSegundos === "number" && Number.isFinite(graciaSegundos)
      ? Math.max(0, Math.floor(graciaSegundos))
      : 0;

  const resultado = await rotarCredencial(dispositivoId, sesion.usuario, {
    motivo: "Rotada desde la pantalla de Dispositivos.",
    graciaSegundos: gracia,
  });
  if (!resultado.ok) return { ok: false, error: resultado.error };

  refrescar();
  return {
    ok: true,
    mensaje:
      gracia > 0
        ? `Credencial rotada. La anterior sigue sirviendo ${gracia} segundos más.`
        : "Credencial rotada. La anterior quedó revocada en el acto.",
    secreto: resultado.emitida.secreto,
    codigo: typeof codigo === "string" ? codigo : "",
  };
}

/** Revoca una credencial. No borra la fila: queda como registro de auditoría. */
export async function revocarCredencialDispositivo(
  credencialId: number,
  motivo: string,
): Promise<Resultado> {
  const sesion = await exigirAdmin();

  if (typeof credencialId !== "number" || !Number.isInteger(credencialId)) {
    return { ok: false, error: "Identificador inválido." };
  }

  const texto = typeof motivo === "string" ? motivo.trim().slice(0, 300) : "";

  const resultado = await revocarCredencial(
    credencialId,
    sesion.usuario,
    texto === "" ? "Revocada desde la pantalla de Dispositivos." : texto,
  );
  if (!resultado.ok) return { ok: false, error: resultado.error };

  refrescar();
  return {
    ok: true,
    mensaje:
      "Credencial revocada. El dispositivo que la use deja de poder enviar datos, y su relé se apaga solo en menos de un minuto.",
  };
}
