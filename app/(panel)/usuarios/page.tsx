// app/(panel)/usuarios/page.tsx
// Exclusiva del rol ADMINISTRADOR. El password_hash nunca sale del servidor.

import { exigirAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Area, Empleado } from "@/lib/tipos";
import { GestorUsuarios, type UsuarioListado } from "./gestor";

export const metadata = {
  title: "Usuarios · Parque Ambiental Municipal de Berisso",
};

export default async function PaginaUsuarios() {
  const sesion = await exigirAdmin();

  const [usuariosResultado, empleadosResultado, areasResultado] =
    await Promise.all([
      db()
        .from("usuarios")
        .select("id, usuario, rol, empleado_id, area_id, activo, creado_en")
        .order("usuario", { ascending: true })
        .overrideTypes<UsuarioListado[], { merge: false }>(),

      db()
        .from("empleados")
        .select(
          "id, legajo, nombre, apellido, dni, fecha_nacimiento, telefono, email, domicilio, area_id, tarea, turno, fecha_ingreso, estado, observaciones, creado_en",
        )
        .order("apellido", { ascending: true })
        .overrideTypes<Empleado[], { merge: false }>(),

      db()
        .from("areas")
        .select(
          "id, codigo, nombre, tipo, temp_min, temp_max, hum_min, hum_max, activa, creada_en",
        )
        .order("codigo", { ascending: true })
        .overrideTypes<Area[], { merge: false }>(),
    ]);

  return (
    <GestorUsuarios
      usuarios={usuariosResultado.data ?? []}
      empleados={empleadosResultado.data ?? []}
      areas={areasResultado.data ?? []}
      sesion={sesion}
    />
  );
}
