// app/api/vigilancia/route.ts
// Barrida de nodos caídos. El tablero llama a revisarNodosCaidos() directo
// (sin pasar por HTTP), así que el sistema no depende de un cron; esta ruta
// existe para poder dispararla a mano o desde un cron externo si se quiere.
//
// Se autentica con sesión válida o con la cabecera x-device-key.

import type { NextRequest } from "next/server";
import { getSesion } from "@/lib/auth";
import { revisarNodosCaidos, SEGUNDOS_SIN_SENAL } from "@/lib/alertas";

async function autorizado(request: NextRequest): Promise<boolean> {
  const clave = process.env.DEVICE_KEY;
  if (clave && request.headers.get("x-device-key") === clave) return true;
  return (await getSesion()) !== null;
}

async function manejar(request: NextRequest): Promise<Response> {
  if (!(await autorizado(request))) {
    return Response.json(
      { ok: false, error: "Necesitás sesión válida o x-device-key." },
      { status: 401 },
    );
  }

  // Desde HTTP siempre se fuerza: quien llama la ruta quiere la barrida ahora.
  const resumen = await revisarNodosCaidos(true);

  return Response.json({
    ok: true,
    umbral_segundos: SEGUNDOS_SIN_SENAL,
    ...resumen,
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  return manejar(request);
}

export async function POST(request: NextRequest): Promise<Response> {
  return manejar(request);
}
