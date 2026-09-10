"use server";

// app/(panel)/diagnostico/acciones.ts
//
// El simulador, separado de la administración de la flota.
//
// TODA acción de este archivo arranca con exigirAdmin(): la verificación es
// del servidor. Que el ítem del menú no exista para un EMPLEADO no protege
// nada — una Server Action es un endpoint HTTP y se puede invocar sin pasar
// por la pantalla.
//
// LA REGLA DURA, Y DÓNDE SE APLICA
//
//   El simulador solo puede escribir bajo la identidad de un dispositivo cuya
//   naturaleza sea SIMULADO.
//
// Se aplica en el SERVIDOR, y en tres capas que no dependen una de otra:
//
//   1. Acá, en simularLectura(): se lee el dispositivo de la base por su id y
//      se rechaza si es FISICO. El cliente manda un id, no un código: no hay
//      ninguna cadena de texto del navegador que termine siendo la identidad
//      de una lectura.
//   2. En lib/simulador.ts, que es el único que fabrica la credencial del
//      simulador y no emite credenciales de dispositivos físicos.
//   3. En /api/ingest, que desde la etapa anterior resuelve el dispositivo por
//      la CREDENCIAL y no por el cuerpo (ver 12-contrato-ingest-objetivo.md).
//      Aunque alguien lograra postear `dispositivo: "NODO-INV-N-01"`, la
//      lectura se atribuye al dueño de la credencial, que es el simulado.
//
// La tercera capa es la que convierte la regla en garantía: no se cumple
// porque alguien se acordó de validar, se cumple porque no existe el camino.
//
// LO QUE ESTE ARCHIVO YA NO HACE
//
// La versión anterior vivía en dispositivos/acciones.ts, mandaba la DEVICE_KEY
// global y recibía el nombre del nodo como texto libre desde el navegador
// —que gestor.tsx armaba con `NODO-${codigo}-01`, o sea NODO-INV-N-01 para el
// área INV-N, el identificador del hardware real. Ese camino no existe más.

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { exigirAdmin } from "@/lib/auth";
import { esFisico, leerDispositivo, puedeOperar } from "@/lib/dispositivos";
import { claveDeSimulacion, olvidarClaveDeSimulacion } from "@/lib/simulador";

/** Lo que la pantalla manda. El dispositivo viaja por id, nunca por código. */
export type EntradaSimulacion = {
  dispositivoId: number;
  temperatura: number | null;
  humedad: number | null;
  boton: string;
};

/** Un llamado que /api/ingest informa haber creado o actualizado. */
export type LlamadoGenerado = {
  motivo: string;
  tipo: string;
  resultado: string;
};

/** El cuerpo con el que responde /api/ingest. Se muestra tal cual llega. */
export type RespuestaIngesta = {
  ok?: boolean;
  rele?: boolean;
  alarma?: boolean;
  area?: string | null;
  llamados?: LlamadoGenerado[];
  dispositivo?: string;
  compatibilidad?: boolean;
  area_declarada?: string | null;
  avisos?: string[];
  error?: string;
};

/**
 * La petición HTTP que se generó, para mostrarla en pantalla.
 *
 * La clave va SIEMPRE enmascarada: se muestra el prefijo, que es justamente
 * para lo que existe —reconocer un secreto sin revelarlo— y nada más. El
 * secreto en claro no sale del servidor.
 */
export type LlamadoHttp = {
  metodo: "POST";
  url: string;
  cabeceras: Record<string, string>;
  cuerpo: string;
};

export type ResultadoSimulacion =
  | {
      ok: true;
      estado: number;
      llamado: LlamadoHttp;
      respuesta: RespuestaIngesta;
    }
  | {
      ok: false;
      error: string;
      estado?: number;
      llamado?: LlamadoHttp;
      respuesta?: RespuestaIngesta;
    };

const BOTONES = ["NINGUNO", "NORMAL", "EMERGENCIA"] as const;

/**
 * URL absoluta de esta misma app.
 *
 * El orden prioriza lo que está configurado por fuera de la petición, y recién
 * al final cae a la cabecera `host`. Es la respuesta a R12: esa cabecera la
 * fija el cliente, y aunque acá el vector esté acotado a una cuenta de
 * ADMINISTRADOR, tener una variable que lo fije de antemano es mejor que
 * confiar en lo que llegó.
 *
 * Lo que se manda por esta URL ya no es la clave global: es una credencial
 * efímera de un dispositivo simulado, que vence sola y no abre nada más.
 */
async function baseDeLaApp(): Promise<string> {
  const configurada =
    process.env.SIMULADOR_BASE_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined);

  if (configurada && configurada.trim() !== "") {
    return configurada.trim().replace(/\/+$/, "");
  }

  const cabeceras = await headers();
  const host = cabeceras.get("host") ?? "localhost:3000";
  const protocolo =
    cabeceras.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");

  return `${protocolo}://${host}`;
}

/** Acepta número o string numérico; cualquier otra cosa es null (sensor mudo). */
function aNumero(valor: unknown): number | null {
  if (typeof valor === "number" && Number.isFinite(valor)) return valor;
  if (typeof valor === "string" && valor.trim() !== "") {
    const convertido = Number(valor);
    if (Number.isFinite(convertido)) return convertido;
  }
  return null;
}

/**
 * Envía una lectura simulada a /api/ingest por HTTP.
 *
 * No escribe en la base directamente, y es a propósito: lo que se demuestra
 * tiene que ser el camino real —autenticación, resolución de área, umbrales,
 * antirrebote, decisión del actuador— y no un atajo que pase por al lado de
 * todo eso.
 */
export async function simularLectura(
  entrada: EntradaSimulacion,
): Promise<ResultadoSimulacion> {
  const sesion = await exigirAdmin();

  // Una Server Action es un endpoint HTTP: el cuerpo puede venir con cualquier
  // forma. Se normaliza todo antes de mirarlo.
  const crudo = entrada as unknown as Record<string, unknown>;

  const idCrudo = crudo?.dispositivoId;
  if (typeof idCrudo !== "number" || !Number.isInteger(idCrudo)) {
    return { ok: false, error: "Elegí un dispositivo simulado." };
  }

  const botonCrudo = typeof crudo?.boton === "string" ? crudo.boton : "NINGUNO";
  const boton = (BOTONES as readonly string[]).includes(botonCrudo)
    ? botonCrudo
    : "NINGUNO";

  const temperatura = aNumero(crudo?.temperatura);
  const humedad = aNumero(crudo?.humedad);

  if (temperatura === null && humedad === null && boton === "NINGUNO") {
    return {
      ok: false,
      error:
        "No hay nada que simular: mandá al menos una magnitud o accioná el botón.",
    };
  }

  // ---- Capa 1: la identidad sale de la base, no del navegador. ----
  const dispositivo = await leerDispositivo(idCrudo);
  if (!dispositivo) {
    return { ok: false, error: "Ese dispositivo no existe." };
  }

  if (esFisico(dispositivo)) {
    return {
      ok: false,
      error:
        `Rechazado por el servidor: ${dispositivo.codigo} es un dispositivo ` +
        `FÍSICO. El simulador no puede escribir bajo la identidad de hardware ` +
        `real — una medición inventada quedaría mezclada con las del aparato y ` +
        `no habría forma de separarlas después. Elegí un dispositivo simulado, ` +
        `o creá uno en Dispositivos con naturaleza SIMULADO.`,
    };
  }

  if (!puedeOperar(dispositivo)) {
    return {
      ok: false,
      error:
        `${dispositivo.codigo} está dado de baja: /api/ingest no lo autentica y ` +
        `su lectura no se guardaría. Reactivalo desde Dispositivos.`,
    };
  }

  // ---- Capa 2: la credencial es de ESTE dispositivo simulado. ----
  const clave = await claveDeSimulacion(dispositivo, sesion.usuario);
  if (!clave.ok) return { ok: false, error: clave.error };

  const cuerpo = JSON.stringify({
    // El código va porque el contrato lo pide, pero /api/ingest ya no lo usa
    // para decidir nada: la identidad la determina la credencial.
    dispositivo: dispositivo.codigo,
    temperatura,
    humedad,
    boton,
  });

  const url = `${await baseDeLaApp()}/api/ingest`;

  const llamado: LlamadoHttp = {
    metodo: "POST",
    url,
    cabeceras: {
      "content-type": "application/json",
      // Enmascarada. El prefijo identifica la credencial sin revelarla.
      "x-device-key": `${clave.prefijo ?? "pab_"}… (credencial de ${dispositivo.codigo})`,
    },
    cuerpo,
  };

  let respuestaHttp: Response;
  try {
    respuestaHttp = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-device-key": clave.secreto,
      },
      body: cuerpo,
      cache: "no-store",
    });
  } catch (fallo) {
    const motivo = fallo instanceof Error ? fallo.message : "desconocido";
    return {
      ok: false,
      error: `No se pudo llamar a ${url}: ${motivo}`,
      llamado,
    };
  }

  let respuesta: RespuestaIngesta = {};
  try {
    respuesta = (await respuestaHttp.json()) as RespuestaIngesta;
  } catch {
    return {
      ok: false,
      error: `/api/ingest respondió ${respuestaHttp.status} sin JSON.`,
      estado: respuestaHttp.status,
      llamado,
    };
  }

  if (respuestaHttp.status === 401) {
    // La credencial efímera no sirve —venció entre medio, o alguien la revocó
    // desde Dispositivos—. Se descarta para que la próxima simulación emita
    // otra en vez de reintentar con la misma.
    await olvidarClaveDeSimulacion(dispositivo.id, sesion.usuario);
  }

  if (!respuestaHttp.ok || respuesta.ok !== true) {
    return {
      ok: false,
      error: `/api/ingest respondió ${respuestaHttp.status}: ${respuesta.error ?? "error"}`,
      estado: respuestaHttp.status,
      llamado,
      respuesta,
    };
  }

  // La lectura entró: el tablero, los llamados y la ficha del dispositivo
  // pueden haber cambiado.
  revalidatePath("/diagnostico");
  revalidatePath("/dispositivos");
  revalidatePath("/llamados");
  revalidatePath("/");

  return {
    ok: true,
    estado: respuestaHttp.status,
    llamado,
    respuesta,
  };
}
