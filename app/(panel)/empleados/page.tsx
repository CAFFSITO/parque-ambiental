// app/(panel)/empleados/page.tsx
// Exclusiva del rol ADMINISTRADOR.

import { exigirAdmin } from "@/lib/auth";
import { db, leerEmpleados } from "@/lib/db";
import { TAREAS, unirOpciones } from "@/lib/catalogos";
import type { Area, Empleado } from "@/lib/tipos";
import { GestorEmpleados } from "./gestor";

export const metadata = {
  title: "Empleados · Parque Ambiental Municipal de Berisso",
};

/** Las opciones vigentes son el catálogo base más todo lo ya creado a mano. */
function opcionesGuardadas(
  empleados: Empleado[],
  campo: "tareas" | "turnos",
  principal: "tarea" | "turno",
): string[] {
  const valores: (string | null)[] = [];
  for (const empleado of empleados) {
    valores.push(...(empleado[campo] ?? []));
    valores.push(empleado[principal]);
  }
  return valores.filter((valor): valor is string => valor !== null);
}

export default async function PaginaEmpleados() {
  await exigirAdmin();

  const [empleados, areasResultado] = await Promise.all([
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
    <GestorEmpleados
      empleados={empleados}
      areas={areasResultado.data ?? []}
      tareasDisponibles={unirOpciones(
        TAREAS,
        opcionesGuardadas(empleados, "tareas", "tarea"),
      )}
      turnosGuardados={opcionesGuardadas(empleados, "turnos", "turno")}
    />
  );
}
