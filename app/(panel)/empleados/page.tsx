// app/(panel)/empleados/page.tsx
// Exclusiva del rol ADMINISTRADOR.

import { exigirAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Area, Empleado } from "@/lib/tipos";
import { GestorEmpleados } from "./gestor";

export const metadata = {
  title: "Empleados · Parque Ambiental Municipal de Berisso",
};

export default async function PaginaEmpleados() {
  await exigirAdmin();

  const [empleadosResultado, areasResultado] = await Promise.all([
    db()
      .from("empleados")
      .select(
        "id, legajo, nombre, apellido, dni, fecha_nacimiento, telefono, email, domicilio, area_id, tarea, turno, fecha_ingreso, estado, observaciones, creado_en",
      )
      .order("apellido", { ascending: true })
      .order("nombre", { ascending: true })
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
    <GestorEmpleados
      empleados={empleadosResultado.data ?? []}
      areas={areasResultado.data ?? []}
    />
  );
}
