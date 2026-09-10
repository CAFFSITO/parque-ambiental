"use server";

// app/(panel)/avisos/acciones.ts
//
// Cada suscripción es de quien la creó: todas las acciones filtran por el
// usuario de la sesión, así nadie puede apagar ni borrar el aviso del
// dispositivo de otro. El interruptor de Telegram, en cambio, es del sistema
// entero y por eso pide rol ADMINISTRADOR.

import { revalidatePath } from "next/cache";
import { exigirAdmin, exigirSesion } from "@/lib/auth";
import { db } from "@/lib/db";
import { AJUSTE_TELEGRAM, guardarAjuste } from "@/lib/avisos";
import { enviarPushA } from "@/lib/push";
import type { Resultado } from "@/lib/tipos";

export type EntradaSuscripcion = {
  endpoint: string;
  p256dh: string;
  auth: string;
  dispositivo: string;
};

const LARGO_MAXIMO = 900;

function texto(valor: unknown, tope = LARGO_MAXIMO): string {
  return typeof valor === "string" ? valor.trim().slice(0, tope) : "";
}

/**
 * Alta o actualización de la suscripción de este navegador. El endpoint es la
 * clave: si el navegador renueva sus claves, la fila se pisa en vez de
 * duplicarse, y la suscripción vuelve a quedar activa.
 */
export async function guardarSuscripcion(
  entrada: EntradaSuscripcion,
): Promise<Resultado> {
  const sesion = await exigirSesion();

  const crudo = entrada as unknown as Record<string, unknown>;
  const endpoint = texto(crudo?.endpoint);
  const p256dh = texto(crudo?.p256dh, 200);
  const auth = texto(crudo?.auth, 200);
  const dispositivo = texto(crudo?.dispositivo, 120);

  if (!endpoint.startsWith("https://") || !p256dh || !auth) {
    return { ok: false, error: "La suscripción del navegador no es válida." };
  }

  const { error } = await db().from("suscripciones_push").upsert(
    {
      usuario_id: sesion.id,
      endpoint,
      p256dh,
      auth,
      dispositivo: dispositivo === "" ? null : dispositivo,
      activa: true,
    },
    { onConflict: "endpoint" },
  );

  if (error) {
    return { ok: false, error: `No se pudo guardar: ${error.message}` };
  }

  revalidatePath("/avisos");
  return { ok: true, mensaje: "Este dispositivo va a recibir los avisos." };
}

/**
 * Alta silenciosa del enganche automático del panel.
 *
 * Se diferencia de guardarSuscripcion en una cosa y es la importante: si la
 * fila ya existe NO toca 'activa'. Así, un dispositivo apagado a mano sigue
 * apagado por más que se entre al panel diez veces.
 */
export async function asegurarSuscripcion(
  entrada: EntradaSuscripcion,
): Promise<Resultado> {
  const sesion = await exigirSesion();

  const crudo = entrada as unknown as Record<string, unknown>;
  const endpoint = texto(crudo?.endpoint);
  const p256dh = texto(crudo?.p256dh, 200);
  const auth = texto(crudo?.auth, 200);
  const dispositivo = texto(crudo?.dispositivo, 120);

  if (!endpoint.startsWith("https://") || !p256dh || !auth) {
    return { ok: false, error: "La suscripción del navegador no es válida." };
  }

  const { data: existente } = await db()
    .from("suscripciones_push")
    .select("id")
    .eq("endpoint", endpoint)
    .maybeSingle()
    .overrideTypes<{ id: number }, { merge: false }>();

  if (existente) {
    await db()
      .from("suscripciones_push")
      .update({
        usuario_id: sesion.id,
        p256dh,
        auth,
        dispositivo: dispositivo === "" ? null : dispositivo,
      })
      .eq("id", existente.id);

    revalidatePath("/avisos");
    return { ok: true };
  }

  const { error } = await db().from("suscripciones_push").insert({
    usuario_id: sesion.id,
    endpoint,
    p256dh,
    auth,
    dispositivo: dispositivo === "" ? null : dispositivo,
    activa: true,
  });

  if (error) {
    return { ok: false, error: `No se pudo guardar: ${error.message}` };
  }

  revalidatePath("/avisos");
  return { ok: true, mensaje: "Este dispositivo va a recibir los avisos." };
}

/** Baja definitiva: la usa el navegador cuando cancela la suscripción. */
export async function borrarSuscripcion(endpoint: string): Promise<Resultado> {
  const sesion = await exigirSesion();
  const clave = texto(endpoint);
  if (clave === "") return { ok: false, error: "Falta el endpoint." };

  const { error } = await db()
    .from("suscripciones_push")
    .delete()
    .eq("endpoint", clave)
    .eq("usuario_id", sesion.id);

  if (error) {
    return { ok: false, error: `No se pudo borrar: ${error.message}` };
  }

  revalidatePath("/avisos");
  return { ok: true, mensaje: "Este dispositivo ya no recibe avisos." };
}

/**
 * Prende y apaga sin soltar el permiso del navegador. Es lo que se usa para
 * dejar solo Telegram en un dispositivo y volver atrás sin volver a pedir
 * permiso, que en iOS solo se puede pedir una vez.
 */
export async function cambiarSuscripcion(
  id: number,
  activa: boolean,
): Promise<Resultado> {
  const sesion = await exigirSesion();

  if (typeof id !== "number" || !Number.isInteger(id)) {
    return { ok: false, error: "Identificador inválido." };
  }

  const { error } = await db()
    .from("suscripciones_push")
    .update({ activa: activa === true })
    .eq("id", id)
    .eq("usuario_id", sesion.id);

  if (error) {
    return { ok: false, error: `No se pudo cambiar: ${error.message}` };
  }

  revalidatePath("/avisos");
  return {
    ok: true,
    mensaje: activa ? "Avisos activados." : "Avisos apagados en ese dispositivo.",
  };
}

/** Manda un aviso de prueba a los dispositivos activos de quien lo pide. */
export async function probarPush(): Promise<Resultado> {
  const sesion = await exigirSesion();

  const llegaron = await enviarPushA(sesion.id, {
    tipo: "NORMAL",
    area: "Prueba",
    motivo: "Aviso de prueba",
    detalle: "Si ves esto, los avisos de este dispositivo funcionan.",
    creadoEn: new Date(),
  });

  if (llegaron === 0) {
    return {
      ok: false,
      error:
        "No salió a ningún dispositivo. Revisá que los avisos estén activados y que el navegador tenga el permiso concedido.",
    };
  }

  return {
    ok: true,
    mensaje: `Aviso de prueba enviado a ${llegaron} dispositivo${llegaron === 1 ? "" : "s"}.`,
  };
}

/** Interruptor de Telegram para todo el sistema. Solo ADMINISTRADOR. */
export async function cambiarTelegram(activo: boolean): Promise<Resultado> {
  const sesion = await exigirAdmin();

  const error = await guardarAjuste(
    AJUSTE_TELEGRAM,
    activo === true ? "si" : "no",
    sesion.usuario,
  );

  if (error) {
    return { ok: false, error: `No se pudo guardar el ajuste: ${error}` };
  }

  revalidatePath("/avisos");
  return {
    ok: true,
    mensaje: activo
      ? "Telegram vuelve a recibir los avisos."
      : "El sistema deja de mandar a Telegram.",
  };
}
