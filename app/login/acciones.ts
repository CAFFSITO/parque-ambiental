"use server";

// app/login/acciones.ts
// Server Action del formulario de acceso. El login escribe la cookie, por eso
// tiene que correr acá y no en el render del componente.

import { redirect } from "next/navigation";
import { login } from "@/lib/auth";
import type { EstadoLogin } from "./estado";

function destinoSeguro(valor: FormDataEntryValue | null): string {
  if (typeof valor !== "string") return "/";
  // Solo rutas internas: nada de "//host" ni URLs absolutas.
  if (!valor.startsWith("/") || valor.startsWith("//")) return "/";
  if (valor === "/login" || valor.startsWith("/login/")) return "/";
  return valor;
}

/**
 * Con JavaScript hidratado, useActionState llama la acción como
 * (estadoPrevio, formData). Si el formulario se envía antes de hidratar —o con
 * JS deshabilitado— React la llama solo con (formData). Aceptamos las dos
 * formas para que el acceso no dependa de que el bundle haya cargado.
 */
export async function accionLogin(
  estadoPrevio: EstadoLogin | FormData,
  datos?: FormData,
): Promise<EstadoLogin> {
  const formulario =
    datos ?? (estadoPrevio instanceof FormData ? estadoPrevio : null);

  if (!formulario) {
    return { error: "No se recibieron los datos del formulario." };
  }

  const usuario = String(formulario.get("usuario") ?? "");
  const password = String(formulario.get("password") ?? "");

  if (!usuario.trim() || !password) {
    return { error: "Completá usuario y contraseña." };
  }

  const sesion = await login(usuario, password);
  if (!sesion) {
    return { error: "Usuario o contraseña incorrectos." };
  }

  redirect(destinoSeguro(formulario.get("desde")));
}
