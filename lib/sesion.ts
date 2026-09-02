// lib/sesion.ts
// Firma y verificación del JWT de sesión. Este módulo no toca cookies ni la
// base de datos, así lo pueden importar tanto lib/auth.ts como proxy.ts.

import { SignJWT, jwtVerify } from "jose";
import type { Rol, Sesion } from "./tipos";

export const COOKIE_SESION = "pab_sesion";
export const DURACION_HORAS = 8;
export const DURACION_SEGUNDOS = DURACION_HORAS * 60 * 60;

const ALGORITMO = "HS256";

function clave(): Uint8Array {
  const secreto = process.env.JWT_SECRET;
  if (!secreto) {
    throw new Error("Falta la variable de entorno JWT_SECRET.");
  }
  return new TextEncoder().encode(secreto);
}

function esRol(valor: unknown): valor is Rol {
  return valor === "ADMINISTRADOR" || valor === "EMPLEADO";
}

/** Firma el JWT con { id, usuario, rol, area_id } y 8 horas de vigencia. */
export async function firmarSesion(sesion: Sesion): Promise<string> {
  return new SignJWT({
    id: sesion.id,
    usuario: sesion.usuario,
    rol: sesion.rol,
    area_id: sesion.area_id,
  })
    .setProtectedHeader({ alg: ALGORITMO })
    .setIssuedAt()
    .setExpirationTime(`${DURACION_HORAS}h`)
    .sign(clave());
}

/** Verifica el token y devuelve la sesión, o null si es inválido o venció. */
export async function verificarSesion(token: string): Promise<Sesion | null> {
  try {
    const { payload } = await jwtVerify(token, clave(), {
      algorithms: [ALGORITMO],
    });

    const id = payload.id;
    const usuario = payload.usuario;
    const rol = payload.rol;
    const areaId = payload.area_id;

    if (typeof id !== "number" || typeof usuario !== "string" || !esRol(rol)) {
      return null;
    }
    if (typeof areaId !== "number" && areaId !== null) {
      return null;
    }

    return { id, usuario, rol, area_id: areaId };
  } catch {
    return null;
  }
}
