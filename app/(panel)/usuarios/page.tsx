// app/(panel)/usuarios/page.tsx
// Exclusiva del rol ADMINISTRADOR. El password_hash nunca sale del servidor.

import { exigirAdmin } from "@/lib/auth";
import { db, leerEmpleados } from "@/lib/db";
import type { Area } from "@/lib/tipos";
import { GestorUsuarios, type UsuarioListado } from "./gestor";

export const metadata = {
  title: "Usuarios · Parque Ambiental Municipal",
};

export default async function PaginaUsuarios() {
  const sesion = await exigirAdmin();

  const [usuariosResultado, empleados, areasResultado] = await Promise.all([
      db()
        .from("usuarios")
        .select("id, usuario, rol, empleado_id, area_id, activo, creado_en")
        .order("usuario", { ascending: true })
        .overrideTypes<UsuarioListado[], { merge: false }>(),

      leerEmpleados(),

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
      empleados={empleados}
      areas={areasResultado.data ?? []}
      sesion={sesion}
    />
  );
}
