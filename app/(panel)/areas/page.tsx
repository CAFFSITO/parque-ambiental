// app/(panel)/areas/page.tsx
// Exclusiva del rol ADMINISTRADOR: exigirAdmin() corre antes de leer nada.

import { exigirAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Area } from "@/lib/tipos";
import { GestorAreas, type AreaConMetricas } from "./gestor";

export const metadata = {
  title: "Áreas · Parque Ambiental Municipal de Berisso",
};

function agrupar(filas: { area_id: number | null }[]): Map<number, number> {
  const conteo = new Map<number, number>();
  for (const fila of filas) {
    if (fila.area_id === null) continue;
    conteo.set(fila.area_id, (conteo.get(fila.area_id) ?? 0) + 1);
  }
  return conteo;
}

export default async function PaginaAreas() {
  await exigirAdmin();

  const [areasResultado, empleadosResultado, llamadosResultado] =
    await Promise.all([
      db()
        .from("areas")
        .select(
          "id, codigo, nombre, tipo, temp_min, temp_max, hum_min, hum_max, activa, creada_en",
        )
        .order("codigo", { ascending: true })
        .overrideTypes<Area[], { merge: false }>(),

      // "Asignados" son los que siguen en la nómina: los de baja no cuentan.
      db()
        .from("empleados")
        .select("area_id")
        .neq("estado", "baja")
        .overrideTypes<{ area_id: number | null }[], { merge: false }>(),

      db()
        .from("llamados")
        .select("area_id")
        .eq("estado", "NO_ATENDIDO")
        .overrideTypes<{ area_id: number | null }[], { merge: false }>(),
    ]);

  const empleadosPorArea = agrupar(empleadosResultado.data ?? []);
  const llamadosPorArea = agrupar(llamadosResultado.data ?? []);

  const areas: AreaConMetricas[] = (areasResultado.data ?? []).map((area) => ({
    ...area,
    empleados: empleadosPorArea.get(area.id) ?? 0,
    llamados_abiertos: llamadosPorArea.get(area.id) ?? 0,
  }));

  return <GestorAreas areas={areas} />;
}
