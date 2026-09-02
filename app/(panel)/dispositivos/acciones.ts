"use server";

// app/(panel)/dispositivos/acciones.ts
//
// El simulador golpea /api/ingest de verdad, por HTTP, con la misma clave que
// usaría el nodo. Así lo que se demuestra es el camino real y no un atajo.
// DEVICE_KEY nunca sale del servidor: la acción arma la request acá.

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { exigirAdmin } from "@/lib/auth";
import type { Resultado } from "@/lib/tipos";

export type EntradaSimulacion = {
  dispositivo: string;
  area: string;
  temperatura: number;
  humedad: number;
  boton: string;
};

type RespuestaIngesta = {
  ok?: boolean;
  rele?: boolean;
  alarma?: boolean;
  error?: string;
};

/** URL absoluta de esta misma app, sirve en local y en Vercel. */
async function baseDeLaApp(): Promise<string> {
  const cabeceras = await headers();
  const host = cabeceras.get("host") ?? "localhost:3000";
  const protocolo =
    cabeceras.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");

  return `${protocolo}://${host}`;
}

export async function simularLectura(
  entrada: EntradaSimulacion,
): Promise<Resultado> {
  await exigirAdmin();

  const clave = process.env.DEVICE_KEY;
  if (!clave) {
    return { ok: false, error: "DEVICE_KEY no está configurada en el servidor." };
  }

  const crudo = entrada as unknown as Record<string, unknown>;
  const dispositivo =
    typeof crudo?.dispositivo === "string" ? crudo.dispositivo.trim() : "";
  const area = typeof crudo?.area === "string" ? crudo.area.trim() : "";
  const temperatura =
    typeof crudo?.temperatura === "number" ? crudo.temperatura : Number.NaN;
  const humedad = typeof crudo?.humedad === "number" ? crudo.humedad : Number.NaN;
  const boton = typeof crudo?.boton === "string" ? crudo.boton : "NINGUNO";

  if (dispositivo === "") return { ok: false, error: "Falta el dispositivo." };
  if (area === "") return { ok: false, error: "Elegí un área." };
  if (!Number.isFinite(temperatura) || !Number.isFinite(humedad)) {
    return { ok: false, error: "Temperatura y humedad tienen que ser números." };
  }

  let respuesta: Response;
  try {
    respuesta = await fetch(`${await baseDeLaApp()}/api/ingest`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-device-key": clave,
      },
      body: JSON.stringify({
        dispositivo,
        area,
        temperatura,
        humedad,
        boton,
      }),
      cache: "no-store",
    });
  } catch (fallo) {
    const motivo = fallo instanceof Error ? fallo.message : "desconocido";
    return { ok: false, error: `No se pudo llamar a /api/ingest: ${motivo}` };
  }

  let cuerpo: RespuestaIngesta = {};
  try {
    cuerpo = (await respuesta.json()) as RespuestaIngesta;
  } catch {
    return {
      ok: false,
      error: `/api/ingest respondió ${respuesta.status} sin JSON.`,
    };
  }

  if (!respuesta.ok || cuerpo.ok !== true) {
    return {
      ok: false,
      error: `/api/ingest respondió ${respuesta.status}: ${cuerpo.error ?? "error"}`,
    };
  }

  revalidatePath("/dispositivos");
  revalidatePath("/llamados");
  revalidatePath("/");

  return {
    ok: true,
    mensaje:
      `Lectura aceptada por /api/ingest. ` +
      `Relé: ${cuerpo.rele ? "ENCENDIDO" : "apagado"} · ` +
      `Alarma: ${cuerpo.alarma ? "ACTIVA" : "inactiva"}.`,
  };
}
