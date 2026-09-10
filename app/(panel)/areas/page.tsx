// app/(panel)/areas/page.tsx
// Exclusiva del rol ADMINISTRADOR: exigirAdmin() corre antes de leer nada.

import { bloqueosDeArea, dependenciasDeAreas } from "@/lib/borrado";
import { exigirAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { TIPOS_AREA, unirOpciones } from "@/lib/catalogos";
import { leerDispositivosConEstado } from "@/lib/dispositivos";
import type { AreaConAutomatizacion } from "@/lib/tipos";
import { GestorAreas, type AreaConMetricas } from "./gestor";

export const metadata = {
  title: "Áreas · Parque Ambiental Municipal",
};

/**
 * Los cuatro umbrales y los cuatro interruptores de automatización viajan
 * juntos: la pantalla los edita en el mismo formulario, y se leen mejor uno al
 * lado del otro que en dos consultas.
 */
const COLUMNAS_AREA =
  "id, codigo, nombre, tipo, temp_min, temp_max, hum_min, hum_max, activa, creada_en, " +
  "auto_temp_baja, auto_temp_alta, auto_hum_baja, auto_hum_alta";

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

  const [
    areasResultado,
    empleadosResultado,
    llamadosResultado,
    dispositivos,
    dependencias,
  ] = await Promise.all([
      db()
        .from("areas")
        .select(COLUMNAS_AREA)
        .order("codigo", { ascending: true })
        .overrideTypes<AreaConAutomatizacion[], { merge: false }>(),

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

      // La flota ENTERA en una sola consulta, igual que empleados y llamados.
      // El agrupado por área lo hace el componente: pedir los dispositivos de
      // cada área por separado serían ocho consultas para responder lo mismo.
      //
      // Se traen todos, no solo los asignados, porque el selector de "Asignar
      // dispositivo" necesita también los que están sin área o en otra.
      leerDispositivosConEstado(),

      // Qué cuelga de cada área, para decidir si se puede BORRAR o solo dar de
      // baja. Una sola consulta agregada (sql/12); si esa migración no está
      // aplicada, devuelve no disponible y la pantalla deja de ofrecer borrar.
      dependenciasDeAreas(),
    ]);

  const empleadosPorArea = agrupar(empleadosResultado.data ?? []);
  const llamadosPorArea = agrupar(llamadosResultado.data ?? []);
  const dispositivosPorArea = agrupar(
    dispositivos.map((dispositivo) => ({ area_id: dispositivo.area_id })),
  );

  const areas: AreaConMetricas[] = (areasResultado.data ?? []).map((area) => ({
    ...area,
    empleados: empleadosPorArea.get(area.id) ?? 0,
    llamados_abiertos: llamadosPorArea.get(area.id) ?? 0,
    dispositivos: dispositivosPorArea.get(area.id) ?? 0,

    // null = no se pudo saber, y entonces no se ofrece borrar.
    // [] = no cuelga nada: se puede borrar.
    // [motivos] = hay historia; solo se puede dar de baja.
    //
    // Los motivos se calculan ACÁ, en el servidor, y viajan como texto: el
    // gestor es un componente cliente y lib/borrado.ts es server-only.
    bloqueos: (() => {
      const dep = dependencias.por.get(area.id);
      if (!dependencias.disponible || dep === undefined) return null;
      return bloqueosDeArea(dep);
    })(),
  }));

  // El selector de tipo ofrece el catálogo base más los tipos ya inventados.
  const tiposDisponibles = unirOpciones(
    TIPOS_AREA,
    (areasResultado.data ?? []).map((area) => area.tipo),
  );

  return (
    <GestorAreas
      areas={areas}
      tiposDisponibles={tiposDisponibles}
      dispositivos={dispositivos}
    />
  );
}
