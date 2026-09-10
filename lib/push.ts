// lib/push.ts
// Notificaciones push del navegador (Web Push + VAPID). Solo servidor.
//
// Mismas dos reglas que Telegram:
//   1. Solo al CREAR un llamado. El antirrebote no avisa.
//   2. Un fallo del servicio de push no puede voltear un llamado: todo va en
//      try/catch y el envío se agenda con after().
//
// Una suscripción muerta (el navegador se desinstaló, la persona limpió los
// datos del sitio) responde 404 o 410. Esas se borran solas acá: si no, la
// tabla se llena de endpoints que nunca más van a recibir nada.

import { after } from "next/server";
import webpush from "web-push";
import { db } from "./db";
import { fechaHora } from "./formato";
import type { TipoLlamado } from "./tipos";

export type AlertaPush = {
  tipo: TipoLlamado;
  area: string;
  motivo: string;
  detalle: string | null;
  creadoEn: Date | string;
};

export type FilaSuscripcion = {
  id: number;
  usuario_id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  dispositivo: string | null;
  activa: boolean;
  creada_en: string;
  usada_en: string | null;
};

const COLUMNAS =
  "id, usuario_id, endpoint, p256dh, auth, dispositivo, activa, creada_en, usada_en";

/** Códigos con los que el servicio de push dice "esta suscripción ya no existe". */
const MUERTA = [404, 410];

let configurado: boolean | null = null;

/**
 * Carga las claves VAPID una sola vez. Sin claves el sistema funciona igual,
 * solo que sin push: es la misma política que con las credenciales de Telegram.
 */
function hayClaves(): boolean {
  if (configurado !== null) return configurado;

  const publica = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privada = process.env.VAPID_PRIVATE_KEY;

  if (!publica || !privada) {
    configurado = false;
    return false;
  }

  webpush.setVapidDetails(
    process.env.VAPID_CONTACTO ?? "mailto:avisos@parque-ambiental.local",
    publica,
    privada,
  );
  configurado = true;
  return true;
}

export function pushDisponible(): boolean {
  return hayClaves();
}

function cuerpoDeAlerta(alerta: AlertaPush): string {
  const lineas = [`${alerta.area} · ${alerta.motivo}`];
  if (alerta.detalle) lineas.push(alerta.detalle);
  lineas.push(fechaHora(alerta.creadoEn));
  return lineas.join("\n");
}

/** Lo que recibe el service worker en el evento push. */
function carga(alerta: AlertaPush): string {
  return JSON.stringify({
    titulo:
      alerta.tipo === "EMERGENCIA"
        ? `Emergencia en ${alerta.area}`
        : `Llamado en ${alerta.area}`,
    cuerpo: cuerpoDeAlerta(alerta),
    tipo: alerta.tipo,
    url: "/llamados",
  });
}

async function suscripcionesActivas(
  usuarioId?: number,
): Promise<FilaSuscripcion[]> {
  let consulta = db()
    .from("suscripciones_push")
    .select(COLUMNAS)
    .eq("activa", true);

  if (usuarioId !== undefined) consulta = consulta.eq("usuario_id", usuarioId);

  const { data, error } = await consulta.overrideTypes<
    FilaSuscripcion[],
    { merge: false }
  >();

  if (error) {
    console.error(`[push] no se pudieron leer las suscripciones: ${error.message}`);
    return [];
  }
  return data ?? [];
}

async function enviarA(fila: FilaSuscripcion, texto: string): Promise<boolean> {
  try {
    await webpush.sendNotification(
      {
        endpoint: fila.endpoint,
        keys: { p256dh: fila.p256dh, auth: fila.auth },
      },
      texto,
      { TTL: 900 },
    );

    await db()
      .from("suscripciones_push")
      .update({ usada_en: new Date().toISOString() })
      .eq("id", fila.id);

    return true;
  } catch (fallo) {
    const estado =
      typeof fallo === "object" && fallo !== null && "statusCode" in fallo
        ? Number((fallo as { statusCode: unknown }).statusCode)
        : 0;

    if (MUERTA.includes(estado)) {
      await db().from("suscripciones_push").delete().eq("id", fila.id);
      return false;
    }

    const motivo = fallo instanceof Error ? fallo.message : "desconocido";
    console.error(`[push] no se pudo avisar a ${fila.id}: ${motivo}`);
    return false;
  }
}

/**
 * Manda la alerta a todas las suscripciones activas.
 * Devuelve a cuántas llegó. Nunca lanza.
 */
export async function enviarPush(alerta: AlertaPush): Promise<number> {
  if (!hayClaves()) {
    console.warn("[push] sin claves VAPID: no se manda nada");
    return 0;
  }

  const filas = await suscripcionesActivas();
  if (filas.length === 0) {
    console.info("[push] no hay dispositivos suscriptos");
    return 0;
  }

  const texto = carga(alerta);
  const resultados = await Promise.all(filas.map((fila) => enviarA(fila, texto)));
  const llegaron = resultados.filter(Boolean).length;

  // Queda en el log del servidor: sin esto, un aviso que no llega no deja
  // ninguna huella y no se sabe si falló el envío o el navegador.
  console.info(
    `[push] ${alerta.motivo}: enviado a ${llegaron} de ${filas.length}`,
  );
  return llegaron;
}

/** Igual que enviarPush pero acotado a los dispositivos de una persona. */
export async function enviarPushA(
  usuarioId: number,
  alerta: AlertaPush,
): Promise<number> {
  if (!hayClaves()) return 0;

  const filas = await suscripcionesActivas(usuarioId);
  if (filas.length === 0) return 0;

  const texto = carga(alerta);
  const resultados = await Promise.all(filas.map((fila) => enviarA(fila, texto)));
  return resultados.filter(Boolean).length;
}

/**
 * Agenda el envío para después de responder. Si no hay contexto de request
 * cae a un envío suelto. En ningún caso propaga el error.
 */
export function avisarPushEnSegundoPlano(alerta: AlertaPush): void {
  try {
    after(() => enviarPush(alerta));
  } catch {
    void enviarPush(alerta);
  }
}
