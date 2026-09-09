// app/(panel)/movil/page.tsx
// Vista de campo. Un EMPLEADO ve solo su área; el filtro se aplica en el
// servidor, igual que en /llamados.

import { exigirSesion } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Area, Llamado } from "@/lib/tipos";
import { GestorMovil } from "./gestor";

export const metadata = {
  title: "Móvil · Parque Ambiental Municipal",
};

const TOPE = 60;

export default async function PaginaMovil() {
  const sesion = await exigirSesion();

  let consulta = db()
    .from("llamados")
    .select(
      "id, area_id, tipo, origen, estado, motivo, detalle, creado_por, creado_en, atendido_por, atendido_en",
    )
    .eq("estado", "NO_ATENDIDO")
    // Las emergencias primero, y dentro de cada grupo lo más nuevo arriba.
    .order("tipo", { ascending: true })
    .order("creado_en", { ascending: false })
    .limit(TOPE);

  if (sesion.rol === "EMPLEADO" && sesion.area_id !== null) {
    consulta = consulta.eq("area_id", sesion.area_id);
  }

  const [llamadosResultado, areasResultado] = await Promise.all([
    consulta.overrideTypes<Llamado[], { merge: false }>(),
    db()
      .from("areas")
      .select(
        "id, codigo, nombre, tipo, temp_min, temp_max, hum_min, hum_max, activa, creada_en",
      )
      .order("codigo", { ascending: true })
      .overrideTypes<Area[], { merge: false }>(),
  ]);

  return (
    <GestorMovil
      llamados={llamadosResultado.data ?? []}
      areas={areasResultado.data ?? []}
      sesion={sesion}
    />
  );
}
