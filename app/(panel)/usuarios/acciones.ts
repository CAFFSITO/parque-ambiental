"use server";

// app/(panel)/usuarios/acciones.ts
//
// Reglas duras que se verifican acá, no en el cliente:
//   - solo ADMINISTRADOR entra (exigirAdmin en cada acción);
//   - un administrador no se puede desactivar a sí mismo;
//   - un administrador no se puede bajar el rol a sí mismo;
//   - un administrador no se puede eliminar a sí mismo;
//   - si el rol es EMPLEADO, el area_id sale del empleado vinculado.

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { exigirAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { esRol, LARGO_MINIMO_PASSWORD } from "@/lib/catalogos";
import type { Resultado, Rol } from "@/lib/tipos";

const RONDAS_BCRYPT = 10;
const USUARIO_DUPLICADO = "23505";

export type EntradaUsuarioNuevo = {
  usuario: string;
  password: string;
  rol: string;
  empleado_id: number | null;
};

function refrescar(): void {
  revalidatePath("/usuarios");
}

/**
 * Una Server Action es un endpoint HTTP: el cuerpo puede venir con cualquier
 * forma. Antes de tocar un campo, normalizamos todo a los tipos esperados.
 */
function sanear(entrada: EntradaUsuarioNuevo): EntradaUsuarioNuevo {
  const crudo = entrada as unknown as Record<string, unknown>;

  const texto = (clave: string): string =>
    typeof crudo?.[clave] === "string" ? (crudo[clave] as string) : "";

  const empleadoId = crudo?.empleado_id;

  return {
    usuario: texto("usuario"),
    password: texto("password"),
    rol: texto("rol"),
    empleado_id: typeof empleadoId === "number" ? empleadoId : null,
  };
}

function validarNombreDeUsuario(usuario: string): string | null {
  const limpio = usuario.trim().toLowerCase();
  if (limpio.length < 3) {
    return "El nombre de usuario necesita al menos 3 caracteres.";
  }
  if (!/^[a-z0-9._-]+$/.test(limpio)) {
    return "El nombre de usuario solo admite letras, números, punto, guion y guion bajo.";
  }
  return null;
}

function validarPassword(password: string): string | null {
  if (typeof password !== "string") return "La contraseña es obligatoria.";
  if (password.length < LARGO_MINIMO_PASSWORD) {
    return `La contraseña necesita al menos ${LARGO_MINIMO_PASSWORD} caracteres.`;
  }
  return null;
}

/** Para rol EMPLEADO el área se toma del empleado y queda fija. */
async function areaSegunRol(
  rol: Rol,
  empleadoId: number | null,
): Promise<{ ok: true; area_id: number | null } | { ok: false; error: string }> {
  if (rol === "ADMINISTRADOR") return { ok: true, area_id: null };

  if (empleadoId === null) {
    return {
      ok: false,
      error: "Un usuario con rol EMPLEADO tiene que estar vinculado a un empleado.",
    };
  }

  const { data, error } = await db()
    .from("empleados")
    .select("id, area_id")
    .eq("id", empleadoId)
    .maybeSingle()
    .overrideTypes<{ id: number; area_id: number | null }, { merge: false }>();

  if (error || !data) {
    return { ok: false, error: "El empleado seleccionado no existe." };
  }
  if (data.area_id === null) {
    return {
      ok: false,
      error: "El empleado no tiene área asignada. Asignale un área primero.",
    };
  }

  return { ok: true, area_id: data.area_id };
}

export async function crearUsuario(
  entrada: EntradaUsuarioNuevo,
): Promise<Resultado> {
  await exigirAdmin();

  const limpia = sanear(entrada);

  if (!esRol(limpia.rol)) return { ok: false, error: "Rol inválido." };

  const problemaUsuario = validarNombreDeUsuario(limpia.usuario);
  if (problemaUsuario) return { ok: false, error: problemaUsuario };

  const problemaPassword = validarPassword(limpia.password);
  if (problemaPassword) return { ok: false, error: problemaPassword };

  const area = await areaSegunRol(limpia.rol, limpia.empleado_id);
  if (!area.ok) return { ok: false, error: area.error };

  const { error } = await db().from("usuarios").insert({
    usuario: limpia.usuario.trim().toLowerCase(),
    password_hash: await bcrypt.hash(limpia.password, RONDAS_BCRYPT),
    rol: limpia.rol,
    empleado_id: limpia.empleado_id,
    area_id: area.area_id,
    activo: true,
  });

  if (error) {
    if (error.code === USUARIO_DUPLICADO) {
      return { ok: false, error: "Ese nombre de usuario ya está tomado." };
    }
    return { ok: false, error: `No se pudo crear el usuario: ${error.message}` };
  }

  refrescar();
  return { ok: true, mensaje: "Usuario creado." };
}

export async function cambiarRolUsuario(
  id: number,
  rol: string,
): Promise<Resultado> {
  const sesion = await exigirAdmin();

  if (!esRol(rol)) return { ok: false, error: "Rol inválido." };

  if (id === sesion.id && rol !== "ADMINISTRADOR") {
    return {
      ok: false,
      error: "No podés bajarte el rol a vos mismo. Pedíselo a otro administrador.",
    };
  }

  const { data, error: errorLectura } = await db()
    .from("usuarios")
    .select("id, empleado_id")
    .eq("id", id)
    .maybeSingle()
    .overrideTypes<{ id: number; empleado_id: number | null }, { merge: false }>();

  if (errorLectura || !data) {
    return { ok: false, error: "El usuario no existe." };
  }

  const area = await areaSegunRol(rol, data.empleado_id);
  if (!area.ok) return { ok: false, error: area.error };

  const { error } = await db()
    .from("usuarios")
    .update({ rol, area_id: area.area_id })
    .eq("id", id);

  if (error) {
    return { ok: false, error: `No se pudo cambiar el rol: ${error.message}` };
  }

  refrescar();
  return { ok: true, mensaje: `Rol cambiado a ${rol}.` };
}

export async function cambiarActivoUsuario(
  id: number,
  activo: boolean,
): Promise<Resultado> {
  const sesion = await exigirAdmin();

  if (id === sesion.id && !activo) {
    return {
      ok: false,
      error: "No podés desactivar tu propio usuario.",
    };
  }

  const { error } = await db().from("usuarios").update({ activo }).eq("id", id);

  if (error) {
    return {
      ok: false,
      error: `No se pudo cambiar el estado del usuario: ${error.message}`,
    };
  }

  refrescar();
  return { ok: true, mensaje: activo ? "Usuario activado." : "Usuario desactivado." };
}

export async function resetearPassword(
  id: number,
  password: string,
): Promise<Resultado> {
  await exigirAdmin();

  const problema = validarPassword(password);
  if (problema) return { ok: false, error: problema };

  const { error } = await db()
    .from("usuarios")
    .update({ password_hash: await bcrypt.hash(password, RONDAS_BCRYPT) })
    .eq("id", id);

  if (error) {
    return {
      ok: false,
      error: `No se pudo resetear la contraseña: ${error.message}`,
    };
  }

  refrescar();
  return {
    ok: true,
    mensaje: "Contraseña reseteada. La sesión abierta del usuario sigue vigente hasta que venza.",
  };
}

/**
 * Usuarios es la única tabla donde el borrado es físico: una credencial que
 * ya no debe existir no se archiva, se elimina. La nómina no se toca.
 */
export async function eliminarUsuario(id: number): Promise<Resultado> {
  const sesion = await exigirAdmin();

  if (id === sesion.id) {
    return { ok: false, error: "No podés eliminar tu propio usuario." };
  }

  const { error } = await db().from("usuarios").delete().eq("id", id);

  if (error) {
    return {
      ok: false,
      error: `No se pudo eliminar el usuario: ${error.message}`,
    };
  }

  refrescar();
  return { ok: true, mensaje: "Usuario eliminado." };
}
