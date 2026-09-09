// lib/avisos.ts
// Un solo lugar decide a dónde va el aviso de un llamado nuevo.
//
// Hay dos destinos y son independientes:
//   * push del navegador: se prende y se apaga por dispositivo, desde la
//     pantalla de Avisos. Cada celular o compu elige.
//   * Telegram: va a un único grupo, así que el interruptor es del sistema
//     entero y lo maneja el administrador. Para silenciarlo en un celular en
//     particular se silencia el grupo desde Telegram, que es donde vive.
//
// Así, en un mismo teléfono se pueden tener los dos avisos, uno solo, o
// ninguno, sin que la elección de una persona apague la de otra.

import { after } from "next/server";
import { db } from "./db";
import { enviarPush, type AlertaPush } from "./push";
import { enviarAlerta, type AlertaTelegram } from "./telegram";

export type Alerta = AlertaTelegram & AlertaPush;

export const AJUSTE_TELEGRAM = "telegram_activo";

type FilaAjuste = { clave: string; valor: string };

/**
 * Lee un ajuste. Si la tabla todavía no existe (sql/05_avisos.sql sin correr)
 * devuelve el valor por omisión en vez de romper: el sistema tiene que seguir
 * creando llamados aunque la migración esté pendiente.
 */
export async function leerAjuste(
  clave: string,
  porOmision: string,
): Promise<string> {
  const { data, error } = await db()
    .from("ajustes")
    .select("clave, valor")
    .eq("clave", clave)
    .maybeSingle()
    .overrideTypes<FilaAjuste, { merge: false }>();

  if (error || !data) return porOmision;
  return data.valor;
}

/** Guarda un ajuste. Devuelve el mensaje de error, o null si salió bien. */
export async function guardarAjuste(
  clave: string,
  valor: string,
  usuario: string,
): Promise<string | null> {
  const { error } = await db().from("ajustes").upsert(
    {
      clave,
      valor,
      actualizado_en: new Date().toISOString(),
      actualizado_por: usuario,
    },
    { onConflict: "clave" },
  );

  return error ? error.message : null;
}

/** ¿El sistema manda avisos a Telegram? */
export async function telegramActivo(): Promise<boolean> {
  return (await leerAjuste(AJUSTE_TELEGRAM, "si")) === "si";
}

/**
 * Reparte el aviso de un llamado nuevo: push a cada dispositivo suscripto y,
 * si el interruptor del sistema está prendido, el mensaje al grupo de
 * Telegram. Los dos van dentro de un mismo after(), así quien creó el llamado
 * no espera a ninguno de los dos servicios y un fallo no lo arrastra.
 */
export function avisarNuevoLlamado(alerta: Alerta): void {
  const repartir = async () => {
    await Promise.allSettled([
      enviarPush(alerta),
      (async () => {
        // Si el ajuste no se puede leer se manda igual: perder el aviso es
        // peor que mandarlo de más.
        let activo = true;
        try {
          activo = await telegramActivo();
        } catch {
          activo = true;
        }
        if (activo) await enviarAlerta(alerta);
      })(),
    ]);
  };

  try {
    after(repartir);
  } catch {
    void repartir();
  }
}
