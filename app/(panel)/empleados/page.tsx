// app/(panel)/empleados/page.tsx
// Exclusiva del rol ADMINISTRADOR.

import { bloqueosDeEmpleado, dependenciasDeEmpleados } from "@/lib/borrado";
import { exigirAdmin } from "@/lib/auth";
import { db, leerEmpleados } from "@/lib/db";
import { TAREAS, unirOpciones } from "@/lib/catalogos";
import type { Area, Empleado } from "@/lib/tipos";
import { GestorEmpleados } from "./gestor";

export const metadata = {
  title: "Empleados · Parque Ambiental Municipal",
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

  const [empleados, areasResultado, dependencias] = await Promise.all([
    leerEmpleados(),

    db()
      .from("areas")
      .select(
        "id, codigo, nombre, tipo, temp_min, temp_max, hum_min, hum_max, activa, creada_en",
      )
      .order("codigo", { ascending: true })
      .overrideTypes<Area[], { merge: false }>(),

    // Qué cuelga de cada empleado, para decidir si se puede BORRAR o solo dar
    // de baja. Una sola consulta agregada (sql/12).
    dependenciasDeEmpleados(),
  ]);

  // Los motivos se calculan acá, en el servidor: el gestor es un componente
  // cliente y lib/borrado.ts es server-only. Viaja texto, no lógica.
  const borrado = dependencias.disponible
    ? Object.fromEntries(
        empleados.map((empleado) => {
          const dep = dependencias.por.get(empleado.id) ?? {
            usuarios: 0,
            llamados_legajo: 0,
          };
          return [
            empleado.id,
            {
              bloqueos: bloqueosDeEmpleado(dep),
              llamados_legajo: dep.llamados_legajo,
            },
          ];
        }),
      )
    : null;

  return (
    <GestorEmpleados
      empleados={empleados}
      areas={areasResultado.data ?? []}
      borrado={borrado}
      tareasDisponibles={unirOpciones(
        TAREAS,
        opcionesGuardadas(empleados, "tareas", "tarea"),
      )}
      turnosGuardados={opcionesGuardadas(empleados, "turnos", "turno")}
    />
  );
}
