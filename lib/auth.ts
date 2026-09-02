// lib/auth.ts
// Autenticación propia: bcryptjs para la contraseña, jose para el JWT y
// cookie httpOnly pab_sesion de 8 horas. Solo servidor.

import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { db } from "./db";
import {
  COOKIE_SESION,
  DURACION_SEGUNDOS,
  firmarSesion,
  verificarSesion,
} from "./sesion";
import type { Rol, Sesion } from "./tipos";

type FilaLogin = {
  id: number;
  usuario: string;
  password_hash: string;
  rol: Rol;
  area_id: number | null;
  activo: boolean;
};

/**
 * Verifica usuario y contraseña contra la tabla usuarios. Si son correctos
 * firma el JWT y lo deja en la cookie httpOnly pab_sesion.
 * Devuelve la sesión, o null si las credenciales no sirven.
 *
 * Solo se puede llamar desde una Server Action o un Route Handler, porque
 * escribe una cookie.
 */
export async function login(
  usuario: string,
  password: string,
): Promise<Sesion | null> {
  const nombre = usuario.trim().toLowerCase();
  if (!nombre || !password) return null;

  const { data, error } = await db()
    .from("usuarios")
    .select("id, usuario, password_hash, rol, area_id, activo")
    .eq("usuario", nombre)
    .maybeSingle()
    .overrideTypes<FilaLogin, { merge: false }>();

  if (error || !data || !data.activo) return null;

  const coincide = await bcrypt.compare(password, data.password_hash);
  if (!coincide) return null;

  const sesion: Sesion = {
    id: data.id,
    usuario: data.usuario,
    rol: data.rol,
    area_id: data.area_id,
  };

  const token = await firmarSesion(sesion);
  const tienda = await cookies();
  tienda.set(COOKIE_SESION, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DURACION_SEGUNDOS,
  });

  return sesion;
}

/** Lee la cookie pab_sesion y devuelve la sesión vigente, o null. */
export async function getSesion(): Promise<Sesion | null> {
  const tienda = await cookies();
  const token = tienda.get(COOKIE_SESION)?.value;
  if (!token) return null;
  return verificarSesion(token);
}

/**
 * Borra la cookie de sesión. Solo desde una Server Action o Route Handler.
 */
export async function logout(): Promise<void> {
  const tienda = await cookies();
  tienda.delete(COOKIE_SESION);
}

/**
 * Exige sesión válida. Si no hay, manda al login.
 * Para páginas y Server Actions de cualquier rol.
 */
export async function exigirSesion(): Promise<Sesion> {
  const sesion = await getSesion();
  if (!sesion) redirect("/login");
  return sesion;
}

/**
 * Exige sesión válida CON rol ADMINISTRADOR.
 *
 * Es la única puerta de las secciones de administración: la llaman tanto las
 * páginas como cada Server Action, así que esconder el ítem del menú no
 * alcanza para entrar. Sin sesión redirige al login; con sesión de EMPLEADO
 * dispara forbidden(), que devuelve 403 y renderiza app/forbidden.tsx.
 */
export async function exigirAdmin(): Promise<Sesion> {
  const sesion = await getSesion();
  if (!sesion) redirect("/login");
  if (sesion.rol !== "ADMINISTRADOR") forbidden();
  return sesion;
}
