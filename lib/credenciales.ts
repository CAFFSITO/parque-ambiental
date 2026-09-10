// lib/credenciales.ts
// Credenciales por dispositivo. SOLO servidor: nunca importar este módulo
// desde un componente marcado con "use client".
//
// Reemplaza a la clave única DEVICE_KEY, que abre /api/ingest y /api/vigilancia
// para cualquiera que la conozca y no permite saber quién escribió una lectura.
//
// TRES REGLAS QUE NO SE NEGOCIAN
//   1. El secreto en claro se devuelve UNA sola vez, en el momento de
//      generarlo o rotarlo. No se guarda en la base, no se vuelve a poder
//      consultar y no se escribe en ningún log.
//   2. El hash tampoco sale de este módulo. Las funciones públicas seleccionan
//      COLUMNAS_PUBLICAS, que no incluye secreto_hash: no es una promesa, es
//      que la columna no se pide.
//   3. Revocar no borra la fila. La credencial revocada queda como registro de
//      auditoría, con quién la revocó y por qué.
//
// Este módulo NO verifica roles. La puerta está en la página y en la Server
// Action, que llaman exigirAdmin(). Es el patrón del resto del proyecto.

import "server-only";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { buscarPorCodigo, normalizarCodigo, puedeOperar } from "./dispositivos";
import type {
  AlgoritmoCredencial,
  CredencialEmitida,
  CredencialPublica,
  Dispositivo,
  MotivoRechazo,
  ResolucionAcceso,
} from "./tipos";

/**
 * Lo que se puede mostrar. secreto_hash NO está en esta lista, y esa ausencia
 * es el control: una función que seleccione estas columnas no puede filtrar el
 * hash ni por descuido.
 */
const COLUMNAS_PUBLICAS =
  "id, dispositivo_id, algoritmo, prefijo, estado, origen, expira_en, " +
  "usada_en, creada_en, creada_por, revocada_en, revocada_por, motivo";

/** Solo para verificar. Nunca se devuelve hacia afuera del módulo. */
const COLUMNAS_INTERNAS = `${COLUMNAS_PUBLICAS}, secreto_hash`;

/** Fila completa, uso interno. */
type FilaCredencial = CredencialPublica & { secreto_hash: string };

/**
 * Prefijo del secreto. Sirve para reconocerlo si aparece en un log, en una
 * captura de pantalla o en un repositorio: es la diferencia entre detectar una
 * fuga y no detectarla.
 */
export const PREFIJO_SECRETO = "pab_";

/** 32 bytes de aleatoriedad: 256 bits. No hay nada que probar por fuerza bruta. */
const BYTES_SECRETO = 32;

/** Cuántos caracteres del secreto se guardan para poder identificarlo. */
const LARGO_PREFIJO_VISIBLE = PREFIJO_SECRETO.length + 8;

/** Rondas de bcrypt, las mismas que usa el resto del sistema (scripts/hash.js). */
export const RONDAS_BCRYPT = 10;

// ---------------------------------------------------------------------
// SECRETOS Y HASHES (puro, sin base de datos)
// ---------------------------------------------------------------------

export type SecretoNuevo = {
  /** En claro. Mostrar una vez y no persistir. */
  secreto: string;
  /** Lo que sí se guarda para identificarlo. */
  prefijo: string;
  /** Lo que sí se guarda para verificarlo. */
  hash: string;
};

/**
 * Genera un secreto nuevo con 256 bits de entropía.
 *
 * Va en base64url porque el secreto viaja como valor de una cabecera HTTP
 * (x-device-key) y tiene que sobrevivir sin escapes.
 */
export function generarSecreto(): SecretoNuevo {
  const secreto = `${PREFIJO_SECRETO}${randomBytes(BYTES_SECRETO).toString("base64url")}`;
  return {
    secreto,
    prefijo: secreto.slice(0, LARGO_PREFIJO_VISIBLE),
    hash: hashSha256(secreto),
  };
}

/**
 * SHA-256 en hexadecimal, sin sal.
 *
 * Sin sal es a propósito, y es lo que permite buscar la credencial por su hash
 * con una sola consulta indexada, sin preguntarle al cuerpo de la petición
 * quién dice ser. Es seguro porque el secreto lo genera el servidor con 256
 * bits: no hay diccionario que recorrer. Un hash lento como bcrypt acá no
 * compraría seguridad, solo costaría CPU en cada uno de los reportes que el
 * nodo manda cada diez segundos.
 */
export function hashSha256(secreto: string): string {
  return createHash("sha256").update(secreto, "utf8").digest("hex");
}

/**
 * Hash bcrypt, solo para la clave que el nodo físico YA tiene grabada.
 *
 * Ese secreto es corto y de baja entropía, y no lo elegimos nosotros. Bcrypt
 * es exactamente la herramienta para eso: encarece el ataque por diccionario
 * si la tabla se filtrara. Es un camino de transición y desaparece cuando el
 * nodo se reflashee con un secreto generado.
 */
export function hashBcrypt(secreto: string): string {
  return bcrypt.hashSync(secreto, RONDAS_BCRYPT);
}

// ---------------------------------------------------------------------
// DECISIONES PURAS
//
// Reciben filas ya leídas y devuelven la decisión, sin tocar la base. Están
// separadas para poder probarlas de verdad.
// ---------------------------------------------------------------------

/**
 * Si la credencial NO sirve, dice por qué. Si sirve, devuelve null.
 *
 *   - REVOCADA no verifica nunca, sin importar fechas. Es el freno de mano.
 *   - ACTIVA verifica, salvo que tenga vencimiento y ya haya pasado.
 *   - ROTADA verifica MIENTRAS expira_en siga en el futuro. Es la ventana de
 *     gracia opcional: permite emitir la credencial nueva y que el nodo siga
 *     funcionando con la vieja hasta que alguien pueda ir a reflashearlo.
 */
export function motivoNoVigente(
  credencial: Pick<CredencialPublica, "estado" | "expira_en">,
  ahora: Date = new Date(),
): Exclude<MotivoRechazo, "SIN_CLAVE" | "CREDENCIAL_INVALIDA" | "DISPOSITIVO_INACTIVO"> | null {
  if (credencial.estado === "REVOCADA") return "CREDENCIAL_REVOCADA";

  if (credencial.expira_en !== null) {
    const vence = new Date(credencial.expira_en);
    if (!Number.isNaN(vence.getTime()) && vence.getTime() <= ahora.getTime()) {
      return "CREDENCIAL_VENCIDA";
    }
  }

  // ROTADA sin vencimiento no tiene ventana que la sostenga: se comporta como
  // vencida, porque una rotación sin fecha de corte no es una ventana de
  // gracia, es una credencial vieja que quedó suelta.
  if (credencial.estado === "ROTADA" && credencial.expira_en === null) {
    return "CREDENCIAL_VENCIDA";
  }

  return null;
}

/** Atajo booleano de motivoNoVigente(). */
export function credencialVigente(
  credencial: Pick<CredencialPublica, "estado" | "expira_en">,
  ahora: Date = new Date(),
): boolean {
  return motivoNoVigente(credencial, ahora) === null;
}

/**
 * Decide si este par (credencial, dispositivo) puede operar.
 *
 * El orden importa: primero la credencial, después el dispositivo. Una
 * credencial revocada se rechaza como tal aunque el dispositivo esté activo,
 * porque el problema es la credencial y el mensaje de auditoría tiene que
 * decir eso.
 *
 * Un dispositivo dado de baja NO autentica, aunque su credencial esté
 * perfecta: quedó fuera de servicio.
 */
export function resolverAcceso(
  dispositivo: Dispositivo,
  credencial: Pick<CredencialPublica, "id" | "estado" | "expira_en">,
  ahora: Date = new Date(),
): ResolucionAcceso {
  const problema = motivoNoVigente(credencial, ahora);
  if (problema !== null) return { ok: false, motivo: problema };

  if (!puedeOperar(dispositivo)) {
    return { ok: false, motivo: "DISPOSITIVO_INACTIVO" };
  }

  return { ok: true, dispositivo, credencialId: credencial.id };
}

/** Quita el hash de una fila interna. Red de seguridad, no la defensa principal. */
export function aPublica(fila: FilaCredencial | CredencialPublica): CredencialPublica {
  const {
    id,
    dispositivo_id,
    algoritmo,
    prefijo,
    estado,
    origen,
    expira_en,
    usada_en,
    creada_en,
    creada_por,
    revocada_en,
    revocada_por,
    motivo,
  } = fila;

  return {
    id,
    dispositivo_id,
    algoritmo,
    prefijo,
    estado,
    origen,
    expira_en,
    usada_en,
    creada_en,
    creada_por,
    revocada_en,
    revocada_por,
    motivo,
  };
}

// ---------------------------------------------------------------------
// AUTENTICACIÓN
// ---------------------------------------------------------------------

/**
 * Resuelve qué dispositivo está detrás de una clave.
 *
 * Dos caminos, y el orden no es negociable:
 *
 *   1. RÁPIDO. Hashea la clave con SHA-256 y busca esa fila por índice único.
 *      El cuerpo de la petición no participa: la cabecera sola determina la
 *      identidad. Es el camino de todos los secretos generados por el sistema.
 *
 *   2. HEREDADO. Solo si el rápido no encontró nada y quien llama pudo aportar
 *      el código que el aparato declara. Busca ese dispositivo y compara con
 *      bcrypt contra sus credenciales heredadas. Es el camino del nodo físico
 *      que todavía tiene grabada la clave vieja, y desaparece cuando se
 *      reflashee.
 *
 * Durante la transición, la clave del nodo va a ser al mismo tiempo su
 * credencial y la vieja clave global. Por eso la credencial se prueba PRIMERO:
 * si se probara antes el fallback global, el nodo seguiría entrando como
 * anónimo y la migración no habría servido de nada.
 *
 * Nunca registra la clave en ningún log.
 */
export async function autenticarDispositivo(
  clave: string | null | undefined,
  codigoDeclarado?: string | null,
  ahora: Date = new Date(),
): Promise<ResolucionAcceso> {
  if (typeof clave !== "string" || clave.trim() === "") {
    return { ok: false, motivo: "SIN_CLAVE" };
  }

  const porHash = await autenticarPorHash(clave, ahora);
  if (porHash !== null) return porHash;

  const porLegado = await autenticarPorLegado(clave, codigoDeclarado, ahora);
  if (porLegado !== null) return porLegado;

  return { ok: false, motivo: "CREDENCIAL_INVALIDA" };
}

/** Camino rápido. Devuelve null si esta clave no corresponde a ninguna fila. */
async function autenticarPorHash(
  clave: string,
  ahora: Date,
): Promise<ResolucionAcceso | null> {
  const { data, error } = await db()
    .from("dispositivo_credenciales")
    .select(COLUMNAS_PUBLICAS)
    .eq("algoritmo", "sha256-v1")
    .eq("secreto_hash", hashSha256(clave))
    .maybeSingle()
    .overrideTypes<CredencialPublica, { merge: false }>();

  if (error) {
    console.error(`[credenciales] no se pudo verificar: ${error.message}`);
    return null;
  }
  if (!data) return null;

  return resolverConDispositivo(data, ahora);
}

/** Camino heredado. Devuelve null si no aplica o si no coincide. */
async function autenticarPorLegado(
  clave: string,
  codigoDeclarado: string | null | undefined,
  ahora: Date,
): Promise<ResolucionAcceso | null> {
  if (typeof codigoDeclarado !== "string") return null;

  const codigo = normalizarCodigo(codigoDeclarado);
  if (codigo === "") return null;

  const dispositivo = await buscarPorCodigo(codigo);
  if (!dispositivo) return null;

  const { data, error } = await db()
    .from("dispositivo_credenciales")
    .select(COLUMNAS_INTERNAS)
    .eq("dispositivo_id", dispositivo.id)
    .eq("algoritmo", "bcrypt-v1")
    .overrideTypes<FilaCredencial[], { merge: false }>();

  if (error) {
    console.error(`[credenciales] no se pudo verificar el legado: ${error.message}`);
    return null;
  }

  const coincidencias = (data ?? []).filter((fila) =>
    bcrypt.compareSync(clave, fila.secreto_hash),
  );
  if (coincidencias.length === 0) return null;

  // Si alguna de las que coinciden sirve, gana esa. Si ninguna sirve, se
  // informa el motivo de la primera, que es el que corresponde auditar.
  const utilizable = coincidencias.find((fila) => credencialVigente(fila, ahora));
  const elegida = utilizable ?? coincidencias[0];

  return resolverAcceso(dispositivo, elegida, ahora);
}

/** Trae el dispositivo de una credencial y aplica resolverAcceso(). */
async function resolverConDispositivo(
  credencial: CredencialPublica,
  ahora: Date,
): Promise<ResolucionAcceso> {
  const { data, error } = await db()
    .from("dispositivos")
    .select(
      "id, codigo, nombre, modelo, area_id, activo, naturaleza, " +
        "reporta_temperatura, reporta_humedad, reporta_boton, " +
        "acciona_rele, acciona_alarma, ultimo_contacto_en, observaciones, creado_en",
    )
    .eq("id", credencial.dispositivo_id)
    .maybeSingle()
    .overrideTypes<Dispositivo, { merge: false }>();

  if (error || !data) return { ok: false, motivo: "CREDENCIAL_INVALIDA" };

  return resolverAcceso(data, credencial, ahora);
}

// ---------------------------------------------------------------------
// ADMINISTRACIÓN
//
// Todo lo de acá abajo lo invocan Server Actions que ya llamaron
// exigirAdmin(). Ninguna de estas funciones verifica el rol.
// ---------------------------------------------------------------------

/** Las credenciales de un dispositivo, sin el hash, de la más nueva a la más vieja. */
export async function listarCredenciales(
  dispositivoId: number,
): Promise<CredencialPublica[]> {
  if (!Number.isInteger(dispositivoId)) return [];

  const { data, error } = await db()
    .from("dispositivo_credenciales")
    .select(COLUMNAS_PUBLICAS)
    .eq("dispositivo_id", dispositivoId)
    .order("creada_en", { ascending: false })
    .overrideTypes<CredencialPublica[], { merge: false }>();

  if (error) {
    console.error(`[credenciales] no se pudieron leer: ${error.message}`);
    return [];
  }
  return data ?? [];
}

/**
 * Emite una credencial nueva y devuelve el secreto UNA vez.
 *
 * No toca las credenciales anteriores: emitir es emitir. Para reemplazar una
 * credencial existe rotarCredencial(), que además cierra la vieja.
 *
 * `expiraEn` fija un vencimiento. Es opcional y por omisión no hay ninguno,
 * que es lo que corresponde a la credencial de un aparato: se graba en el
 * firmware y tiene que seguir sirviendo hasta que alguien la rote.
 *
 * Existe por el simulador (ver lib/simulador.ts): esa credencial se emite
 * desde el servidor, se usa en el acto y su secreto no se persiste en ningún
 * lado. Sin vencimiento, un reinicio del servidor dejaría una credencial
 * ACTIVA que ya nadie tiene y que nadie va a revocar. Con vencimiento, se
 * muere sola.
 */
export async function crearCredencial(
  dispositivoId: number,
  usuario: string,
  opciones: { motivo?: string | null; expiraEn?: Date | null } = {},
): Promise<{ ok: true; emitida: CredencialEmitida } | { ok: false; error: string }> {
  if (!Number.isInteger(dispositivoId)) {
    return { ok: false, error: "Identificador de dispositivo inválido." };
  }

  const vence =
    opciones.expiraEn instanceof Date && !Number.isNaN(opciones.expiraEn.getTime())
      ? opciones.expiraEn.toISOString()
      : null;

  const nuevo = generarSecreto();

  const { data, error } = await db()
    .from("dispositivo_credenciales")
    .insert({
      dispositivo_id: dispositivoId,
      algoritmo: "sha256-v1" satisfies AlgoritmoCredencial,
      secreto_hash: nuevo.hash,
      prefijo: nuevo.prefijo,
      estado: "ACTIVA",
      origen: "GENERADA",
      expira_en: vence,
      creada_por: usuario,
      motivo: opciones.motivo?.trim() || null,
    })
    .select(COLUMNAS_PUBLICAS)
    .maybeSingle()
    .overrideTypes<CredencialPublica, { merge: false }>();

  if (error) return { ok: false, error: `No se pudo emitir: ${error.message}` };
  if (!data) return { ok: false, error: "No se pudo emitir la credencial." };

  return { ok: true, emitida: { credencial: data, secreto: nuevo.secreto } };
}

/**
 * Rota la credencial de un dispositivo: cierra las anteriores y emite una nueva.
 *
 * Por omisión, las anteriores quedan REVOCADAS en el acto. Es lo correcto
 * cuando el secreto viejo se filtró o cuando quien rota puede reflashear el
 * aparato ahí mismo.
 *
 * `graciaSegundos` mayor que cero abre una ventana: las anteriores pasan a
 * ROTADA con vencimiento y siguen sirviendo hasta que expire. Sirve para el
 * nodo físico, que tiene el secreto grabado y no se puede cambiar sin ir hasta
 * el invernadero: sin ventana, rotar desde el panel lo dejaría mudo en el acto.
 *
 * Devuelve el secreto nuevo UNA vez.
 */
export async function rotarCredencial(
  dispositivoId: number,
  usuario: string,
  opciones: { motivo?: string | null; graciaSegundos?: number } = {},
): Promise<{ ok: true; emitida: CredencialEmitida } | { ok: false; error: string }> {
  if (!Number.isInteger(dispositivoId)) {
    return { ok: false, error: "Identificador de dispositivo inválido." };
  }

  const gracia = Math.max(0, Math.floor(opciones.graciaSegundos ?? 0));
  const motivo = opciones.motivo?.trim() || "Rotación de credencial.";
  const ahora = new Date();

  const cierre =
    gracia > 0
      ? {
          estado: "ROTADA",
          expira_en: new Date(ahora.getTime() + gracia * 1000).toISOString(),
          motivo,
        }
      : {
          estado: "REVOCADA",
          revocada_en: ahora.toISOString(),
          revocada_por: usuario,
          motivo,
        };

  const { error: errorCierre } = await db()
    .from("dispositivo_credenciales")
    .update(cierre)
    .eq("dispositivo_id", dispositivoId)
    .neq("estado", "REVOCADA");

  if (errorCierre) {
    return {
      ok: false,
      error: `No se pudo cerrar la credencial anterior: ${errorCierre.message}`,
    };
  }

  return crearCredencial(dispositivoId, usuario, { motivo });
}

/**
 * Revoca una credencial. NO borra la fila: queda como registro de auditoría,
 * con quién la revocó, cuándo y por qué.
 */
export async function revocarCredencial(
  credencialId: number,
  usuario: string,
  motivo: string | null = null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isInteger(credencialId)) {
    return { ok: false, error: "Identificador de credencial inválido." };
  }

  const { error } = await db()
    .from("dispositivo_credenciales")
    .update({
      estado: "REVOCADA",
      revocada_en: new Date().toISOString(),
      revocada_por: usuario,
      motivo: motivo?.trim() || null,
    })
    .eq("id", credencialId)
    // Si ya estaba revocada, no se pisa la firma de quien lo hizo primero.
    .neq("estado", "REVOCADA");

  if (error) return { ok: false, error: `No se pudo revocar: ${error.message}` };
  return { ok: true };
}

/**
 * Deja constancia de que una credencial se usó recién.
 *
 * Es lo que responde, durante una rotación, la única pregunta que importa:
 * ¿ya es seguro revocar la vieja? Si hace días que nadie la usa, el aparato ya
 * está con la nueva.
 *
 * Es telemetría: quien la llame debería hacerlo fuera del camino que le
 * responde al nodo. Nunca lanza.
 */
export async function registrarUso(
  credencialId: number,
  momento: Date = new Date(),
): Promise<boolean> {
  if (!Number.isInteger(credencialId)) return false;

  const { error } = await db()
    .from("dispositivo_credenciales")
    .update({ usada_en: momento.toISOString() })
    .eq("id", credencialId);

  if (error) {
    console.error(
      `[credenciales] no se pudo registrar el uso de ${credencialId}: ${error.message}`,
    );
    return false;
  }
  return true;
}
