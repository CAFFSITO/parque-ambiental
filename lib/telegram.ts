// lib/telegram.ts
// Aviso por Telegram al crear un llamado.
//
// Dos reglas que no se negocian:
//   1. Solo al CREAR. Las actualizaciones del antirrebote no avisan: si no,
//      un nodo reportando cada pocos segundos inunda el grupo.
//   2. Telegram nunca puede voltear un llamado. Todo va en try/catch y el
//      envío se agenda con after(), así la respuesta al nodo no espera a la
//      API de Telegram.

import { after } from "next/server";
import { fechaHora } from "./formato";
import type { TipoLlamado } from "./tipos";

const TIEMPO_LIMITE_MS = 5000;

export type AlertaTelegram = {
  tipo: TipoLlamado;
  area: string;
  motivo: string;
  detalle: string | null;
  creadoEn: Date | string;
};

/**
 * Dominio público de la app, para el enlace del mensaje.
 * En Vercel salen de las variables que la plataforma inyecta sola.
 */
function dominio(): string {
  const explicito = process.env.APP_URL;
  if (explicito) return explicito.replace(/\/+$/, "");

  const produccion = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (produccion) return `https://${produccion}`;

  const despliegue = process.env.VERCEL_URL;
  if (despliegue) return `https://${despliegue}`;

  return "http://localhost:3000";
}

function armarMensaje(alerta: AlertaTelegram): string {
  const lineas = [
    `[${alerta.tipo}] ${alerta.area}`,
    `Motivo: ${alerta.motivo}`,
  ];

  if (alerta.detalle) lineas.push(`Detalle: ${alerta.detalle}`);

  lineas.push(fechaHora(alerta.creadoEn));
  lineas.push(`Ver: ${dominio()}/llamados`);

  return lineas.join("\n");
}

/**
 * Envía el aviso. Devuelve true si Telegram lo aceptó.
 * Nunca lanza: cualquier fallo se traga y se registra en consola.
 */
export async function enviarAlerta(alerta: AlertaTelegram): Promise<boolean> {
  const token = process.env.TELEGRAM_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chat) {
    // Sin credenciales el sistema funciona igual, solo que sin avisos.
    return false;
  }

  try {
    const respuesta = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chat,
          text: armarMensaje(alerta),
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(TIEMPO_LIMITE_MS),
        cache: "no-store",
      },
    );

    if (!respuesta.ok) {
      const cuerpo = await respuesta.text();
      console.error(
        `[telegram] respondió ${respuesta.status}: ${cuerpo.slice(0, 300)}`,
      );
      return false;
    }

    return true;
  } catch (fallo) {
    const motivo = fallo instanceof Error ? fallo.message : "desconocido";
    console.error(`[telegram] no se pudo avisar: ${motivo}`);
    return false;
  }
}

/**
 * Agenda el aviso para después de responder. Si no hay contexto de request
 * (after() solo vive dentro de uno), cae a un envío suelto que igual se
 * atrapa. En ningún caso propaga el error a quien creó el llamado.
 */
export function avisarEnSegundoPlano(alerta: AlertaTelegram): void {
  try {
    after(() => enviarAlerta(alerta));
  } catch {
    void enviarAlerta(alerta);
  }
}
