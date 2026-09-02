// app/api/ingest/route.ts
// Endpoint del nodo ESP32. Es la única ruta de la app abierta sin sesión:
// se autentica con la cabecera x-device-key contra DEVICE_KEY.
//
// El firmware solo reporta números. Toda la decisión (si hay llamado, de qué
// tipo, si prende el relé o la alarma) se toma acá, contra los umbrales que
// están en la tabla areas en este momento.

import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { MOTIVOS } from "@/lib/catalogos";
import { fechaHora, numero } from "@/lib/formato";
import {
  detalleDeDesvio,
  evaluarDesvios,
  hayEmergenciaAbierta,
  registrarLlamado,
} from "@/lib/alertas";
import type { Area } from "@/lib/tipos";

type Boton = "NINGUNO" | "NORMAL" | "EMERGENCIA";

type CuerpoIngesta = {
  dispositivo: string;
  area: string;
  temperatura: number | null;
  humedad: number | null;
  boton: Boton;
};

function json(cuerpo: unknown, status: number): Response {
  return Response.json(cuerpo, { status });
}

function esBoton(valor: unknown): valor is Boton {
  return valor === "NINGUNO" || valor === "NORMAL" || valor === "EMERGENCIA";
}

/** Acepta número o string numérico; cualquier otra cosa es null. */
function aNumero(valor: unknown): number | null {
  if (typeof valor === "number" && Number.isFinite(valor)) return valor;
  if (typeof valor === "string" && valor.trim() !== "") {
    const convertido = Number(valor);
    if (Number.isFinite(convertido)) return convertido;
  }
  return null;
}

function leerCuerpo(crudo: unknown): CuerpoIngesta | string {
  if (typeof crudo !== "object" || crudo === null) {
    return "El cuerpo tiene que ser un objeto JSON.";
  }

  const cuerpo = crudo as Record<string, unknown>;

  const dispositivo =
    typeof cuerpo.dispositivo === "string" ? cuerpo.dispositivo.trim() : "";
  if (dispositivo === "") return "Falta el campo dispositivo.";

  const area = typeof cuerpo.area === "string" ? cuerpo.area.trim() : "";
  if (area === "") return "Falta el campo area.";

  const boton = cuerpo.boton === undefined ? "NINGUNO" : cuerpo.boton;
  if (!esBoton(boton)) {
    return "El campo boton tiene que ser NINGUNO, NORMAL o EMERGENCIA.";
  }

  return {
    dispositivo,
    area: area.toUpperCase(),
    temperatura: aNumero(cuerpo.temperatura),
    humedad: aNumero(cuerpo.humedad),
    boton,
  };
}

export async function POST(request: NextRequest): Promise<Response> {
  const claveEsperada = process.env.DEVICE_KEY;
  if (!claveEsperada) {
    return json(
      { ok: false, error: "DEVICE_KEY no está configurada en el servidor." },
      500,
    );
  }

  if (request.headers.get("x-device-key") !== claveEsperada) {
    return json({ ok: false, error: "Clave de dispositivo inválida." }, 401);
  }

  let crudo: unknown;
  try {
    crudo = await request.json();
  } catch {
    return json({ ok: false, error: "El cuerpo no es JSON válido." }, 400);
  }

  const cuerpo = leerCuerpo(crudo);
  if (typeof cuerpo === "string") {
    return json({ ok: false, error: cuerpo }, 400);
  }

  // 2. Umbrales vigentes del área. Se leen en cada request: por eso editar un
  //    umbral en la pantalla de Áreas cambia el comportamiento del nodo ya.
  const { data: area, error: errorArea } = await db()
    .from("areas")
    .select(
      "id, codigo, nombre, tipo, temp_min, temp_max, hum_min, hum_max, activa, creada_en",
    )
    .eq("codigo", cuerpo.area)
    .maybeSingle()
    .overrideTypes<Area, { merge: false }>();

  if (errorArea) {
    return json(
      { ok: false, error: `No se pudo leer el área: ${errorArea.message}` },
      500,
    );
  }
  if (!area) {
    return json(
      { ok: false, error: `No existe un área con código ${cuerpo.area}.` },
      404,
    );
  }

  // 1. La lectura se guarda siempre, aunque el área esté dada de baja.
  const momento = new Date();
  const { error: errorLectura } = await db().from("lecturas").insert({
    dispositivo: cuerpo.dispositivo,
    area_id: area.id,
    temperatura: cuerpo.temperatura,
    humedad: cuerpo.humedad,
    tomada_en: momento.toISOString(),
  });

  if (errorLectura) {
    return json(
      {
        ok: false,
        error: `No se pudo guardar la lectura: ${errorLectura.message}`,
      },
      500,
    );
  }

  const llamados: { motivo: string; tipo: string; resultado: string }[] = [];

  // 3 y 4. Un llamado por magnitud fuera de rango, con antirrebote.
  //        Un área dada de baja guarda lecturas pero no genera alertas.
  if (area.activa) {
    for (const desvio of evaluarDesvios(
      area,
      cuerpo.temperatura,
      cuerpo.humedad,
    )) {
      const resultado = await registrarLlamado({
        areaId: area.id,
        areaNombre: area.nombre,
        tipo: desvio.tipo,
        origen: "SENSOR",
        motivo: desvio.motivo,
        detalle: detalleDeDesvio(desvio, cuerpo.dispositivo, momento),
        creadoPor: cuerpo.dispositivo,
      });

      llamados.push({
        motivo: desvio.motivo,
        tipo: desvio.tipo,
        resultado,
      });
    }

    // 5. Botón físico del nodo. Mismo antirrebote.
    if (cuerpo.boton !== "NINGUNO") {
      const motivo =
        cuerpo.boton === "EMERGENCIA"
          ? MOTIVOS.BOTON_EMERGENCIA
          : MOTIVOS.ASISTENCIA;

      const resultado = await registrarLlamado({
        areaId: area.id,
        areaNombre: area.nombre,
        tipo: cuerpo.boton,
        origen: "EMPLEADO",
        motivo,
        detalle:
          `Accionado desde ${cuerpo.dispositivo} en ${area.nombre} ` +
          `el ${fechaHora(momento)}. ` +
          `Lectura del momento: ${numero(cuerpo.temperatura)} °C, ` +
          `${numero(cuerpo.humedad)} %.`,
        creadoPor: cuerpo.dispositivo,
      });

      llamados.push({ motivo, tipo: cuerpo.boton, resultado });
    }
  }

  // 6. Órdenes de vuelta al nodo.
  //    rele: hay que ventilar (calor) o regar (sequedad).
  const rele =
    (cuerpo.temperatura !== null &&
      cuerpo.temperatura > Number(area.temp_max)) ||
    (cuerpo.humedad !== null && cuerpo.humedad < Number(area.hum_min));

  const alarma = await hayEmergenciaAbierta(area.id);

  return json(
    {
      ok: true,
      rele,
      alarma,
      // Informativo para depurar desde la terminal; el nodo puede ignorarlo.
      area: area.codigo,
      llamados,
    },
    200,
  );
}

/** Cualquier otro método no aplica en este endpoint. */
export async function GET(): Promise<Response> {
  return json(
    { ok: false, error: "Usá POST con la cabecera x-device-key." },
    405,
  );
}
