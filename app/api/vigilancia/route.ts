// app/api/vigilancia/route.ts
// Barrida de nodos caídos. El tablero llama a revisarNodosCaidos() directo
// (sin pasar por HTTP), así que el sistema no depende de un cron; esta ruta
// existe para poder dispararla a mano o desde un cron externo si se quiere.
//
// Solo ADMINISTRADOR o credencial vigente de un dispositivo activo.

import type { NextRequest } from "next/server";
import { exigirAdmin, getSesion } from "@/lib/auth";
import { autenticarDispositivo } from "@/lib/credenciales";
import { revisarNodosCaidos, SEGUNDOS_SIN_SENAL } from "@/lib/alertas";

async function manejar(request: NextRequest): Promise<Response> {
  const dispositivo = await autenticarDispositivo(
    request.headers.get("x-device-key"),
    // El legado bcrypt requiere un código para localizar su hash. No es una
    // autorización: la clave siempre se verifica contra la credencial de BD.
    request.headers.get("x-device-code"),
  );

  if (!dispositivo.ok) {
    if (!(await getSesion())) {
      return Response.json(
        { ok: false, error: "Necesitás sesión de administrador o credencial de dispositivo." },
        { status: 401 },
      );
    }
    // Mantiene el 403 real de la puerta común para una sesión EMPLEADO.
    await exigirAdmin();
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
